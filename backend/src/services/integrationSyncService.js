const mongoose = require('mongoose');
const IntegrationConnection = require('../models/integrationConnection');
const IntegrationSyncLog = require('../models/integrationSyncLog');
const { getAdapter } = require('./integrations');
const { normalizeIngestion } = require('./integrationNormalizationService');
const { upsertProviderInsight } = require('./integrationInsightService');

const SYNC_INTERVAL_MS = Math.max(60 * 1000, Number.parseInt(process.env.INTEGRATION_SYNC_INTERVAL_MS || '300000', 10));
const BATCH_SIZE = Math.max(1, Number.parseInt(process.env.INTEGRATION_SYNC_BATCH_SIZE || '10', 10));

let timer = null;
let isRunning = false;
const activeSyncs = new Set();

const safeSyncError = (message) => {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('token refresh')) return 'Token refresh failed.';
  if (normalized.includes('rate limit') || normalized.includes('429')) return 'Provider rate limit reached.';
  if (normalized.includes('timeout')) return 'Provider request timed out.';
  return 'Provider sync failed.';
};

const invalidateIntegrationDependents = (userId) => {
  try {
    require('../controllers/dashboardcontroller').invalidateDashboardSummaryCache(userId);
    require('./scenarioSimulatorService').invalidateContextCache(userId);
    require('./careerSprintService').invalidateCareerSprintCache(userId);
  } catch (error) {
    console.error('Integration sync cache invalidation error:', error.message);
  }
};

const computeNextSyncAt = () => {
  const min = Math.max(1, Number.parseInt(process.env.INTEGRATION_DEFAULT_SYNC_INTERVAL_MIN || '30', 10));
  return new Date(Date.now() + (min * 60 * 1000));
};

const buildDueConnectionFilter = (now = new Date()) => ({
  status: 'connected',
  $or: [
    { nextSyncAt: { $exists: false } },
    { nextSyncAt: null },
    { nextSyncAt: { $lte: now } }
  ]
});

const refreshTokenIfNeeded = async (connection, adapter) => {
  if (adapter.getAuthMode() !== 'oauth2') return connection;
  if (!connection.tokenExpiresAt) return connection;

  const expiresAt = new Date(connection.tokenExpiresAt).getTime();
  const now = Date.now();
  const thresholdMs = 60 * 1000;
  if (expiresAt > now + thresholdMs) return connection;

  if (!connection.refreshToken || typeof adapter.refreshAccessToken !== 'function') return connection;

  try {
    const refreshed = await adapter.refreshAccessToken({
      refreshToken: connection.refreshToken,
      accessToken: connection.accessToken
    });
    if (!refreshed?.accessToken) return connection;

    const tokenExpiresAt = refreshed.expiresIn
      ? new Date(Date.now() + (Number(refreshed.expiresIn) * 1000))
      : connection.tokenExpiresAt;

    await IntegrationConnection.findByIdAndUpdate(connection._id, {
      $set: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || connection.refreshToken,
        tokenType: refreshed.tokenType || connection.tokenType || 'Bearer',
        tokenExpiresAt
      }
    });

    return {
      ...connection,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || connection.refreshToken,
      tokenType: refreshed.tokenType || connection.tokenType || 'Bearer',
      tokenExpiresAt
    };
  } catch (error) {
    await IntegrationConnection.findByIdAndUpdate(connection._id, {
      $set: {
        status: 'error',
        lastSyncError: 'Token refresh failed.'
      }
    });
    throw new Error('Token refresh failed.');
  }
};

const logSync = async ({ userId, provider, status, reason, providerInsight, error = '' }) => {
  await IntegrationSyncLog.create({
    userId,
    provider,
    status,
    reason,
    profileScore: providerInsight?.profileScore || 0,
    activityScore: providerInsight?.activityScore || 0,
    confidence: providerInsight?.confidence || 0,
    error: error || ''
  });
};

const syncSingleConnection = async (connection, reason = 'polling') => {
  const provider = connection.provider;
  const adapter = getAdapter(provider);
  if (!adapter) return null;
  const syncKey = `${connection.userId}:${provider}`;
  if (activeSyncs.has(syncKey)) return { ok: false, provider, error: 'Sync already in progress.' };
  activeSyncs.add(syncKey);

  try {
    const hydratedConnection = await refreshTokenIfNeeded(connection, adapter);
    const ingested = await adapter.ingestData(hydratedConnection);
    const providerInsight = normalizeIngestion(provider, ingested);

    await upsertProviderInsight({ userId: connection.userId, providerInsight });

    await IntegrationConnection.findByIdAndUpdate(connection._id, {
      $set: {
        status: 'connected',
        metadata: {
          lastIngestion: ingested,
          totalSkillsDetected: providerInsight.inferredSkills.length,
          profileScore: providerInsight.profileScore,
          activityScore: providerInsight.activityScore
        },
        lastSyncedAt: new Date(),
        nextSyncAt: computeNextSyncAt(),
        lastSyncError: ''
      }
    });

    await logSync({
      userId: connection.userId,
      provider,
      status: 'success',
      reason,
      providerInsight
    });

    invalidateIntegrationDependents(connection.userId);

    return { ok: true, provider, providerInsight };
  } catch (error) {
    const safeError = safeSyncError(error.message);
    await IntegrationConnection.findByIdAndUpdate(connection._id, {
      $set: {
        status: 'error',
        nextSyncAt: computeNextSyncAt(),
        lastSyncError: safeError
      }
    });

    await logSync({
      userId: connection.userId,
      provider,
      status: 'failed',
      reason,
      error: safeError
    });

    return { ok: false, provider, error: safeError };
  } finally {
    activeSyncs.delete(syncKey);
  }
};

const syncDueConnections = async () => {
  if (isRunning) return;
  if (mongoose.connection.readyState !== 1) return;

  isRunning = true;
  try {
    const now = new Date();
    const due = await IntegrationConnection.find(buildDueConnectionFilter(now))
      .sort({ nextSyncAt: 1 })
      .limit(BATCH_SIZE)
      .lean();

    for (const connection of due) {
      await syncSingleConnection(connection, 'polling');
    }
  } catch (error) {
    console.error('Integration sync polling error:', error.message);
  } finally {
    isRunning = false;
  }
};

const startIntegrationSyncWorker = () => {
  if (timer) return;

  timer = setInterval(() => {
    syncDueConnections().catch((error) => {
      console.error('Integration sync worker tick failed:', error.message);
    });
  }, SYNC_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  console.log(`Integration sync worker started. Interval: ${SYNC_INTERVAL_MS}ms`);
};

const syncConnectedProvidersForUser = async (userId, reason = 'manual') => {
  const connections = await IntegrationConnection.find({ userId, status: 'connected' }).lean();
  const results = [];
  for (const connection of connections) {
    results.push(await syncSingleConnection(connection, reason));
  }
  return results;
};

const syncProviderForUser = async (userId, provider, reason = 'manual') => {
  const connection = await IntegrationConnection.findOne({ userId, provider, status: { $in: ['connected', 'error'] } }).lean();
  if (!connection) return { ok: false, provider, error: 'Connection not found or disconnected.' };
  return syncSingleConnection(connection, reason);
};

module.exports = {
  startIntegrationSyncWorker,
  syncConnectedProvidersForUser,
  syncProviderForUser,
  buildDueConnectionFilter
};
