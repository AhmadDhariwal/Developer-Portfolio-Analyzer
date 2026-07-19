const test = require('node:test');
const assert = require('node:assert/strict');
const IntegrationConnection = require('../models/integrationConnection');
const IntegrationInsight = require('../models/integrationInsight');
const { getAdapter } = require('../services/integrations');
const controller = require('../controllers/integrationscontroller');
const integrationsRouter = require('../routes/integrations.routes');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
  redirect(code, location) { this.statusCode = code; this.location = location; return this; }
});

test('required Integrations API routes use JWT protection', () => {
  const required = new Set([
    'GET /marketplace',
    'GET /connections',
    'GET /insights',
    'POST /manual/connect',
    'POST /sync-now',
    'DELETE /connections/:provider'
  ]);

  for (const layer of integrationsRouter.stack) {
    if (!layer.route) continue;
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    const key = `${method} ${layer.route.path}`;
    if (!required.has(key)) continue;
    assert.equal(layer.route.stack[0].handle.name, 'protect', `${key} must run protect first`);
    required.delete(key);
  }
  assert.deepEqual([...required], []);
});

test('connections query is owner scoped and projects out every token/state field', async (t) => {
  const originalFind = IntegrationConnection.find;
  t.after(() => { IntegrationConnection.find = originalFind; });
  let filter;
  let projection;
  IntegrationConnection.find = (value) => {
    filter = value;
    return {
      select(valueToSelect) {
        projection = valueToSelect;
        return { lean: async () => [{ provider: 'github', status: 'connected', externalUsername: 'safe-user' }] };
      }
    };
  };

  const res = createResponse();
  await controller.getConnections({ user: { _id: 'owner-a' } }, res);

  assert.deepEqual(filter, { userId: 'owner-a' });
  for (const sensitive of ['accessToken', 'refreshToken', 'oauthState', 'oauthRedirectUri', 'metadata', 'scopes']) {
    assert.equal(projection.includes(sensitive), false, `${sensitive} must not be selected`);
    assert.equal(JSON.stringify(res.body).includes(sensitive), false, `${sensitive} must not be serialized`);
  }
});

test('OAuth callback rejects missing state before token exchange', async (t) => {
  const originalFindOne = IntegrationConnection.findOne;
  t.after(() => { IntegrationConnection.findOne = originalFindOne; });
  IntegrationConnection.findOne = () => ({ lean: async () => ({ oauthState: 'expected-state' }) });

  const res = createResponse();
  await controller.oauthCallback({
    user: { _id: 'owner-a' },
    body: { provider: 'github', code: 'mock-code' }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: 'Invalid OAuth state.' });
});

