'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startMongo } = require('./verifyIntegrationsRealProviders');
const mongoose = require('mongoose');
const cache = require('../services/redisCacheService');
const governance = require('../services/integrationGovernanceService');
const persistence = require('../services/integrationPersistenceService');
const sync = require('../services/integrationSyncService');
const { getAdapter } = require('../services/integrations');
const User = require('../models/user');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');
const root = path.resolve(__dirname, '../../verification/integrations');
const marketplaceOnly = process.argv.includes('--marketplace-only');
const outputOverride = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
if (outputOverride) assert.match(outputOverride, /^[a-z0-9-]+\.json$/);
const output = path.join(
  root,
  outputOverride ||
    (marketplaceOnly
      ? 'functional-marketplace-2026-10-27.json'
      : 'functional-controls-2026-10-27.json')
);
const result = {
  checkedAt: new Date().toISOString(),
  applicationDatabaseUsed: false,
  providerRequests: 0,
  checks: {}
};
let runtime;
let server;
async function verifyMarketplace(owner) {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const other = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id: other, name: 'Disposable other user', isActive: true });
  const rows = [
    ...JSON.parse(
      fs.readFileSync(path.join(root, 'real-provider-live-followup.json'))
    ).providers.filter((row) => row.stages.extractionPersistence === 'PASS'),
    JSON.parse(fs.readFileSync(path.join(root, 'real-provider-live-results.json'))).providers.find(
      (row) => row.provider === 'portfolio'
    )
  ];
  for (const row of rows) {
    const attempt = await persistence.beginManual(owner, row.provider);
    await persistence.connect(
      owner,
      row.provider,
      {
        status: 'connected',
        externalUsername: row.publicInput,
        ownershipVerified: false,
        accessToken: '',
        refreshToken: '',
        metadata: {}
      },
      row.persisted,
      attempt.oauthAttempt
    );
  }
  const source = JSON.parse(
    fs.readFileSync(path.join(root, 'kaggle-attribution-diagnostic-2026-10-27.json'))
  );
  const snapshot = require('../services/kaggleResourceObservationService').normalize({
    provider: 'kaggle',
    resourceOnly: true,
    profile: { username: 'dansbecker' },
    activity: { notebooks: source.notebooks, datasets: source.datasets }
  });
  const attempt = await persistence.beginManual(owner, 'kaggle');
  await persistence.connect(
    owner,
    'kaggle',
    {
      status: 'connected',
      externalUsername: 'dansbecker',
      ownershipVerified: false,
      accessToken: '',
      refreshToken: '',
      metadata: { resourceObservation: snapshot }
    },
    null,
    attempt.oauthAttempt
  );
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', require('../routes/integrations.routes'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/api/integrations';
  const token = (id) =>
    jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      expiresIn: '5m'
    });
  async function call(id, method, route) {
    const response = await fetch(origin + route, {
      method,
      headers: { Authorization: 'Bearer ' + token(id) }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return response.json();
  }
  const market = (await call(owner, 'GET', '/marketplace')).integrations;
  const unrelated = (await call(other, 'GET', '/marketplace')).integrations;
  result.marketplace = [];
  for (const provider of [
    'leetcode',
    'stackoverflow',
    'portfolio',
    'certifications',
    'devblogs',
    'kaggle'
  ]) {
    assert.equal(market.find((item) => item.provider === provider).status, 'connected');
    assert.equal(unrelated.find((item) => item.provider === provider).status, 'disconnected');
    await call(owner, 'DELETE', '/connections/' + provider);
    assert.equal(
      (await call(owner, 'GET', '/marketplace')).integrations.find(
        (item) => item.provider === provider
      ).status,
      'disconnected'
    );
    result.marketplace.push({ provider, connected: true, ownerIsolated: true, disconnected: true });
  }
  assert.equal(market.find((row) => row.provider === 'devblogs').name, 'Dev.to');
  assert.ok(!market.some((row) => row.provider === 'hashnode'));
  const hackerRank = market.find((row) => row.provider === 'hackerrank');
  if (hackerRank) assert.match(hackerRank.description, /unavailable/);
  assert.equal(
    market.find((row) => row.provider === 'kaggle').resourceSummary.ownershipVerified,
    false
  );
  result.checks.marketplaceStates =
    'PASS: authenticated isolated-user HTTP APIs for all six providers; no-store responses, owner isolation, retired-provider availability and disconnect';
  result.status = 'PASS';
}
async function main() {
  assert.ok(!fs.existsSync(output), 'Keep existing evidence');
  process.env.NODE_ENV = 'test';
  assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
  runtime = await startMongo();
  await mongoose.connect(runtime.uri, { autoIndex: false });
  for (const model of [User, Connection, Insight, Log]) await model.createCollection();
  await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
  await Insight.collection.createIndex({ userId: 1 }, { unique: true });
  const owner = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: owner,
    name: 'Disposable failure control',
    isActive: true
  });
  if (marketplaceOnly) return verifyMarketplace(owner);
  const prior = JSON.parse(
    fs.readFileSync(path.join(root, 'real-provider-live-followup.json'))
  ).providers.find((row) => row.provider === 'devblogs').persisted;
  const attempt = await persistence.beginManual(owner, 'devblogs');
  await persistence.connect(
    owner,
    'devblogs',
    {
      status: 'connected',
      externalUsername: 'hashnode@writer',
      accessToken: '',
      refreshToken: '',
      ownershipVerified: false,
      metadata: {}
    },
    prior,
    attempt.oauthAttempt
  );
  const before = JSON.stringify(await Insight.collection.findOne({ userId: owner }));
  const adapter = getAdapter('devblogs');
  const savedGet = adapter.get,
    savedPost = adapter.post;
  adapter.get = adapter.post = async () => assert.fail('Retired provider HTTP is forbidden');
  try {
    const failed = await sync.syncProviderForUser(owner, 'devblogs');
    assert.equal(failed.ok, false);
    assert.equal(failed.error, 'Provider sync failed.');
    const row = await Connection.findOne({ userId: owner, provider: 'devblogs' }).lean();
    // Existing policy preserves the last connected snapshot, records error/retry and clears lease.
    assert.equal(row.status, 'connected');
    assert.equal(row.lastSyncError, failed.error);
    assert.equal(row.leaseId, '');
    assert.equal(row.leaseUntil, null);
    assert.ok(row.nextSyncAt > new Date());
    assert.equal(JSON.stringify(await Insight.collection.findOne({ userId: owner })), before);
    assert.equal(await Log.countDocuments({ userId: owner, status: 'failed' }), 1);
    await assert.rejects(
      getAdapter('hackerrank').ingestData({ externalUsername: 'public-reference' }),
      /unavailable/
    );
    result.checks.retiredIngestion =
      'PASS: no HTTP; sanitized failure and scheduled retry; prior insight preserved';
  } finally {
    adapter.get = savedGet;
    adapter.post = savedPost;
  }
  const name = 'acceptance-' + crypto.randomUUID();
  const priorLimit = process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN;
  process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN = '1';
  let lease;
  try {
    lease = await governance.reserve(name, owner, 2000);
    await assert.rejects(governance.reserve(name, owner, 2000), (error) => error.status === 429);
  } finally {
    if (lease) await governance.finish(lease);
    if (priorLimit === undefined) delete process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN;
    else process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN = priorLimit;
  }
  result.checks.sharedAdmission =
    'PASS: real Upstash Lua/counters deny the second per-account request; unique synthetic provider, no quota resets';
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  const key = 'integrations:functional:' + crypto.randomUUID();
  await redis.set(key, JSON.stringify({ disposable: true }), { EX: 30 });
  assert.deepEqual(JSON.parse(await redis.get(key)), { disposable: true });
  result.checks.upstashCacheRoundTrip =
    'PASS at bounded 1000ms; unique task key expires after 30 seconds';
  const original = cache.getRedisCacheClient;
  cache.getRedisCacheClient = () => null;
  try {
    await persistence.disconnect(owner, 'devblogs');
  } finally {
    cache.getRedisCacheClient = original;
  }
  assert.equal((await Connection.findOne({ userId: owner }).lean()).status, 'disconnected');
  result.checks.safeDisconnect = 'PASS: owned Mongo transaction independent of Redis controls';
  result.oauth = {};
  for (const provider of ['github', 'linkedin']) {
    const key =
      provider === 'github' ? 'GITHUB_INTEGRATION_CALLBACK_URL' : 'LINKEDIN_OAUTH_REDIRECT_URI';
    const url = new URL(process.env[key]);
    result.oauth[provider] = {
      configurationPresent: getAdapter(provider).validateConfig().ok,
      callbackPathMatches:
        url.pathname ===
        (provider === 'github' ? '/api/integrations/github/callback' : '/app/integrations'),
      noEmbeddedCredentials: !url.username && !url.password,
      authenticatedAcceptance: 'BLOCKED: user interactive authorization and consent not provided'
    };
  }
  result.status = 'PASS';
}
main()
  .catch((error) => {
    result.status = 'FAIL';
    result.failure = { type: error.name, message: String(error.message).slice(0, 200) };
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cache.closeRedisCache();
    await mongoose.disconnect();
    if (runtime) result.cleanup = await runtime.stop();
    if (!fs.existsSync(output))
      fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(result));
  });
