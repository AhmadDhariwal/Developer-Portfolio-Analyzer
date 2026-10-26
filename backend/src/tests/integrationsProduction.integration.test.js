'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const fixture = require('./fixtures/integrationsRuntime');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');
const User = require('../models/user');
const persistence = require('../services/integrationPersistenceService');
const tokens = require('../services/integrationTokenService');
const governance = require('../services/integrationGovernanceService');
const cache = require('../services/redisCacheService');
const controller = require('../controllers/integrationscontroller');
const { getAdapter } = require('../services/integrations');
const { migrate } = require('../scripts/migrateIntegrationTokens');
const insights = require('../services/integrationInsightService');
const response = () => ({
  statusCode: 200,
  headers: {},
  set(k, v) {
    this.headers[k] = v;
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  redirect(code, url) {
    this.statusCode = code;
    this.url = url;
    return this;
  }
});
function worker(env) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'fixtures/integrationsWorker.js'), [], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    let next = 0;
    const pending = new Map();
    child.once('error', reject);
    child.on('message', (message) => {
      if ('ready' in message) {
        if (message.ready)
          resolve({
            child,
            request: (action, data = {}) =>
              new Promise((done, fail) => {
                const id = ++next;
                const timer = setTimeout(() => {
                  pending.delete(id);
                  fail(Error('Worker timeout.'));
                }, 20000);
                pending.set(id, (result) => {
                  clearTimeout(timer);
                  result.error
                    ? fail(Object.assign(Error(result.error.message), result.error))
                    : done(result.value);
                });
                child.send({ id, action, ...data });
              })
          });
        else reject(Error('Worker startup failed.'));
      } else {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
  });
}
test(
  'Integrations production acceptance on disposable Mongo replica set and Redis',
  { timeout: 120000 },
  async (t) => {
    const runtime = await fixture.start();
    const previousEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = runtime.redisUrl;
    process.env.INTEGRATION_TOKEN_ACTIVE_KEY = 'testA';
    process.env.INTEGRATION_TOKEN_KEYS = JSON.stringify({
      testA: crypto.randomBytes(32).toString('base64')
    });
    process.env.INTEGRATION_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.FRONTEND_URL = 'http://localhost:4200';
    process.env.GITHUB_INTEGRATION_CALLBACK_URL =
      'http://localhost:5000/api/integrations/github/callback';
    const workers = [];
    t.after(async () => {
      for (const item of workers) {
        if (item.child.connected) await item.request('stop').catch(() => item.child.kill());
      }
      await cache.closeRedisCache();
      await mongoose.disconnect();
      const cleanup = await runtime.stop();
      fs.writeFileSync(
        path.join(__dirname, '../../verification/integrations/cleanup.json'),
        JSON.stringify(cleanup, null, 2)
      );
      for (const key of Object.keys(process.env))
        if (!(key in previousEnv)) delete process.env[key];
      Object.assign(process.env, previousEnv);
    });
    await mongoose.connect(runtime.uri, { autoIndex: false });
    await cache.initRedisCache({ silent: true });
    await Promise.all([
      Connection.createCollection(),
      Insight.createCollection(),
      Log.createCollection(),
      User.createCollection()
    ]);
    await mongoose.connection.createCollection('integrationWebhookReceipts');
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    await Insight.collection.createIndex({ userId: 1 }, { unique: true });
    const owner = new mongoose.Types.ObjectId();
    const foreign = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      { _id: owner, name: 'Fixture', email: 'fixture@invalid.test', isActive: true },
      { _id: foreign, name: 'Other', email: 'other@invalid.test', isActive: true }
    ]);
    const proof = {
      provider: 'leetcode',
      profileScore: 70,
      activityScore: 80,
      confidence: 75,
      inferredSkills: ['Algorithms'],
      normalized: {},
      syncedAt: new Date(),
      ownershipVerified: false,
      evidenceKind: 'provider-observed'
    };
    const connect = (id = owner, provider = 'leetcode') =>
      persistence.connect(
        id,
        provider,
        {
          status: 'connected',
          externalUsername: 'fixture-user',
          accessToken: '',
          refreshToken: '',
          ownershipVerified: false,
          metadata: {}
        },
        null
      );
    await connect();
    await connect(foreign);
    workers.push(
      ...(await Promise.all([
        worker({ INTEGRATION_TEST_URI: runtime.uri }),
        worker({ INTEGRATION_TEST_URI: runtime.uri })
      ]))
    );
    const measurements = {};
    await t.test(
      'encryption authenticates owner/provider/field and fails closed for plaintext, tampering and missing keys',
      async () => {
        const sealed = tokens.encrypt('fixture-secret', owner, 'github', 'accessToken');
        assert.equal(tokens.decrypt(sealed, owner, 'github', 'accessToken'), 'fixture-secret');
        for (const args of [
          [foreign, 'github', 'accessToken'],
          [owner, 'linkedin', 'accessToken'],
          [owner, 'github', 'refreshToken']
        ])
          assert.throws(() => tokens.decrypt(sealed, ...args));
        assert.throws(() => tokens.decrypt('plaintext', owner, 'github', 'accessToken'));
        const parts = sealed.split(':');
        parts[4] = 'AAAAAAAAAAAAAAAAAAAAAA';
        assert.throws(() => tokens.decrypt(parts.join(':'), owner, 'github', 'accessToken'));
        const old = process.env.INTEGRATION_TOKEN_KEYS;
        process.env.INTEGRATION_TOKEN_KEYS = '{}';
        assert.throws(() => tokens.encrypt('x', owner, 'github', 'accessToken'));
        process.env.INTEGRATION_TOKEN_KEYS = old;
      }
    );
    await t.test('offline token migration dry run, CAS, idempotence and key rotation', async () => {
      await Connection.collection.updateOne(
        { userId: owner, provider: 'leetcode' },
        { $set: { accessToken: 'legacy-access', refreshToken: 'legacy-refresh' } }
      );
      assert.equal((await migrate(Connection.collection)).eligible, 1);
      assert.equal(
        (await Connection.findOne({ userId: owner, provider: 'leetcode' }).lean()).accessToken,
        'legacy-access'
      );
      assert.equal((await migrate(Connection.collection, { apply: true })).changed, 1);
      assert.equal((await migrate(Connection.collection, { apply: true })).changed, 0);
      const keys = JSON.parse(process.env.INTEGRATION_TOKEN_KEYS);
      keys.testB = crypto.randomBytes(32).toString('base64');
      process.env.INTEGRATION_TOKEN_KEYS = JSON.stringify(keys);
      process.env.INTEGRATION_TOKEN_ACTIVE_KEY = 'testB';
      assert.equal(
        (await migrate(Connection.collection, { apply: true, rotate: true })).changed,
        1
      );
      const migrated = await Connection.findOne({ userId: owner, provider: 'leetcode' }).lean();
      assert.equal(tokens.open(migrated).refreshToken, 'legacy-refresh');
      assert.ok(migrated.accessToken.startsWith('enc:v1:testB:'));
      process.env.INTEGRATION_TOKEN_ACTIVE_KEY = 'testA';
      await connect();
    });
    await t.test(
      'OAuth state is single-use across workers, owner scoped, provider scoped and expiring',
      async () => {
        const state = crypto.randomBytes(32).toString('hex');
        await persistence.start(owner, 'github', state, 'http://localhost:5000/callback');
        assert.equal(await persistence.consumeState('github', state, foreign), null);
        assert.equal(await persistence.consumeState('linkedin', state, owner), null);
        const results = await Promise.all([
          persistence.consumeState('github', state, owner),
          persistence.consumeState('github', state, owner)
        ]);
        assert.equal(results.filter(Boolean).length, 1);
        await persistence.start(owner, 'github', state, 'http://localhost:5000/callback');
        await Connection.updateOne(
          { userId: owner, provider: 'github' },
          { $set: { oauthStateExpiresAt: new Date(0) } }
        );
        assert.equal(await persistence.consumeState('github', state, owner), null);
      }
    );
    await t.test(
      'OAuth identity overrides client handles, invalid identity/expiry fails closed, redirect contract is stable',
      async () => {
        const adapter = getAdapter('github');
        const old = {
          exchange: adapter.exchangeCodeForToken,
          identity: adapter.getExternalIdentity
        };
        adapter.exchangeCodeForToken = async () => ({
          accessToken: 'fixture-oauth-token',
          refreshToken: '',
          expiresIn: 3600
        });
        adapter.getExternalIdentity = async () => ({ id: 42, username: 'verified-fixture' });
        try {
          const state = crypto.randomBytes(32).toString('hex');
          await persistence.start(
            owner,
            'github',
            state,
            'http://localhost:5000/api/integrations/github/callback'
          );
          const res = response();
          await controller.oauthCallback(
            {
              user: { _id: owner },
              body: { provider: 'github', code: 'fixture-code', state, username: 'attacker-handle' }
            },
            res
          );
          assert.equal(res.statusCode, 200);
          assert.equal(res.body.connection.externalUsername, 'verified-fixture');
          assert.ok(!JSON.stringify(res.body).includes('fixture-oauth-token'));
          const connected = await Connection.findOne({ userId: owner, provider: 'github' }).lean();
          assert.equal(connected.ownershipVerified, true);
          assert.equal(connected.externalAccountId, '42');
          const next = crypto.randomBytes(32).toString('hex');
          await persistence.start(
            owner,
            'github',
            next,
            'http://localhost:5000/api/integrations/github/callback'
          );
          adapter.getExternalIdentity = async () => ({ id: '', username: '' });
          const rejected = response();
          await controller.oauthCallback(
            { user: { _id: owner }, body: { provider: 'github', code: 'fixture', state: next } },
            rejected
          );
          assert.equal(rejected.statusCode, 500);
          assert.equal(await persistence.consumeState('github', next, owner), null);
          adapter.getExternalIdentity = async () => ({ id: 42, username: 'verified-fixture' });
          const expiring = crypto.randomBytes(32).toString('hex');
          await persistence.start(
            owner,
            'github',
            expiring,
            'http://localhost:5000/api/integrations/github/callback'
          );
          adapter.exchangeCodeForToken = async () => ({ accessToken: 'fixture', expiresIn: -1 });
          const expired = response();
          await controller.oauthCallback(
            {
              user: { _id: owner },
              body: { provider: 'github', code: 'fixture', state: expiring }
            },
            expired
          );
          assert.equal(expired.statusCode, 500);
          const redirect = crypto.randomBytes(32).toString('hex');
          await persistence.start(
            owner,
            'github',
            redirect,
            'http://localhost:5000/api/integrations/github/callback'
          );
          adapter.exchangeCodeForToken = async () => ({ accessToken: 'fixture', expiresIn: 3600 });
          const browser = response();
          await controller.githubOauthCallback(
            { query: { code: 'fixture', state: redirect } },
            browser
          );
          assert.equal(browser.url, 'http://localhost:4200/app/integrations?success=github');
          await persistence.disconnect(owner, 'github');
        } finally {
          adapter.exchangeCodeForToken = old.exchange;
          adapter.getExternalIdentity = old.identity;
        }
      }
    );
    await t.test(
      'two real workers deduplicate ingestion and write exactly one success record',
      async () => {
        const before = await Log.countDocuments({ userId: owner });
        const results = await Promise.all(
          workers.map((item) => item.request('sync', { owner: String(owner) }))
        );
        assert.equal(results.filter((result) => result.ok).length, 1);
        assert.equal(await Log.countDocuments({ userId: owner }), before + 1);
        assert.equal((await Insight.findOne({ userId: owner })).providers.length, 1);
      }
    );
    await t.test('overlapping OAuth token refresh is serialized across two workers', async () => {
      await persistence.connect(
        owner,
        'github',
        {
          status: 'connected',
          externalAccountId: '42',
          ownershipVerified: true,
          accessToken: 'old-fixture-token',
          refreshToken: 'old-fixture-refresh',
          tokenExpiresAt: new Date(0)
        },
        null
      );
      const result = await Promise.all(
        workers.map((item) => item.request('sync', { owner: String(owner), provider: 'github' }))
      );
      assert.equal(result.filter((row) => row.ok).length, 1);
      assert.equal(
        (await mongoose.connection.collection('fixtureRefreshCounts').findOne({ _id: 'refresh' }))
          .count,
        1
      );
      const connection = await Connection.findOne({ userId: owner, provider: 'github' }).lean();
      assert.equal(tokens.open(connection).refreshToken, 'rotated-fixture-refresh');
      assert.ok(!connection.refreshToken.includes('rotated-fixture-refresh'));
      await persistence.disconnect(owner, 'github');
    });
    await t.test(
      'abandoned lease recovery and stale-worker commit rejection preserve good insights',
      async () => {
        const stale = await workers[0].request('claim', { owner: String(owner) });
        await Connection.updateOne({ _id: stale._id }, { $set: { leaseUntil: new Date(0) } });
        const current = await workers[1].request('claim', { owner: String(owner) });
        assert.notEqual(stale.leaseId, current.leaseId);
        await assert.rejects(
          workers[0].request('commit', {
            connection: stale,
            insight: { ...proof, profileScore: 1 }
          }),
          /lease expired/
        );
        await workers[1].request('commit', { connection: current, insight: proof });
        assert.equal((await Insight.findOne({ userId: owner })).integrationScore, 75);
      }
    );
    await t.test(
      'concurrent providers serialize aggregate updates without losing either provider',
      async () => {
        await connect(owner, 'kaggle');
        const a = await persistence.claim(owner, 'leetcode');
        const b = await persistence.claim(owner, 'kaggle');
        await Promise.all([
          persistence.commit(a, proof, { reason: 'test' }),
          persistence.commit(
            b,
            { ...proof, provider: 'kaggle', inferredSkills: ['Python'] },
            { reason: 'test' }
          )
        ]);
        const snapshot = await Insight.findOne({ userId: owner }).lean();
        assert.equal(snapshot.providers.length, 2);
        assert.deepEqual(new Set(snapshot.mergedSkills), new Set(['Algorithms', 'Python']));
        assert.equal(snapshot.integrationScore, 75);
      }
    );
    await t.test(
      'disconnect and reconnect fence stale work and invalidate other-worker cache revisions',
      async () => {
        const before = await workers[1].request('cache', { owner: String(owner) });
        assert.equal(before.score, 75);
        const stale = await workers[0].request('claim', { owner: String(owner) });
        await workers[1].request('disconnect', { owner: String(owner) });
        await assert.rejects(
          workers[0].request('commit', { connection: stale, insight: proof }),
          /lease expired/
        );
        await connect(owner, 'kaggle');
        const after = await workers[1].request('cache', { owner: String(owner) });
        assert.equal(after.score, 0);
        const attempt = await persistence.beginManual(owner, 'leetcode');
        const newer = await persistence.beginManual(owner, 'leetcode');
        await assert.rejects(
          persistence.connect(
            owner,
            'leetcode',
            { status: 'connected', accessToken: '', refreshToken: '' },
            proof,
            attempt.oauthAttempt
          ),
          /changed/
        );
        await persistence.connect(
          owner,
          'leetcode',
          {
            status: 'connected',
            accessToken: '',
            refreshToken: '',
            externalUsername: 'new-handle'
          },
          proof,
          newer.oauthAttempt
        );
        assert.equal(
          (await Connection.findOne({ userId: owner, provider: 'leetcode' })).externalUsername,
          'new-handle'
        );
      }
    );
    await t.test(
      'signed webhook raw-body verification, payload replay and cross-worker delivery replay',
      async () => {
        await persistence.connect(
          owner,
          'github',
          {
            status: 'connected',
            accessToken: '',
            refreshToken: '',
            ownershipVerified: true,
            externalAccountId: '42'
          },
          null
        );
        const body = { repository: { owner: { id: 42 } } };
        const raw = JSON.stringify(body);
        const headers = {
          'x-hub-signature-256':
            'sha256=' +
            crypto
              .createHmac('sha256', process.env.INTEGRATION_WEBHOOK_SECRET)
              .update(raw)
              .digest('hex'),
          'x-github-event': 'push',
          'x-github-delivery': crypto.randomUUID()
        };
        const invalid = response();
        await controller.githubWebhook(
          {
            headers: { ...headers, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
            body,
            rawBody: Buffer.from(raw)
          },
          invalid
        );
        assert.equal(invalid.statusCode, 401);
        const calls = await Promise.all(
          workers.map((item) => item.request('webhook', { headers, body, raw }))
        );
        assert.equal(calls.filter((row) => row.body.matchedConnections === 1).length, 1);
        const replay = await workers[1].request('webhook', {
          headers: { ...headers, 'x-github-delivery': crypto.randomUUID() },
          body,
          raw
        });
        assert.equal(replay.body.matchedConnections, 0);
      }
    );
    await t.test(
      'provider quotas, circuit cooldown and global concurrency use shared atomic Redis',
      async () => {
        process.env.INTEGRATION_GLOBAL_CONCURRENCY = '2';
        const a = await governance.reserve('fixture', owner, 10000);
        const b = await governance.reserve('fixture', foreign, 10000);
        await assert.rejects(
          governance.reserve('fixture', owner, 10000),
          (error) => error.status === 429
        );
        await Promise.all([governance.finish(a), governance.finish(b)]);
        const c = await governance.reserve('fixture-cooldown', owner, 10000);
        await governance.finish(c, { response: { status: 429, headers: { 'retry-after': '2' } } });
        await assert.rejects(
          governance.reserve('fixture-cooldown', owner, 10000),
          (error) => error.status === 429
        );
        assert.equal(governance.retryAfter({ 'retry-after': '2' }), 2000);
        const dateDelay = governance.retryAfter({
          'retry-after': new Date(Date.now() + 10000).toUTCString()
        });
        assert.ok(dateDelay >= 8000 && dateDelay <= 10000);
        let release;
        const hold = new Promise((resolve) => (release = resolve));
        const jobs = [
          governance.withJob('fixture-jobs', () => hold),
          governance.withJob('fixture-jobs', () => hold)
        ];
        await new Promise((resolve) => setTimeout(resolve, 20));
        await assert.rejects(
          governance.withJob('fixture-jobs', async () => true),
          (error) => error.status === 429
        );
        release();
        await Promise.all(jobs);
        process.env.INTEGRATION_GLOBAL_CONCURRENCY = '8';
        process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN = '1';
        const d = await governance.reserve('fixture-user', owner, 1000);
        await governance.finish(d);
        await assert.rejects(
          governance.reserve('fixture-user', owner, 1000),
          (error) => error.status === 429
        );
        const e = await governance.reserve('fixture-user', foreign, 1000);
        await governance.finish(e);
        delete process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN;
      }
    );
    await t.test('bounded provider timeouts and no unsafe POST retries', async () => {
      let calls = 0;
      await assert.rejects(
        governance.run(owner, () =>
          governance.request('fixture-post', async (controls) => {
            calls++;
            assert.ok(controls.timeout <= 10000);
            assert.equal(controls.maxRedirects, 0);
            assert.equal(controls.proxy, false);
            throw { response: { status: 503 } };
          })
        )
      );
      assert.equal(calls, 1);
      process.env.INTEGRATION_ACTIONS_PER_MIN = '1';
      const middleware = governance.actionLimit('fixture-action');
      let passed = 0;
      const req = { user: { _id: owner } };
      await middleware(req, response(), () => passed++);
      const blocked = response();
      await middleware(req, blocked, () => passed++);
      assert.equal(passed, 1);
      assert.equal(blocked.statusCode, 429);
      assert.equal(blocked.headers['Retry-After'], '60');
      delete process.env.INTEGRATION_ACTIONS_PER_MIN;
    });
    await t.test(
      'real HTTP timeout aborts the provider socket within the configured bound',
      async () => {
        const http = require('node:http');
        const server = http.createServer(() => {});
        server.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        process.env.INTEGRATION_REQUEST_TIMEOUT_MS = '1000';
        const started = Date.now();
        try {
          await assert.rejects(
            governance.run(owner, () =>
              governance.request('fixture-timeout', (controls) =>
                require('axios').get('http://127.0.0.1:' + server.address().port, controls)
              )
            ),
            (error) => error.code === 'ECONNABORTED'
          );
          assert.ok(Date.now() - started < 4000);
        } finally {
          delete process.env.INTEGRATION_REQUEST_TIMEOUT_MS;
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      }
    );
    await t.test(
      'failed refresh/provider response preserves last known-good insight and sanitized history',
      async () => {
        const adapter = getAdapter('leetcode');
        const original = adapter.ingestData;
        adapter.ingestData = async () => {
          throw Error('secret=must-never-leak');
        };
        try {
          const before = await insights.getIntegrationInsight(owner);
          const result = await require('../services/integrationSyncService').syncProviderForUser(
            owner,
            'leetcode'
          );
          assert.equal(result.ok, false);
          assert.ok(!JSON.stringify(result).includes('must-never-leak'));
          assert.equal(
            (await insights.getIntegrationInsight(owner)).integrationScore,
            before.integrationScore
          );
          assert.equal(
            (await Connection.findOne({ userId: owner, provider: 'leetcode' })).status,
            'connected'
          );
        } finally {
          adapter.ingestData = original;
        }
      }
    );
    await t.test(
      'manual observed skills remain separate from ownership-verified downstream evidence',
      async () => {
        const signal =
          await require('../services/developerSignalService').summarizeIntegrationSignal(owner);
        assert.ok(signal.detectedSkills.includes('Algorithms'));
        assert.deepEqual(signal.verifiedSkills, []);
        assert.deepEqual(signal.strongestProof, []);
        assert.ok(signal.observedProviders.includes('leetcode'));
        const hash = require('../services/developerSignalService').buildSignalHash;
        const prior = hash({ integrationSignal: signal });
        await persistence.connect(
          owner,
          'github',
          {
            status: 'connected',
            accessToken: '',
            refreshToken: '',
            externalAccountId: '42',
            ownershipVerified: true
          },
          { ...proof, provider: 'github', ownershipVerified: true, inferredSkills: ['JavaScript'] }
        );
        const next = await require('../services/developerSignalService').summarizeIntegrationSignal(
          owner
        );
        assert.deepEqual(next.verifiedSkills, ['JavaScript']);
        assert.notEqual(hash({ integrationSignal: next }), prior);
        await persistence.disconnect(owner, 'github');
      }
    );
    await t.test('actual query plans before and after candidate indexes', async () => {
      const rows = Array.from({ length: 1200 }, (_, i) => ({
        userId: new mongoose.Types.ObjectId(),
        provider: 'leetcode',
        status: i % 2 ? 'connected' : 'disconnected',
        nextSyncAt: new Date(Date.now() + i * 60000),
        leaseUntil: null
      }));
      await Connection.collection.insertMany(rows);
      await Log.collection.insertMany(
        Array.from({ length: 1200 }, (_, i) => ({
          userId: i % 12 ? new mongoose.Types.ObjectId() : owner,
          provider: 'leetcode',
          createdAt: new Date(Date.now() - i * 60000),
          status: 'success'
        }))
      );
      const polling = require('../services/integrationSyncService').buildDueConnectionFilter(
        new Date(Date.now() + 600000)
      );
      const explain = async () => ({
        polling: await Connection.find(polling)
          .sort({ nextSyncAt: 1 })
          .limit(10)
          .explain('executionStats'),
        history: await Log.find({
          userId: owner,
          createdAt: { $gte: new Date(Date.now() - 86400000) }
        })
          .sort({ createdAt: -1 })
          .limit(5000)
          .explain('executionStats'),
        ownership: await Connection.findOne({ userId: owner, provider: 'leetcode' }).explain(
          'executionStats'
        )
      });
      const stateSample = require('node:crypto').randomBytes(32).toString('hex');
      await Connection.updateOne(
        { userId: foreign, provider: 'leetcode' },
        { $set: { oauthState: stateSample, oauthStateExpiresAt: new Date(Date.now() + 60000) } }
      );
      const callbacks = () =>
        Connection.find({
          provider: 'leetcode',
          oauthState: stateSample,
          oauthStateExpiresAt: { $gt: new Date() }
        }).explain('executionStats');
      const webhooks = () =>
        Connection.find({
          provider: 'github',
          ownershipVerified: true,
          externalAccountId: '42',
          status: { $in: ['connected', 'error'] }
        }).explain('executionStats');
      measurements.callbackBefore = await callbacks();
      measurements.webhookBefore = await webhooks();
      measurements.before = await explain();
      measurements.retentionBefore = await Log.collection
        .find({ expiresAt: { $lte: new Date() } })
        .limit(100)
        .explain('executionStats');
      await Connection.collection.createIndex(
        { status: 1, nextSyncAt: 1 },
        { name: 'integration_due_v1' }
      );
      await Log.collection.createIndex(
        { userId: 1, createdAt: -1 },
        { name: 'integration_history_v1' }
      );
      await Log.collection.createIndex(
        { expiresAt: 1 },
        { name: 'integration_retention_v1', expireAfterSeconds: 0 }
      );
      await Connection.collection.createIndex(
        { provider: 1, oauthState: 1 },
        { name: 'integration_oauth_state_v1', partialFilterExpression: { oauthState: { $gt: '' } } }
      );
      await Connection.collection.createIndex(
        { provider: 1, externalAccountId: 1 },
        {
          name: 'integration_webhook_identity_v1',
          partialFilterExpression: { ownershipVerified: true }
        }
      );
      measurements.callbackAfter = await callbacks();
      measurements.webhookAfter = await webhooks();
      assert.ok(
        JSON.stringify(measurements.callbackAfter.queryPlanner.winningPlan).includes(
          'integration_oauth_state_v1'
        )
      );
      assert.ok(
        JSON.stringify(measurements.webhookAfter.queryPlanner.winningPlan).includes(
          'integration_webhook_identity_v1'
        )
      );
      measurements.after = await explain();
      measurements.retentionAfter = await Log.collection
        .find({ expiresAt: { $lte: new Date() } })
        .limit(100)
        .explain('executionStats');
      assert.ok(
        JSON.stringify(measurements.retentionAfter.queryPlanner.winningPlan).includes(
          'integration_retention_v1'
        )
      );
      assert.ok((await Log.findOne({ userId: owner })).expiresAt instanceof Date);
      const stages = (value) => JSON.stringify(value.queryPlanner.winningPlan);
      assert.ok(stages(measurements.after.polling).includes('integration_due_v1'));
      assert.ok(stages(measurements.after.history).includes('integration_history_v1'));
      assert.ok(
        measurements.after.history.executionStats.totalDocsExamined <
          measurements.before.history.executionStats.totalDocsExamined
      );
      measurements.indexes = {
        connections: await Connection.collection.indexes(),
        insights: await Insight.collection.indexes(),
        history: await Log.collection.indexes()
      };
      const dir = path.join(__dirname, '../../verification/integrations');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'query-plans.json'), JSON.stringify(measurements, null, 2));
    });
    await t.test('JWT API reads enforce ownership and do not call providers', async () => {
      const express = require('express');
      const jwt = require('jsonwebtoken');
      const app = express();
      app.use(express.json({ verify: require('../middleware/integrationWebhookBody') }));
      app.use('/api/integrations', require('../routes/integrations.routes'));
      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
      const token = jwt.sign({ id: String(foreign) }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web'
      });
      try {
        const url = `http://127.0.0.1:${server.address().port}/api/integrations`;
        assert.equal((await fetch(url + '/connections')).status, 401);
        const raw = JSON.stringify({ zen: 'fixture-ping' });
        const headers = {
          'Content-Type': 'application/json',
          'x-github-event': 'ping',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256':
            'sha256=' +
            crypto
              .createHmac('sha256', process.env.INTEGRATION_WEBHOOK_SECRET)
              .update(raw)
              .digest('hex')
        };
        assert.equal(
          (await fetch(url + '/webhooks/github', { method: 'POST', headers, body: raw })).status,
          200
        );
        assert.equal(
          (await fetch(url + '/webhooks/github', { method: 'POST', headers, body: raw + ' ' }))
            .status,
          401
        );
        const reply = await fetch(url + '/connections', {
          headers: { Authorization: 'Bearer ' + token }
        });
        const body = await reply.json();
        assert.equal(reply.status, 200);
        assert.equal(body.connections.length, 1);
        assert.ok(!JSON.stringify(body).includes('accessToken'));
        assert.equal(
          (
            await (
              await fetch(url + '/insights', { headers: { Authorization: 'Bearer ' + token } })
            ).json()
          ).providers.length,
          0
        );
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
    await t.test(
      'account deletion removes integration data atomically and prevents worker resurrection',
      async () => {
        const lease = await persistence.claim(owner, 'leetcode');
        await persistence.deleteAccount(owner, (session) =>
          User.deleteOne({ _id: owner }, { session })
        );
        await assert.rejects(persistence.commit(lease, proof, { reason: 'test' }), /Account/);
        assert.equal(await Connection.countDocuments({ userId: owner }), 0);
        assert.equal(await Insight.countDocuments({ userId: owner }), 0);
        assert.equal(await Log.countDocuments({ userId: owner }), 0);
        assert.equal(await Connection.countDocuments({ userId: foreign }), 1);
      }
    );
    await t.test('Redis outage rejects admission without provider calls', async () => {
      await cache.closeRedisCache();
      let calls = 0;
      await assert.rejects(
        governance.run(foreign, () =>
          governance.request('fixture-outage', async () => {
            calls++;
          })
        ),
        (error) => error.status === 503
      );
      assert.equal(calls, 0);
      const res = response();
      await governance.actionLimit('outage')({ user: { _id: foreign } }, res, () => calls++);
      assert.equal(res.statusCode, 503);
      assert.equal(calls, 0);
    });
  }
);