test('manual duplicate connect upserts by owner/provider and never returns API keys', async (t) => {
  const adapter = getAdapter('leetcode');
  const originals = {
    ingestData: adapter.ingestData,
    findOneAndUpdate: IntegrationConnection.findOneAndUpdate,
    insightFindOne: IntegrationInsight.findOne,
    insightCreate: IntegrationInsight.create
  };
  t.after(() => {
    adapter.ingestData = originals.ingestData;
    IntegrationConnection.findOneAndUpdate = originals.findOneAndUpdate;
    IntegrationInsight.findOne = originals.insightFindOne;
    IntegrationInsight.create = originals.insightCreate;
  });

  adapter.ingestData = async () => ({
    provider: 'leetcode',
    profile: { solvedProblems: 80 },
    activity: { easy: 30, medium: 20, hard: 5 },
    inferredSkills: ['Algorithms']
  });
  IntegrationInsight.findOne = async () => null;
  IntegrationInsight.create = async (payload) => payload;
  const calls = [];
  IntegrationConnection.findOneAndUpdate = (filter, update, options) => {
    calls.push({ filter, update, options });
    return { lean: async () => ({ provider: 'leetcode', status: 'connected', externalUsername: update.$set.externalUsername }) };
  };

  for (const username of ['first-user', 'updated-user']) {
    const res = createResponse();
    await controller.manualConnectProvider({
      user: { _id: 'owner-a' },
      body: { provider: 'leetcode', externalUsername: username, apiKey: 'secret-api-key' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.stringify(res.body).includes('secret-api-key'), false);
  }

  assert.equal(calls.length, 2);
  calls.forEach((call) => {
    assert.deepEqual(call.filter, { userId: 'owner-a', provider: 'leetcode' });
    assert.equal(call.options.upsert, true);
  });
  assert.equal(calls[1].update.$set.externalUsername, 'updated-user');
});

test('manual provider validation rejects unsupported and malformed identifiers', async () => {
  const unsupported = createResponse();
  await controller.manualConnectProvider({
    user: { _id: 'owner-a' },
    body: { provider: 'not-a-provider', externalUsername: 'mock-user' }
  }, unsupported);
  assert.equal(unsupported.statusCode, 400);
  assert.deepEqual(unsupported.body, { message: 'Unsupported provider.' });

  const malformed = createResponse();
  await controller.manualConnectProvider({
    user: { _id: 'owner-a' },
    body: { provider: 'leetcode', externalUsername: '<script>alert(1)</script>' }
  }, malformed);
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.body, { message: 'Invalid leetcode username.' });
});

test('Stack Overflow and Dev Blogs manual connections accept validated mocked provider data', async (t) => {
  const stackoverflow = getAdapter('stackoverflow');
  const devblogs = getAdapter('devblogs');
  const originals = {
    stackoverflowIngest: stackoverflow.ingestData,
    devblogsIngest: devblogs.ingestData,
    findOneAndUpdate: IntegrationConnection.findOneAndUpdate,
    insightFindOne: IntegrationInsight.findOne,
    insightCreate: IntegrationInsight.create
  };
  t.after(() => {
    stackoverflow.ingestData = originals.stackoverflowIngest;
    devblogs.ingestData = originals.devblogsIngest;
    IntegrationConnection.findOneAndUpdate = originals.findOneAndUpdate;
    IntegrationInsight.findOne = originals.insightFindOne;
    IntegrationInsight.create = originals.insightCreate;
  });
  IntegrationInsight.findOne = async () => null;
  IntegrationInsight.create = async (payload) => payload;
  IntegrationConnection.findOneAndUpdate = (filter, update) => ({
    lean: async () => ({ provider: filter.provider, status: 'connected', externalUsername: update.$set.externalUsername })
  });
  stackoverflow.ingestData = async () => ({ profile: { reputation: 1200, answerCount: 12, totalBadges: 4 }, activity: {}, inferredSkills: ['Node.js'] });
  devblogs.ingestData = async () => ({ profile: { brandingScore: 70, totalArticles: 4, totalReactions: 18 }, activity: {}, inferredSkills: ['TypeScript'] });

  for (const [provider, externalUsername] of [['stackoverflow', '123456'], ['devblogs', 'mock-blog']]) {
    const res = createResponse();
    await controller.manualConnectProvider({ user: { _id: 'owner-a' }, body: { provider, externalUsername } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connection.provider, provider);
  }
});

test('disconnect is owner scoped and clears all sensitive connection state', async (t) => {
  const originals = {
    findOneAndUpdate: IntegrationConnection.findOneAndUpdate,
    insightFindOne: IntegrationInsight.findOne
  };
  t.after(() => {
    IntegrationConnection.findOneAndUpdate = originals.findOneAndUpdate;
    IntegrationInsight.findOne = originals.insightFindOne;
  });
  let call;
  IntegrationConnection.findOneAndUpdate = async (filter, update, options) => { call = { filter, update, options }; };
  IntegrationInsight.findOne = async () => null;

  const res = createResponse();
  await controller.disconnectProvider({ user: { _id: 'owner-a' }, params: { provider: 'github' } }, res);

  assert.deepEqual(call.filter, { userId: 'owner-a', provider: 'github' });
  assert.equal(call.options.upsert, false);
  assert.deepEqual(call.update.$set, {
    status: 'disconnected',
    accessToken: '',
    refreshToken: '',
    tokenType: 'Bearer',
    tokenExpiresAt: null,
    scopes: [],
    metadata: {},
    lastSyncedAt: null,
    nextSyncAt: null,
    lastSyncError: '',
    oauthState: '',
    oauthStateExpiresAt: null,
    oauthRedirectUri: ''
  });
});
