const test = require('node:test');
const assert = require('node:assert/strict');
const IntegrationConnection = require('../models/integrationConnection');
const IntegrationInsight = require('../models/integrationInsight');
const IntegrationSyncLog = require('../models/integrationSyncLog');
const { getAdapter } = require('../services/integrations');
const { syncProviderForUser, buildDueConnectionFilter } = require('../services/integrationSyncService');

const installModelMocks = (t, adapter, ingestData) => {
  const originals = {
    connectionFindOne: IntegrationConnection.findOne,
    connectionUpdate: IntegrationConnection.findByIdAndUpdate,
    insightFindOne: IntegrationInsight.findOne,
    insightCreate: IntegrationInsight.create,
    logCreate: IntegrationSyncLog.create,
    ingestData: adapter.ingestData
  };
  t.after(() => {
    IntegrationConnection.findOne = originals.connectionFindOne;
    IntegrationConnection.findByIdAndUpdate = originals.connectionUpdate;
    IntegrationInsight.findOne = originals.insightFindOne;
    IntegrationInsight.create = originals.insightCreate;
    IntegrationSyncLog.create = originals.logCreate;
    adapter.ingestData = originals.ingestData;
  });

  const updates = [];
  const logs = [];
  IntegrationConnection.findOne = () => ({ lean: async () => ({
    _id: 'connection-1', userId: 'owner-a', provider: adapter.provider, status: 'connected', externalUsername: 'mock-user'
  }) });
  IntegrationConnection.findByIdAndUpdate = async (_id, update) => { updates.push(update); };
  IntegrationInsight.findOne = async () => null;
  IntegrationInsight.create = async (payload) => payload;
  IntegrationSyncLog.create = async (payload) => { logs.push(payload); return payload; };
  adapter.ingestData = ingestData;
  return { updates, logs };
};

test('sync success updates connection, insight, and exactly one success log', async (t) => {
  const adapter = getAdapter('leetcode');
  const { updates, logs } = installModelMocks(t, adapter, async () => ({
    profile: { solvedProblems: 120 },
    activity: { easy: 50, medium: 40, hard: 10 },
    inferredSkills: ['Algorithms', 'algorithms']
  }));

  const result = await syncProviderForUser('owner-a', 'leetcode', 'manual_sync');
  assert.equal(result.ok, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'success');
  assert.equal(logs[0].reason, 'manual_sync');
  assert.ok(updates.some((update) => update.$set.status === 'connected' && update.$set.lastSyncedAt instanceof Date));
  assert.ok(updates.some((update) => update.$set.nextSyncAt instanceof Date && update.$set.lastSyncError === ''));
});

test('provider failure is sanitized and records one failed log', async (t) => {
  const adapter = getAdapter('leetcode');
  const { updates, logs } = installModelMocks(t, adapter, async () => {
    throw new Error('upstream secret token=abc123 from internal.provider.local');
  });

  const result = await syncProviderForUser('owner-a', 'leetcode', 'manual_sync');
  assert.deepEqual(result, { ok: false, provider: 'leetcode', error: 'Provider sync failed.' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].error, 'Provider sync failed.');
  assert.ok(updates.some((update) => update.$set.status === 'error' && update.$set.lastSyncError === 'Provider sync failed.'));
});

test('token refresh failure marks the connection as error without leaking provider details', async (t) => {
  const adapter = getAdapter('github');
  const originalRefresh = adapter.refreshAccessToken;
  const { updates, logs } = installModelMocks(t, adapter, async () => {
    throw new Error('ingest must not run after refresh failure');
  });
  t.after(() => { adapter.refreshAccessToken = originalRefresh; });
  adapter.refreshAccessToken = async () => { throw new Error('provider token expired: secret=abc123'); };
  IntegrationConnection.findOne = () => ({ lean: async () => ({
    _id: 'connection-1', userId: 'owner-a', provider: 'github', status: 'connected',
    accessToken: 'old-token', refreshToken: 'old-refresh', tokenExpiresAt: new Date(0)
  }) });

  const result = await syncProviderForUser('owner-a', 'github', 'manual_sync');
  assert.deepEqual(result, { ok: false, provider: 'github', error: 'Token refresh failed.' });
  assert.ok(updates.some((update) => update.$set.status === 'error' && update.$set.lastSyncError === 'Token refresh failed.'));
  assert.equal(logs[0].error, 'Token refresh failed.');
});

test('concurrent sync for the same owner/provider is deduplicated', async (t) => {
  const adapter = getAdapter('leetcode');
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { logs } = installModelMocks(t, adapter, async () => {
    await pending;
    return { profile: {}, activity: {}, inferredSkills: [] };
  });

  const first = syncProviderForUser('owner-a', 'leetcode', 'manual_sync');
  await Promise.resolve();
  const second = await syncProviderForUser('owner-a', 'leetcode', 'manual_sync');
  assert.deepEqual(second, { ok: false, provider: 'leetcode', error: 'Sync already in progress.' });
  release();
  assert.equal((await first).ok, true);
  assert.equal(logs.length, 1);
});

test('background polling filter selects only connected due connections', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');
  assert.deepEqual(buildDueConnectionFilter(now), {
    status: 'connected',
    $or: [
      { nextSyncAt: { $exists: false } },
      { nextSyncAt: null },
      { nextSyncAt: { $lte: now } }
    ]
  });
});
