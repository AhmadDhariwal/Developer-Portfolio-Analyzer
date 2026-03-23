const crypto = require('node:crypto');
const IntegrationConnection = require('../models/integrationConnection');
const IntegrationSyncLog = require('../models/integrationSyncLog');
const { getAdapter, marketplace } = require('../services/integrations');
const { upsertProviderInsight, getIntegrationInsight, computeIntegrationScore } = require('../services/integrationInsightService');
const { normalizeIngestion } = require('../services/integrationNormalizationService');
const { syncConnectedProvidersForUser, syncProviderForUser } = require('../services/integrationSyncService');

const trimValue = (value) => String(value || '').trim();

const getFrontendBaseUrl = () => {
  const fromEnv = trimValue(process.env.FRONTEND_BASE_URL).replace(/\/+$/, '');
  return fromEnv || 'http://localhost:4200';
};

const resolveProviderRedirectUri = (provider, requestedRedirectUri) => {
  const providerOverrides = {
    github: trimValue(process.env.GITHUB_OAUTH_REDIRECT_URI),
    linkedin: trimValue(process.env.LINKEDIN_OAUTH_REDIRECT_URI)
  };

  if (providerOverrides[provider]) return providerOverrides[provider];

  const requested = trimValue(requestedRedirectUri);
  if (requested) return requested;

  return `${getFrontendBaseUrl()}/app/integrations`;
};

const withStatuses = async (userId) => {
  const connections = await IntegrationConnection.find({ userId }).lean();
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  return marketplace.map((item) => {
    const found = byProvider.get(item.provider);
    return {
      ...item,
      status: found?.status || 'disconnected',
      externalUsername: found?.externalUsername || '',
        lastSyncedAt: found?.lastSyncedAt || null,
        authMode: item.authMode || 'oauth2'
    };
  });
};

const getMarketplace = async (req, res) => {
  try {
    const items = await withStatuses(req.user._id);
    return res.json({ integrations: items });
  } catch (error) {
    console.error('Get marketplace error:', error.message);
    return res.status(500).json({ message: 'Failed to load integrations marketplace.' });
  }
};

const startOAuth = async (req, res) => {
  try {
    const { provider, redirectUri } = req.body || {};
    const adapter = getAdapter(provider);

    if (!adapter) {
      return res.status(400).json({ message: 'Unsupported provider.' });
    }

    if (adapter.getAuthMode() !== 'oauth2') {
      return res.status(400).json({
        message: `${provider} uses manual connection instead of OAuth.`,
        authMode: 'manual',
        hints: adapter.getManualAuthHints ? adapter.getManualAuthHints() : null
      });
    }

    const configValidation = adapter.validateConfig();
    if (!configValidation.ok) {
      return res.status(400).json({
        message: `Missing OAuth config for ${provider}.`,
        missingConfig: configValidation.missing
      });
    }

    const resolvedRedirectUri = resolveProviderRedirectUri(provider, redirectUri);
    const state = `${provider}:${crypto.randomUUID()}`;
    const authorizationUrl = adapter.getAuthorizationUrl({ state, redirectUri: resolvedRedirectUri });

    await IntegrationConnection.findOneAndUpdate(
      { userId: req.user._id, provider },
      {
        $set: {
          oauthState: state,
          oauthStateExpiresAt: new Date(Date.now() + (10 * 60 * 1000)),
          oauthRedirectUri: resolvedRedirectUri
        }
      },
      { upsert: true }
    );

    return res.json({ provider, state, authorizationUrl, redirectUri: resolvedRedirectUri });
  } catch (error) {
    console.error('Start oauth error:', error.message);
    return res.status(500).json({ message: 'Failed to start OAuth flow.' });
  }
};

