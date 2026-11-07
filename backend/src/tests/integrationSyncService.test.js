'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const persistence = require('../services/integrationPersistenceService');
const governance = require('../services/integrationGovernanceService');
const { getAdapter } = require('../services/integrations');
const {
  syncProviderForUser,
  buildDueConnectionFilter
} = require('../services/integrationSyncService');
function fixture(t, ingest) {
  const savedJob = governance.withJob;
  governance.withJob = async (_provider, operation) => operation();
  t.after(() => (governance.withJob = savedJob));
  const adapter = getAdapter('leetcode');
  const originals = {
    claim: persistence.claim,
    commit: persistence.commit,
    fail: persistence.fail,
    ingest: adapter.ingestData
  };
  const writes = [];
  const failures = [];
  persistence.claim = async (owner, provider) => ({
    _id: 'id',
    userId: owner,
    provider,
    leaseId: 'owned',
    accessToken: '',
    refreshToken: ''
  });
  persistence.commit = async (connection, insight, metadata) => {
    writes.push({ connection, insight, metadata });
    return { integrationScore: 20, mergedSkills: insight.inferredSkills };
  };
  persistence.fail = async (connection, message, reason) =>
    failures.push({ connection, message, reason });
  adapter.ingestData = ingest;
  t.after(() => {
    Object.assign(persistence, {
      claim: originals.claim,
      commit: originals.commit,
      fail: originals.fail
    });
    adapter.ingestData = originals.ingest;
  });
  return { writes, failures };
}
test('sync routes provider data through the leased atomic commit', async (t) => {
  const { writes, failures } = fixture(t, async () => ({
    profile: { solvedProblems: 120 },
    activity: { easy: 50 },
    inferredSkills: ['Algorithms', 'algorithms']
  }));
  const result = await syncProviderForUser('owner-a', 'leetcode', 'manual_sync');
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(failures.length, 0);
  assert.equal(writes[0].connection.leaseId, 'owned');
  assert.equal(writes[0].insight.ownershipVerified, false);
  assert.equal(writes[0].metadata.reason, 'manual_sync');
});
test('provider failure is sanitized and never overwrites the persisted good insight', async (t) => {
  const { writes, failures } = fixture(t, async () => {
    throw Error('token=abc123 internal.provider.local');
  });
  const result = await syncProviderForUser('owner-a', 'leetcode');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Provider sync failed.');
  assert.equal(writes.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].message, 'Provider sync failed.');
});
test('an unclaimed connection never calls the provider', async (t) => {
  let calls = 0;
  fixture(t, async () => {
    calls++;
  });
  persistence.claim = async () => null;
  const result = await syncProviderForUser('owner-a', 'leetcode');
  assert.equal(result.status, 409);
  assert.equal(calls, 0);
});
test('plaintext credentials fail closed before external ingestion', async (t) => {
  let calls = 0;
  fixture(t, async () => {
    calls++;
  });
  persistence.claim = async () => ({
    userId: 'owner-a',
    provider: 'leetcode',
    accessToken: 'legacy-secret'
  });
  assert.equal((await syncProviderForUser('owner-a', 'leetcode')).ok, false);
  assert.equal(calls, 0);
});
test('polling retries errored connections and excludes live leases', () => {
  const now = new Date();
  const filter = buildDueConnectionFilter(now);
  assert.deepEqual(filter.status, { $in: ['connected', 'error'] });
  assert.equal(filter.$and[1].$or[1].leaseUntil.$lte, now);
});
