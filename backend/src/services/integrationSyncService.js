'use strict';
const mongoose = require('mongoose');
const Connection = require('../models/integrationConnection');
const { getAdapter } = require('./integrations');
const { normalizeIngestion } = require('./integrationNormalizationService');
const persistence = require('./integrationPersistenceService');
const tokens = require('./integrationTokenService');
const publicResources = require('./kaggleResourceObservationService');
const governance = require('./integrationGovernanceService');
let timer;
let running = false;
const safeError = (error) =>
  error.status === 503
    ? 'Integration controls temporarily unavailable.'
    : error.status === 429 || error.response?.status === 429
      ? 'Provider rate limit reached.'
      : error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED'
        ? 'Provider request timed out.'
        : 'Provider sync failed.';
const buildDueConnectionFilter = (now = new Date()) => ({
  status: { $in: ['connected', 'error'] },
  $and: [
    { $or: [{ nextSyncAt: null }, { nextSyncAt: { $lte: now } }] },
    { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }
  ]
});
async function syncProviderForUser(userId, provider, reason = 'manual') {
  const adapter = getAdapter(provider);
  if (!adapter) return { ok: false, provider, error: 'Unsupported provider.' };
  const connection = await persistence.claim(userId, provider);
  if (!connection)
    return {
      ok: false,
      provider,
      error: 'Connection unavailable or sync already in progress.',
      status: 409
    };
  try {
    return await governance.withJob(provider, () =>
      governance.run(userId, async () => {
        const hydrated = tokens.open(connection);
        let refreshed = null;
        if (
          adapter.getAuthMode() === 'oauth2' &&
          hydrated.tokenExpiresAt &&
          new Date(hydrated.tokenExpiresAt).getTime() < Date.now() + 60000
        ) {
          if (!hydrated.refreshToken) throw Error('Token refresh unavailable.');
          const token = await adapter.refreshAccessToken(hydrated);
          if (
            !token?.accessToken ||
            (token.expiresIn != null &&
              (!Number.isFinite(Number(token.expiresIn)) || Number(token.expiresIn) <= 0))
          )
            throw Error('Token refresh failed.');
          governance.assertActive();
          Object.assign(hydrated, {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken || hydrated.refreshToken,
            tokenType: token.tokenType || 'Bearer',
            tokenExpiresAt: token.expiresIn
              ? new Date(Date.now() + Number(token.expiresIn) * 1000)
              : null
          });
          // Persist rotated refresh credentials BEFORE ingestion, fenced by the same lease.
          refreshed = {
            ...tokens.seal(hydrated),
            tokenType: hydrated.tokenType,
            tokenExpiresAt: hydrated.tokenExpiresAt
          };
          const changed = await Connection.updateOne(persistence.leaseFilter(connection), {
            $set: refreshed
          });
          if (!changed.matchedCount)
            throw Object.assign(Error('Connection changed.'), { status: 409 });
        }
        const ingested = await adapter.ingestData(hydrated);
        governance.assertActive();
        const resourceOnly = provider === 'kaggle' && ingested.resourceOnly === true;
        const providerInsight = resourceOnly
          ? { provider, syncedAt: new Date(), inferredSkills: [] }
          : normalizeIngestion(provider, ingested);
        providerInsight.ownershipVerified = !resourceOnly && connection.ownershipVerified === true;
        providerInsight.evidenceKind = resourceOnly
          ? 'public-resources'
          : provider === 'certifications'
            ? 'self-reported'
            : 'provider-observed';
        const metadata = resourceOnly
          ? { reason, resourceObservation: publicResources.normalize(ingested) }
          : {
              reason,
              profileScore: providerInsight.profileScore,
              activityScore: providerInsight.activityScore,
              totalSkillsDetected: providerInsight.inferredSkills.length
            };
        const insight = await persistence.commit(
          connection,
          resourceOnly ? null : providerInsight,
          metadata,
          refreshed
        );
        return {
          ok: true,
          provider,
          providerInsight,
          ingested: {
            provider,
            profile: ingested.profile,
            activity: ingested.activity,
            inferredSkills: ingested.inferredSkills
          },
          insight: {
            integrationScore: insight.integrationScore,
            mergedSkills: insight.mergedSkills
          }
        };
      })
    );
  } catch (error) {
    const message = safeError(error);
    await persistence.fail(connection, message, reason);
    return {
      ok: false,
      provider,
      error: message,
      status: error.status || 502,
      retryAfter: error.retryAfter
    };
  }
}
async function syncConnectedProvidersForUser(userId, reason = 'manual') {
  const connections = await Connection.find({ userId, status: { $in: ['connected', 'error'] } })
    .select('provider')
    .limit(9)
    .lean();
  const results = [];
  for (const connection of connections)
    results.push(await syncProviderForUser(userId, connection.provider, reason));
  return results;
}
async function syncDueConnections() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const due = await Connection.find(buildDueConnectionFilter())
      .sort({ nextSyncAt: 1 })
      .limit(governance.integer('INTEGRATION_SYNC_BATCH_SIZE', 10, 1, 100))
      .select('userId provider')
      .lean();
    for (const item of due) await syncProviderForUser(item.userId, item.provider, 'polling');
  } catch {
    console.error('Integration polling failed.');
  } finally {
    running = false;
  }
}
function startIntegrationSyncWorker() {
  if (timer) return;
  timer = setInterval(
    () => {
      void syncDueConnections();
    },
    governance.integer('INTEGRATION_SYNC_INTERVAL_MS', 300000, 60000, 3600000)
  );
  timer.unref?.();
}
module.exports = {
  syncProviderForUser,
  syncConnectedProvidersForUser,
  startIntegrationSyncWorker,
  syncDueConnections,
  buildDueConnectionFilter
};
