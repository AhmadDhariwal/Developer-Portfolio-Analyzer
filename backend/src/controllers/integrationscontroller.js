'use strict';
const crypto = require('node:crypto');
const Connection = require('../models/integrationConnection');
const Log = require('../models/integrationSyncLog');
const { getAdapter, marketplace } = require('../services/integrations');
const insights = require('../services/integrationInsightService');
const { normalizeIngestion } = require('../services/integrationNormalizationService');
const sync = require('../services/integrationSyncService');
const persistence = require('../services/integrationPersistenceService');
const governance = require('../services/integrationGovernanceService');
const tokens = require('../services/integrationTokenService');
const publicResources = require('../services/kaggleResourceObservationService');
const { getGithubIntegrationOAuthConfig } = require('../config/githubOauth');
const trim = (value) => (typeof value === 'string' ? value.trim() : '');
const frontend = () =>
  trim(process.env.FRONTEND_URL || process.env.FRONTEND_BASE_URL).replace(/\/+$/, '');
function redirectUri(provider) {
  const value =
    provider === 'github'
      ? getGithubIntegrationOAuthConfig().callbackUrl
      : trim(process.env.LINKEDIN_OAUTH_REDIRECT_URI) || `${frontend()}/app/integrations`;
  const parsed = new URL(value);
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname)
      ))
  )
    throw Error('Invalid callback configuration.');
  return value;
}
function errorResponse(res, error, message) {
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  return res.status(error.status || 500).json({ message: error.status ? error.message : message });
}
async function getMarketplace(req, res) {
  try {
    const rows = await Connection.find({ userId: req.user._id })
      .select('provider status externalUsername lastSyncedAt metadata.resourceObservation')
      .lean();
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return res.json({
      integrations: marketplace.map((item) => ({
        ...item,
        status: byProvider.get(item.provider)?.status || 'disconnected',
        externalUsername: byProvider.get(item.provider)?.externalUsername || '',
        lastSyncedAt: byProvider.get(item.provider)?.lastSyncedAt || null,
        authMode: item.authMode || 'oauth2',
        ...(item.provider === 'kaggle' &&
        byProvider.get(item.provider)?.status === 'connected' &&
        byProvider.get(item.provider)?.metadata?.resourceObservation
          ? {
              resourceSummary: {
                notebooks: byProvider.get(item.provider).metadata.resourceObservation.activity
                  .notebooks.resources.length,
                datasets: byProvider.get(item.provider).metadata.resourceObservation.activity
                  .datasets.resources.length,
                ownershipVerified: false
              }
            }
          : {})
      }))
    });
  } catch {
    return res.status(500).json({ message: 'Failed to load integrations marketplace.' });
  }
}
async function startOAuth(req, res) {
  try {
    const provider = req.body?.provider;
    const adapter = getAdapter(provider);
    if (!adapter) return res.status(400).json({ message: 'Unsupported provider.' });
    if (adapter.getAuthMode() !== 'oauth2')
      return res.status(400).json({
        message: `${provider} uses manual connection instead of OAuth.`,
        authMode: 'manual',
        hints: adapter.getManualAuthHints?.()
      });
    const validation = adapter.validateConfig();
    if (!validation.ok)
      return res.status(400).json({
        message: `Missing OAuth config for ${provider}.`,
        missingConfig: validation.missing
      });
    tokens.keyring();
    const redirect = redirectUri(provider);
    const state = crypto.randomBytes(32).toString('hex');
    const authorizationUrl = adapter.getAuthorizationUrl({ state, redirectUri: redirect });
    await persistence.start(req.user._id, provider, state, redirect);
    return res.json({ provider, state, authorizationUrl, redirectUri: redirect });
  } catch (error) {
    return errorResponse(res, error, 'Failed to start OAuth flow.');
  }
}
async function finishOAuth(provider, code, state, owner) {
  const connection = await persistence.consumeState(provider, state, owner);
  if (!connection) throw Object.assign(Error('Invalid OAuth state.'), { status: 400 });
  const adapter = getAdapter(provider);
  return governance.run(connection.userId, async () => {
    const token = await adapter.exchangeCodeForToken({
      code,
      redirectUri: connection.oauthRedirectUri
    });
    const identity = await adapter.getExternalIdentity(token.accessToken);
    if (!trim(String(identity?.id || '')) || !trim(identity?.username) || !token.accessToken)
      throw Error('Provider identity unavailable.');
    if (
      token.expiresIn != null &&
      (!Number.isFinite(Number(token.expiresIn)) ||
        Number(token.expiresIn) <= 0 ||
        Number(token.expiresIn) > 31536000)
    )
      throw Error('Invalid token expiry.');
    governance.assertActive();
    return persistence.connect(
      connection.userId,
      provider,
      {
        status: 'connected',
        externalUsername: identity.username,
        externalAccountId: String(identity.id),
        ownershipVerified: true,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken || '',
        tokenType: token.tokenType || 'Bearer',
        tokenExpiresAt: token.expiresIn
          ? new Date(Date.now() + Number(token.expiresIn) * 1000)
          : null,
        scopes: String(token.scope || '')
          .split(/[\s,]+/)
          .filter(Boolean),
        metadata: {},
        lastSyncedAt: null
      },
      null,
      connection.oauthAttempt
    );
  });
}
async function oauthCallback(req, res) {
  try {
    const { provider, code, state } = req.body || {};
    const adapter = getAdapter(provider);
    if (!adapter || adapter.getAuthMode() !== 'oauth2')
      return res.status(400).json({ message: 'Unsupported provider.' });
    if (!trim(code) || code.length > 2048)
      return res.status(400).json({ message: 'OAuth code is required.' });
    const connection = await finishOAuth(provider, code, state, req.user._id);
    return res.json({
      message: `${provider} connected successfully.`,
      connection: {
        provider,
        status: connection.status,
        externalUsername: connection.externalUsername,
        lastSyncedAt: connection.lastSyncedAt
      }
    });
  } catch (error) {
    return errorResponse(res, error, 'Failed to complete OAuth callback.');
  }
}
async function githubOauthCallback(req, res) {
  try {
    if (!trim(req.query?.code) || req.query.code.length > 2048) throw Error();
    await finishOAuth('github', req.query.code, req.query.state);
    return res.redirect(302, `${frontend()}/app/integrations?success=github`);
  } catch {
    return res.redirect(302, `${frontend()}/app/integrations?error=callback_failed`);
  }
}
async function manualConnectProvider(req, res) {
  try {
    const { provider, externalUsername, apiKey } = req.body || {};
    const adapter = getAdapter(provider);
    if (!adapter) return res.status(400).json({ message: 'Unsupported provider.' });
    if (adapter.getAuthMode() !== 'manual')
      return res.status(400).json({ message: `${provider} requires OAuth connection.` });
    const identifier = trim(externalUsername);
    if (!identifier || identifier.length > (provider === 'certifications' ? 1000 : 300))
      return res.status(400).json({ message: 'Invalid manual connection value.' });
    if (
      !['portfolio', 'certifications'].includes(provider) &&
      !/^[a-zA-Z0-9][a-zA-Z0-9_.@\- ]{0,99}$/.test(identifier)
    )
      return res.status(400).json({ message: `Invalid ${provider} username.` });
    if (apiKey && (typeof apiKey !== 'string' || apiKey.length > 4096))
      return res.status(400).json({ message: 'Invalid credential.' });
    if (apiKey) tokens.keyring();
    const candidate = {
      provider,
      externalUsername: identifier,
      accessToken: trim(apiKey),
      refreshToken: '',
      status: 'connected'
    };
    const operation = await persistence.beginManual(req.user._id, provider);
    let ingested;
    try {
      ingested = await governance.run(req.user._id, async () => {
        const data = await adapter.ingestData(candidate);
        governance.assertActive();
        return data;
      });
    } catch (error) {
      return errorResponse(res, error, `Unable to validate the ${provider} connection.`);
    }
    const resourceObservation =
      provider === 'kaggle' && ingested.resourceOnly === true
        ? publicResources.normalize(ingested)
        : null;
    const providerInsight = resourceObservation
      ? null
      : {
          ...normalizeIngestion(provider, ingested),
          ownershipVerified: false,
          evidenceKind: provider === 'certifications' ? 'self-reported' : 'provider-observed'
        };
    const connection = await persistence.connect(
      req.user._id,
      provider,
      {
        ...candidate,
        externalAccountId: '',
        ownershipVerified: false,
        tokenExpiresAt: null,
        tokenType: 'Bearer',
        scopes: [resourceObservation ? 'public_resources' : 'public_profile'],
        metadata: {
          ...(resourceObservation
            ? { resourceObservation }
            : {
                profileScore: providerInsight.profileScore,
                activityScore: providerInsight.activityScore,
                totalSkillsDetected: providerInsight.inferredSkills.length
              })
        },
        lastSyncedAt: new Date()
      },
      providerInsight,
      operation.oauthAttempt
    );
    return res.json({
      message: `${provider} connected with manual credentials.`,
      connection: {
        provider,
        status: connection.status,
        externalUsername: connection.externalUsername
      }
    });
  } catch (error) {
    return errorResponse(res, error, 'Failed to connect provider manually.');
  }
}
async function ingestProviderData(req, res) {
  try {
    const provider = req.body?.provider;
    if (!getAdapter(provider)) return res.status(400).json({ message: 'Unsupported provider.' });
    const result = await sync.syncProviderForUser(req.user._id, provider, 'ingest');
    if (!result.ok)
      return errorResponse(
        res,
        { status: result.status || 400, message: result.error, retryAfter: result.retryAfter },
        'Sync failed.'
      );
    return res.json({
      provider,
      ingested: result.ingested,
      insight: result.insight,
      syncedAt: result.providerInsight.syncedAt
    });
  } catch {
    return res.status(500).json({ message: 'Failed to ingest provider data.' });
  }
}
async function syncNow(req, res) {
  try {
    const provider = req.body?.provider;
    if (provider) {
      const result = await sync.syncProviderForUser(req.user._id, provider, 'manual_sync');
      if (!result.ok)
        return errorResponse(
          res,
          { status: result.status || 400, message: result.error, retryAfter: result.retryAfter },
          'Sync failed.'
        );
      return res.json({
        message: `${provider} synced successfully.`,
        result: { ok: true, provider, providerInsight: result.providerInsight }
      });
    }
    const results = await sync.syncConnectedProvidersForUser(req.user._id, 'manual_sync_all');
    return res.json({
      message: 'Connected providers synced.',
      results: results.map(({ ingested, insight, ...result }) => result)
    });
  } catch {
    return res.status(500).json({ message: 'Failed to run sync now.' });
  }
}
async function getSyncTrends(req, res) {
  try {
    const input = Number(req.query.days || 7);
    const days = Number.isInteger(input) ? Math.max(1, Math.min(30, input)) : 7;
    const logs = await Log.find({
      userId: req.user._id,
      createdAt: { $gte: new Date(Date.now() - days * 86400000) }
    })
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();
    const groups = new Map();
    for (const log of logs) {
      if (!groups.has(log.provider)) groups.set(log.provider, []);
      groups.get(log.provider).push(log);
    }
    const trends = [...groups].map(([provider, rows]) => ({
      provider,
      latestProfileScore: Number(rows[0].profileScore || 0),
      latestActivityScore: Number(rows[0].activityScore || 0),
      latestConfidence: Number(rows[0].confidence || 0),
      trendDelta: Number(
        (rows[1]
          ? Number(rows[0].activityScore || 0) - Number(rows[1].activityScore || 0)
          : 0
        ).toFixed(2)
      ),
      syncCount: rows.length,
      successRate: Number(
        ((rows.filter((row) => row.status === 'success').length / rows.length) * 100).toFixed(1)
      ),
      lastSyncedAt: rows[0].createdAt
    }));
    return res.json({ days, trends });
  } catch {
    return res.status(500).json({ message: 'Failed to load integration sync trends.' });
  }
}
async function githubWebhook(req, res) {
  try {
    const secret = trim(process.env.INTEGRATION_WEBHOOK_SECRET);
    const signature = req.headers['x-hub-signature-256'];
    if (
      !secret ||
      !Buffer.isBuffer(req.rawBody) ||
      typeof signature !== 'string' ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    )
      return res.status(401).json({ message: 'Invalid webhook signature.' });
    const digest = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
    if (!crypto.timingSafeEqual(digest, Buffer.from(signature.slice(7), 'hex')))
      return res.status(401).json({ message: 'Invalid webhook signature.' });
    const delivery = req.headers['x-github-delivery'];
    if (typeof delivery !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
      return res.status(400).json({ message: 'Invalid delivery ID.' });
    const event = req.headers['x-github-event'];
    if (!['push', 'repository', 'ping'].includes(event))
      return res.status(202).json({ message: 'Event ignored.' });
    const account = req.body?.repository?.owner?.id;
    if (event !== 'ping' && (!Number.isSafeInteger(account) || account <= 0))
      return res.status(400).json({ message: 'Invalid repository owner.' });
    let matched = 0;
    try {
      await persistence.transaction(async (session) => {
        // Payload hash also rejects replay with an attacker-modified unsigned delivery ID.
        await Connection.db.collection('integrationWebhookReceipts').insertMany(
          [
            { _id: `delivery:${governance.hash(delivery)}`, createdAt: new Date() },
            { _id: `body:${governance.hash(req.rawBody)}`, createdAt: new Date() }
          ],
          { session }
        );
        if (event !== 'ping') {
          const changed = await Connection.updateMany(
            {
              provider: 'github',
              status: { $in: ['connected', 'error'] },
              ownershipVerified: true,
              externalAccountId: String(account)
            },
            { $set: { nextSyncAt: new Date() } },
            { session }
          );
          matched = changed.matchedCount;
        }
      });
    } catch (error) {
      if (error.code === 11000)
        return res.json({ message: 'Webhook already processed.', matchedConnections: 0 });
      throw error;
    }
    return res.json({ message: 'Webhook processed.', matchedConnections: matched });
  } catch {
    return res.status(503).json({ message: 'Webhook processing failed.' });
  }
}
async function getIntegrationInsights(req, res) {
  try {
    return res.json({
      ...(await insights.getIntegrationInsight(req.user._id)),
      publicResources: await publicResources.getForUser(req.user._id)
    });
  } catch {
    return res.status(500).json({ message: 'Failed to load integration insights.' });
  }
}
async function getConnections(req, res) {
  try {
    const connections = await Connection.find({ userId: req.user._id })
      .select(
        'provider status externalUsername lastSyncedAt nextSyncAt lastSyncError createdAt updatedAt'
      )
      .lean();
    return res.json({ connections });
  } catch {
    return res.status(500).json({ message: 'Failed to load provider connections.' });
  }
}
async function disconnectProvider(req, res) {
  try {
    const provider = trim(req.params.provider).toLowerCase();
    const adapter = getAdapter(provider);
    if (!adapter) return res.status(400).json({ message: 'Unsupported provider.' });
    const previous = await persistence.disconnect(req.user._id, provider);
    let revocation = 'not_supported';
    if (previous?.accessToken && typeof adapter.revokeToken === 'function') {
      try {
        await governance.run(req.user._id, () =>
          adapter.revokeToken(tokens.open(previous).accessToken)
        );
        revocation = 'revoked';
      } catch {
        revocation = 'manual_revocation_required';
      }
    }
    return res.json({ message: `${provider} disconnected.`, revocation });
  } catch (error) {
    return errorResponse(res, error, 'Failed to disconnect provider.');
  }
}
module.exports = {
  getMarketplace,
  startOAuth,
  oauthCallback,
  githubOauthCallback,
  manualConnectProvider,
  ingestProviderData,
  syncNow,
  getSyncTrends,
  githubWebhook,
  getConnections,
  getIntegrationInsights,
  disconnectProvider
};