const oauthCallback = async (req, res) => {
  try {
    const { provider, code, state, username, redirectUri } = req.body || {};
    const adapter = getAdapter(provider);

    if (!adapter) {
      return res.status(400).json({ message: 'Unsupported provider.' });
    }
    if (!code) {
      return res.status(400).json({ message: 'OAuth code is required.' });
    }

    if (adapter.getAuthMode() !== 'oauth2') {
      return res.status(400).json({ message: `${provider} does not support OAuth callback.` });
    }

    const connectionDoc = await IntegrationConnection.findOne({ userId: req.user._id, provider }).lean();
    if (!connectionDoc?.oauthState || !state || connectionDoc.oauthState !== state) {
      return res.status(400).json({ message: 'Invalid OAuth state.' });
    }
    if (connectionDoc.oauthStateExpiresAt && new Date(connectionDoc.oauthStateExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({ message: 'OAuth state expired. Start connection again.' });
    }

    const resolvedRedirectUri = connectionDoc.oauthRedirectUri || resolveProviderRedirectUri(provider, redirectUri);
    const token = await adapter.exchangeCodeForToken({ code, redirectUri: resolvedRedirectUri });
    const identity = adapter.getExternalIdentity
      ? await adapter.getExternalIdentity(token.accessToken)
      : { username: '' };

    const expiresAt = token.expiresIn
      ? new Date(Date.now() + (Number(token.expiresIn || 0) * 1000))
      : null;

    const connection = await IntegrationConnection.findOneAndUpdate(
      { userId: req.user._id, provider },
      {
        $set: {
          status: 'connected',
          externalUsername: String(username || identity.username || req.user.githubUsername || '').trim(),
          accessToken: token.accessToken || '',
          refreshToken: token.refreshToken || '',
          tokenType: token.tokenType || 'Bearer',
          tokenExpiresAt: expiresAt,
          scopes: String(token.scope || '').split(/[\s,]+/).filter(Boolean),
          nextSyncAt: new Date(),
          lastSyncError: '',
          oauthState: '',
          oauthStateExpiresAt: null,
          oauthRedirectUri: resolvedRedirectUri
        }
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    return res.json({
      message: `${provider} connected successfully.`,
      connection: {
        provider: connection.provider,
        status: connection.status,
        externalUsername: connection.externalUsername,
        lastSyncedAt: connection.lastSyncedAt
      }
    });
  } catch (error) {
    console.error('OAuth callback error:', error.message);
    return res.status(500).json({ message: 'Failed to complete OAuth callback.' });
  }
};

const manualConnectProvider = async (req, res) => {
  try {
    const { provider, externalUsername, apiKey = '' } = req.body || {};
    const adapter = getAdapter(provider);

    if (!adapter) {
      return res.status(400).json({ message: 'Unsupported provider.' });
    }
    if (adapter.getAuthMode() !== 'manual') {
      return res.status(400).json({ message: `${provider} requires OAuth connection.` });
    }
    if (!externalUsername) {
      return res.status(400).json({ message: 'externalUsername is required for manual connection.' });
    }

    const candidateConnection = {
      provider,
      externalUsername: String(externalUsername).trim(),
      accessToken: String(apiKey || '').trim(),
      status: 'connected'
    };

    // Validate the manual username by fetching provider data before persisting.
    // This avoids "connected" state with invalid handles.
    let ingested;
    try {
      ingested = await adapter.ingestData(candidateConnection);
    } catch (error) {
      return res.status(400).json({
        message: `${provider} username validation failed. ${error.message || 'Unable to fetch public profile data.'}`
      });
    }

    const providerInsight = normalizeIngestion(provider, ingested);
    await upsertProviderInsight({
      userId: req.user._id,
      providerInsight
    });

    const connection = await IntegrationConnection.findOneAndUpdate(
      { userId: req.user._id, provider },
      {
        $set: {
          status: 'connected',
          externalUsername: candidateConnection.externalUsername,
          accessToken: candidateConnection.accessToken,
          refreshToken: '',
          scopes: ['public_profile'],
          nextSyncAt: new Date(),
          metadata: {
            lastIngestion: ingested,
            totalSkillsDetected: providerInsight.inferredSkills.length,
            profileScore: providerInsight.profileScore,
            activityScore: providerInsight.activityScore
          },
          lastSyncError: '',
          lastSyncedAt: new Date(),
          oauthState: '',
          oauthStateExpiresAt: null
        }
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();

    return res.json({
      message: `${provider} connected with manual credentials.`,
      connection: {
        provider: connection.provider,
        status: connection.status,
        externalUsername: connection.externalUsername
      }
    });
  } catch (error) {
    console.error('Manual connect provider error:', error.message);
    return res.status(500).json({ message: 'Failed to connect provider manually.' });
  }
};

const ingestProviderData = async (req, res) => {
  try {
    const { provider } = req.body || {};
    const adapter = getAdapter(provider);

    if (!adapter) {
      return res.status(400).json({ message: 'Unsupported provider.' });
    }

    const connection = await IntegrationConnection.findOne({ userId: req.user._id, provider }).lean();
    if (!connection || connection.status !== 'connected') {
      return res.status(400).json({ message: `${provider} is not connected yet.` });
    }

    const ingested = await adapter.ingestData(connection);
    const providerInsight = normalizeIngestion(provider, ingested);
    const insight = await upsertProviderInsight({
      userId: req.user._id,
      providerInsight
    });

    await IntegrationConnection.findOneAndUpdate(
      { userId: req.user._id, provider },
      {
        $set: {
          status: 'connected',
          metadata: {
            lastIngestion: ingested,
            totalSkillsDetected: providerInsight.inferredSkills.length,
            profileScore: providerInsight.profileScore,
            activityScore: providerInsight.activityScore
          },
          nextSyncAt: new Date(Date.now() + (Math.max(1, Number.parseInt(process.env.INTEGRATION_DEFAULT_SYNC_INTERVAL_MIN || '30', 10)) * 60 * 1000)),
          lastSyncError: '',
          lastSyncedAt: new Date()
        }
      }
    );

    return res.json({
      provider,
      ingested,
      insight: {
        integrationScore: insight.integrationScore,
        mergedSkills: insight.mergedSkills
      },
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Ingest provider data error:', error.message);
    return res.status(500).json({ message: 'Failed to ingest provider data.' });
  }
};

const syncNow = async (req, res) => {
  try {
    const { provider } = req.body || {};
    if (provider) {
      const result = await syncProviderForUser(req.user._id, provider, 'manual_sync');
      if (!result.ok) {
        return res.status(400).json({ message: result.error || 'Sync failed.' });
      }
      return res.json({ message: `${provider} synced successfully.`, result });
    }

    const results = await syncConnectedProvidersForUser(req.user._id, 'manual_sync_all');
    return res.json({ message: 'Connected providers synced.', results });
  } catch (error) {
    console.error('Sync now error:', error.message);
    return res.status(500).json({ message: 'Failed to run sync now.' });
  }
};

const getSyncTrends = async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, Number.parseInt(String(req.query.days || '7'), 10)));
    const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const logs = await IntegrationSyncLog.find({
      userId: req.user._id,
      createdAt: { $gte: since }
    })
      .sort({ createdAt: -1 })
      .lean();

    const byProvider = {};
    logs.forEach((log) => {
      if (!byProvider[log.provider]) byProvider[log.provider] = [];
      byProvider[log.provider].push(log);
    });

    const trends = Object.entries(byProvider).map(([provider, providerLogs]) => {
      const latest = providerLogs[0];
      const previous = providerLogs[1] || null;
      const delta = previous ? Number(latest.activityScore || 0) - Number(previous.activityScore || 0) : 0;

      return {
        provider,
        latestProfileScore: Number(latest.profileScore || 0),
        latestActivityScore: Number(latest.activityScore || 0),
        latestConfidence: Number(latest.confidence || 0),
        trendDelta: Number(delta.toFixed(2)),
        syncCount: providerLogs.length,
        successRate: Number(((providerLogs.filter((l) => l.status === 'success').length / providerLogs.length) * 100).toFixed(1)),
        lastSyncedAt: latest.createdAt
      };
    });

    return res.json({ days, trends });
  } catch (error) {
    console.error('Get sync trends error:', error.message);
    return res.status(500).json({ message: 'Failed to load integration sync trends.' });
  }
};

const githubWebhook = async (req, res) => {
  try {
    const secret = String(process.env.INTEGRATION_WEBHOOK_SECRET || '').trim();
    const provided = String(req.headers['x-integration-webhook-secret'] || '').trim();
    if (!secret || provided !== secret) {
      return res.status(401).json({ message: 'Invalid webhook secret.' });
    }

    const githubUsername = String(req.body?.githubUsername || '').trim();
    if (!githubUsername) {
      return res.status(400).json({ message: 'githubUsername is required.' });
    }

    const connections = await IntegrationConnection.find({
      provider: 'github',
      status: 'connected',
      externalUsername: githubUsername
    }).lean();

    for (const connection of connections) {
      await syncProviderForUser(connection.userId, 'github', 'webhook');
    }

    return res.json({ message: 'Webhook processed.', matchedConnections: connections.length });
  } catch (error) {
    console.error('GitHub webhook error:', error.message);
    return res.status(500).json({ message: 'Webhook processing failed.' });
  }
};

const getIntegrationInsights = async (req, res) => {
  try {
    const insight = await getIntegrationInsight(req.user._id);

    // If no persisted insight exists yet, derive a fallback from connected metadata
    // so the dashboard and integrations page can still surface usable data.
    if (!Array.isArray(insight.providers) || insight.providers.length === 0) {
      const connections = await IntegrationConnection.find({ userId: req.user._id, status: 'connected' }).lean();
      const providers = connections
        .map((connection) => ({
          provider: connection.provider,
          profileScore: Number(connection?.metadata?.profileScore || 0),
          activityScore: Number(connection?.metadata?.activityScore || 0),
          confidence: Number(connection?.metadata?.totalSkillsDetected ? 65 : 45),
          inferredSkills: [],
          syncedAt: connection.lastSyncedAt || connection.updatedAt || connection.createdAt || null
        }))
        .filter((item) => item.profileScore > 0 || item.activityScore > 0);

      if (providers.length > 0) {
        return res.json({
          providers,
          mergedSkills: [],
          integrationScore: computeIntegrationScore(providers),
          updatedAt: new Date().toISOString()
        });
      }
    }

    return res.json(insight);
  } catch (error) {
    console.error('Get integration insights error:', error.message);
    return res.status(500).json({ message: 'Failed to load integration insights.' });
  }
};

const getConnections = async (req, res) => {
  try {
    const connections = await IntegrationConnection.find({ userId: req.user._id }).lean();
    return res.json({ connections });
  } catch (error) {
    console.error('Get connections error:', error.message);
    return res.status(500).json({ message: 'Failed to load provider connections.' });
  }
};

const disconnectProvider = async (req, res) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    if (!getAdapter(provider)) {
      return res.status(400).json({ message: 'Unsupported provider.' });
    }

    await IntegrationConnection.findOneAndUpdate(
      { userId: req.user._id, provider },
      {
        $set: {
          status: 'disconnected',
          accessToken: '',
          refreshToken: '',
          scopes: [],
          metadata: {},
          lastSyncedAt: null
        }
      },
      { upsert: true }
    );

    return res.json({ message: `${provider} disconnected.` });
  } catch (error) {
    console.error('Disconnect provider error:', error.message);
    return res.status(500).json({ message: 'Failed to disconnect provider.' });
  }
};

module.exports = {
  getMarketplace,
  startOAuth,
  oauthCallback,
  manualConnectProvider,
  ingestProviderData,
  syncNow,
  getSyncTrends,
  githubWebhook,
  getConnections,
  getIntegrationInsights,
  disconnectProvider
};
