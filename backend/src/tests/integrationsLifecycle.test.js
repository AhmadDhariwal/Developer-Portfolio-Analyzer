'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Connection = require('../models/integrationConnection');
const persistence = require('../services/integrationPersistenceService');
const { getAdapter } = require('../services/integrations');
const controller = require('../controllers/integrationscontroller');
const router = require('../routes/integrations.routes');
const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});
test('private integrations endpoints retain JWT protection and external boundaries have admission controls', () => {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const route = layer.route;
    const handlers = route.stack.map((item) => item.handle);
    if (['/github/callback', '/webhooks/github'].includes(route.path)) {
      assert.equal(handlers.length, 2);
      continue;
    }
    assert.equal(handlers[0].name, 'protect');
    if (Object.keys(route.methods)[0] === 'post') assert.equal(handlers.length, 3);
  }
});
test('connections read is owner scoped and never selects tokens or raw metadata', async (t) => {
  const original = Connection.find;
  t.after(() => (Connection.find = original));
  let filter, projection;
  Connection.find = (value) => {
    filter = value;
    return {
      select: (value) => {
        projection = value;
        return { lean: async () => [] };
      }
    };
  };
  const res = response();
  await controller.getConnections({ user: { _id: 'owner-a' } }, res);
  assert.deepEqual(filter, { userId: 'owner-a' });
  for (const field of ['accessToken', 'refreshToken', 'oauthState', 'metadata'])
    assert.ok(!projection.includes(field));
  assert.deepEqual(res.body, { connections: [] });
});
test('missing OAuth state cannot reach token exchange', async () => {
  const res = response();
  await controller.oauthCallback(
    { user: { _id: 'owner-a' }, body: { provider: 'github', code: 'fixture' } },
    res
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid OAuth state.');
});
test('manual validation rejects unsupported providers and malformed handles', async () => {
  for (const [provider, externalUsername] of [
    ['unknown', 'fixture'],
    ['leetcode', '<script>'],
    ['portfolio', 'ftp://example.com']
  ]) {
    const res = response();
    await controller.manualConnectProvider(
      { user: { _id: 'owner-a' }, body: { provider, externalUsername } },
      res
    );
    assert.equal(res.statusCode, 400);
  }
});
test('manual connection persists observed provenance and hides API credentials', async (t) => {
  t.mock.method(persistence, 'reuseFreshManual', async () => null);
  t.mock.method(
    require('../services/integrationPublicSnapshotService'),
    'ingest',
    (adapter, connection) => adapter.ingestData(connection)
  );
  const adapter = getAdapter('leetcode');
  const original = {
    ingest: adapter.ingestData,
    begin: persistence.beginManual,
    connect: persistence.connect
  };
  t.after(() => {
    adapter.ingestData = original.ingest;
    persistence.beginManual = original.begin;
    persistence.connect = original.connect;
  });
  adapter.ingestData = async () => ({
    profile: { solvedProblems: 10 },
    activity: {},
    inferredSkills: ['Algorithms']
  });
  persistence.beginManual = async () => ({ oauthAttempt: 'nonce' });
  let captured;
  persistence.connect = async (owner, provider, values, insight, attempt) => {
    captured = { owner, provider, values, insight, attempt };
    return values;
  };
  const res = response();
  await controller.manualConnectProvider(
    { user: { _id: 'owner-a' }, body: { provider: 'leetcode', externalUsername: 'fixture' } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(captured.owner, 'owner-a');
  assert.equal(captured.attempt, 'nonce');
  assert.equal(captured.insight.ownershipVerified, false);
  assert.equal(captured.insight.evidenceKind, 'provider-observed');
  assert.ok(!JSON.stringify(res.body).includes('accessToken'));
});
test('disconnect calls the owned transactional boundary and reports local success without provider credentials', async (t) => {
  const original = persistence.disconnect;
  t.after(() => (persistence.disconnect = original));
  let args;
  persistence.disconnect = async (...value) => {
    args = value;
    return null;
  };
  const res = response();
  await controller.disconnectProvider(
    { user: { _id: 'owner-a' }, params: { provider: 'github' } },
    res
  );
  assert.deepEqual(args, ['owner-a', 'github']);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, 'github disconnected.');
});
