'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

test(
  'Mongo governance: Redis-disabled lifecycle, quotas, workers, recovery and security',
  { timeout: 90000 },
  async (t) => {
    const originalEnv = { ...process.env };
    const { startMongo } = require('./fixtures/disposableRequestMongo');
    const runtime = await startMongo();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      INTEGRATION_TEST_URI: runtime.uri,
      REDIS_URL: 'redis://127.0.0.1:1',
      UPSTASH_REDIS_TOKEN: '',
      INTEGRATION_GLOBAL_CONCURRENCY: '2',
      INTEGRATION_PROVIDER_CONCURRENCY: '1',
      INTEGRATION_PROVIDER_REQUESTS_PER_MIN: '3',
      INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN: '2',
      INTEGRATION_ACTIONS_PER_MIN: '10',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      INTEGRATION_TOKEN_ACTIVE_KEY: 'fixture',
      GITHUB_INTEGRATION_CLIENT_ID: 'fixture-client',
      GITHUB_INTEGRATION_CLIENT_SECRET: 'fixture-client-secret',
      GITHUB_INTEGRATION_CALLBACK_URL: 'http://localhost:5000/api/integrations/github/callback',
      FRONTEND_URL: 'http://localhost:4200',
      INTEGRATION_TOKEN_KEYS: JSON.stringify({
        fixture: crypto.randomBytes(32).toString('base64'),
      }),
    });
    for (const name of [
      'GROQ_API_KEY',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'SENDGRID_API_KEY',
      'SMTP_PASS',
    ])
      delete process.env[name];
    delete process.env.INTEGRATION_GOVERNANCE_STORE;
    const cache = require('../services/redisCacheService');
    const governance = require('../services/integrationGovernanceService');
    const mongo = require('../services/integrationMongoGovernanceService');
    const State = require('../models/integrationGovernanceState');
    const Connection = require('../models/integrationConnection');
    const Insight = require('../models/integrationInsight');
    const Log = require('../models/integrationSyncLog');
    const User = require('../models/user');
    const axios = require('axios');
    let redisCalls = 0;
    const unavailableRedis = t.mock.method(cache, 'getRedisCacheClient', () => {
      redisCalls++;
      throw Error('Redis unavailable');
    });
    const recorded = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../verification/integrations/real-provider-live-followup.json'),
      ),
    )
      .providers.find((row) => row.provider === 'leetcode')
      .requests.at(-1).sample;
    let httpCalls = 0;
    t.mock.method(axios, 'post', async (url) => {
      httpCalls++;
      if (url === 'https://github.com/login/oauth/access_token')
        return {
          data: {
            access_token: 'fixture-oauth-access',
            refresh_token: 'fixture-oauth-refresh',
            expires_in: 3600,
          },
        };
      assert.equal(url, 'https://leetcode.com/graphql');
      return { data: { data: { matchedUser: recorded } } };
    });
    t.mock.method(axios, 'get', async (url) => {
      assert.equal(url, 'https://api.github.com/user');
      httpCalls++;
      return { data: { id: 42, login: 'fixture-github' } };
    });
    t.mock.method(axios, 'delete', async () => {
      throw Error('Unexpected provider HTTP');
    });
    const workers = [];
    let server;
    const evidence = {
      checkedAt: new Date().toISOString(),
      providerHttpRequests: 0,
      checks: [],
      performance: {},
    };
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      for (const worker of workers) await worker.stop();
      await cache.closeRedisCache();
      await mongoose.disconnect();
      evidence.redisGovernanceCalls = redisCalls;
      evidence.fixtureReplays = httpCalls;
      evidence.cleanup = await runtime.stop();
      for (const name of Object.keys(process.env))
        if (!(name in originalEnv)) delete process.env[name];
      Object.assign(process.env, originalEnv);
      fs.writeFileSync(
        process.env.INTEGRATION_GOVERNANCE_EVIDENCE_FILE ||
          path.resolve(
            __dirname,
            '../../verification/integrations/scalability-governance-regression.json',
          ),
        JSON.stringify(evidence, null, 2) + '\n',
      );
    });
    await mongoose.connect(runtime.uri, { autoIndex: false, serverSelectionTimeoutMS: 500 });
    for (const model of [Connection, Insight, Log, User]) await model.createCollection();
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    await Insight.collection.createIndex({ userId: 1 }, { unique: true });
    await mongo.initialize();
    evidence.indexes = await State.collection.indexes();

    async function worker() {
      const child = fork(
        path.resolve(__dirname, 'fixtures/integrationMongoGovernanceWorker.js'),
        [],
        {
          env: process.env,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      let id = 0;
      const api = {
        child,
        request(action, extra = {}) {
          const requestId = ++id;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              child.off('message', receive);
              reject(Error('Worker deadline'));
            }, 6000);
            const receive = (message) => {
              if (message.id !== requestId) return;
              clearTimeout(timer);
              child.off('message', receive);
              if (message.error)
                reject(
                  Object.assign(Error(message.error.message), { status: message.error.status }),
                );
              else resolve(message.value);
            };
            child.on('message', receive);
            child.send({ id: requestId, action, ...extra });
          });
        },
        async stop() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exit = new Promise((resolve) => child.once('exit', resolve));
          try {
            await api.request('stop');
          } finally {
            child.kill();
            await exit;
          }
        },
      };
      workers.push(api);
      await new Promise((resolve, reject) => {
        // Cold Windows module loading is setup work, separate from product request deadlines.
        const timer = setTimeout(() => reject(Error('Worker readiness deadline')), 45000);
        child.once('message', (message) => {
          clearTimeout(timer);
          message.ready ? resolve() : reject(Error('Worker failed'));
        });
      });
      return api;
    }
    const a = await worker(),
      b = await worker();
    const reserve = (provider, owner = 'fixture', duration = 60000) =>
      governance.reserve(provider, owner, duration);

    await t.test(
      'atomic provider/user budgets return 429 without spending denied admissions',
      async () => {
        for (let i = 0; i < 2; i++) await governance.finish(await reserve('budget', 'owner-a'));
        await assert.rejects(reserve('budget', 'owner-a'), { status: 429 });
        await governance.finish(await reserve('budget', 'owner-b'));
        await assert.rejects(reserve('budget', 'owner-c'), { status: 429 });
        assert.equal((await State.collection.findOne({ _id: 'budget:budget' })).count, 3);
        evidence.checks.push('provider/user 429; denied requests do not consume other counters');
      },
    );
    await t.test(
      'concurrent processes serialize provider/global leases and job admission',
      async () => {
        const results = await Promise.allSettled([
          a.request('reserve', { provider: 'race', owner: 'a' }),
          b.request('reserve', { provider: 'race', owner: 'b' }),
        ]);
        assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
        assert.equal(results.find((row) => row.status === 'rejected').reason.status, 429);
        const first = results.find((row) => row.status === 'fulfilled').value;
        const second = await reserve('other');
        await assert.rejects(reserve('global-full'), { status: 429 });
        await governance.finish(first);
        await governance.finish(second);
        const held = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Job barrier deadline')), 6000);
          const receive = (message) => {
            if (message.event !== 'jobHeld') return;
            clearTimeout(timer);
            a.child.off('message', receive);
            resolve();
          };
          a.child.on('message', receive);
        });
        const running = a.request('job', { provider: 'job-race', hold: true });
        try {
          await held;
          await assert.rejects(b.request('job', { provider: 'job-race' }), { status: 429 });
        } finally {
          a.child.send({ action: 'releaseJob', provider: 'job-race' });
          await running;
        }
        evidence.checks.push(
          'two worker processes: one provider winner; global cap; job cap; release',
        );
      },
    );
    await t.test(
      'lease/window expiry is logical, survives restart, and old tokens cannot release new leases',
      async () => {
        const old = await a.request('reserve', { provider: 'expiry', owner: 'owner' });
        await a.stop();
        await assert.rejects(b.request('reserve', { provider: 'expiry', owner: 'owner' }), {
          status: 429,
        });
        for (const key of old.keys)
          await State.collection.updateOne(
            { _id: key },
            { $set: { expiresAt: new Date(0), 'leases.0.until': new Date(0) } },
          );
        const current = await b.request('reserve', { provider: 'expiry', owner: 'owner' });
        await governance.finish(old);
        await assert.rejects(reserve('expiry'), { status: 429 });
        await governance.finish(current);
        await State.collection.updateOne(
          { _id: 'budget:budget' },
          { $set: { expiresAt: new Date(0) } },
        );
        await governance.finish(await reserve('budget', 'new-owner'));
        evidence.checks.push(
          'logical expiry independent of TTL sweep; crash/restart leases; stale-token fencing',
        );
      },
    );
    await t.test(
      'success backoff, Retry-After, auth failures and repeated failures retain cooldowns',
      async () => {
        const request = (provider, operation) =>
          governance.run('cooldown-owner', () => governance.request(provider, operation));
        for (const [provider, data] of [
          ['backoff', { backoff: 1 }],
          ['zero-quota', { quota_remaining: 0 }],
        ]) {
          await request(provider, async () => ({ data }));
          await assert.rejects(reserve(provider), { status: 429 });
        }
        await request('header-quota', async () => ({
          headers: { 'x-ratelimit-remaining': '0', 'retry-after': '120' },
        }));
        await assert.rejects(reserve('header-quota'), { status: 429 });
        for (const status of [401, 403, 429]) {
          await assert.rejects(
            request(`status-${status}`, async () => {
              throw Object.assign(Error('fixture'), {
                response: { status, headers: { 'retry-after': '120' } },
              });
            }),
          );
          await assert.rejects(reserve(`status-${status}`), { status: 429 });
        }
        for (let i = 0; i < 3; i++)
          await assert.rejects(
            governance.run(`failure-owner-${i}`, () =>
              governance.request('failures', async () => {
                throw Error('fixture');
              }),
            ),
          );
        assert.ok(
          (await State.collection.findOne({ _id: 'cooldown:failures' })).expiresAt > new Date(),
        );
        evidence.checks.push(
          'payload/header backoff; 401/403/429; three failures; cooldown extension',
        );
      },
    );

    const owner = new mongoose.Types.ObjectId(),
      foreign = new mongoose.Types.ObjectId();
    await User.collection.insertMany(
      [owner, foreign].map((id, i) => ({
        _id: id,
        name: 'Fixture',
        email: `mongo-governance-${i}@invalid.test`,
        role: 'developer',
        isActive: true,
      })),
    );
    const express = require('express'),
      jwt = require('jsonwebtoken'),
      app = express();
    app.use(express.json());
    app.use('/api/integrations', require('../routes/integrations.routes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function call(route, body, actor = owner, method = 'POST') {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/integrations/${route}`,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(actor
              ? {
                  Authorization:
                    'Bearer ' +
                    jwt.sign({ id: String(actor) }, process.env.JWT_SECRET, {
                      issuer: 'devinsight-api',
                      audience: 'devinsight-web',
                    }),
                }
              : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      return { status: response.status, body: await response.json() };
    }
    await t.test(
      'authenticated Connect → Sync → Disconnect works with no Redis; owner and revision isolation remain',
      async () => {
        assert.equal(
          (await call('manual/connect', { provider: 'leetcode', externalUsername: 'lee215' }, null))
            .status,
          401,
        );
        const connected = await call('manual/connect', {
          provider: 'leetcode',
          externalUsername: 'lee215',
        });
        assert.equal(connected.status, 200, JSON.stringify(connected.body));
        const sync = await call('sync-now', { provider: 'leetcode' });
        assert.equal(sync.status, 200, JSON.stringify(sync.body));
        const snapshot = await Insight.findOne({ userId: owner }).lean();
        assert.ok(snapshot.providers.some((row) => row.provider === 'leetcode'));
        assert.equal(
          (await call('connections', undefined, foreign, 'GET')).body.connections.length,
          0,
        );
        const before = await b.request('cache', { owner: String(owner) });
        const cached = await b.request('cache', { owner: String(owner) });
        assert.equal(cached.counters.memoryHits, 1);
        await call('connections/leetcode', undefined, foreign, 'DELETE');
        assert.equal(
          (await Connection.findOne({ userId: owner, provider: 'leetcode' })).status,
          'connected',
        );
        const disconnected = await call('connections/leetcode', undefined, owner, 'DELETE');
        assert.equal(disconnected.status, 200, JSON.stringify(disconnected.body));
        const after = await b.request('cache', { owner: String(owner) });
        assert.notEqual(after.result.revision, before.result.revision);
        assert.equal(after.counters.pipelineExecutions, 1);
        evidence.checks.push(
          'real authenticated routes and captured lee215 fixture; owner isolation; cross-worker revision invalidation',
        );
      },
    );
    await t.test(
      'OAuth state ownership, replay rejection and encrypted credentials work without Redis',
      async () => {
        const started = await call('oauth/start', { provider: 'github' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const body = { provider: 'github', code: 'fixture-code', state: started.body.state };
        const before = httpCalls;
        assert.equal((await call('oauth/callback', body, foreign)).status, 400);
        assert.equal(httpCalls, before);
        const callback = await call('oauth/callback', body);
        assert.equal(callback.status, 200, JSON.stringify(callback.body));
        const connection = await Connection.findOne({ userId: owner, provider: 'github' }).lean();
        assert.match(connection.accessToken, /^enc:v1:/);
        assert.equal(connection.externalAccountId, '42');
        assert.equal((await call('oauth/callback', body)).status, 400);
        assert.equal(httpCalls - before, 2);
        evidence.checks.push(
          'OAuth state owner isolation/replay rejection; admitted token exchange/identity; encrypted persistence',
        );
      },
    );
    await t.test('duplicate sync claim and action limiter still reject safely', async () => {
      const persistence = require('../services/integrationPersistenceService');
      await Connection.updateOne(
        { userId: owner, provider: 'leetcode' },
        { $set: { status: 'connected', leaseUntil: null } },
      );
      const claimed = await persistence.claim(owner, 'leetcode');
      assert.ok(claimed);
      assert.equal(await persistence.claim(owner, 'leetcode'), null);
      await persistence.fail(claimed, 'fixture', 'test');
      const response = {
        code: 200,
        set() {},
        status(code) {
          this.code = code;
          return this;
        },
        json() {},
      };
      let next = 0;
      for (let i = 0; i < 11; i++)
        await governance.actionLimit('fixture-action')(
          { user: { _id: owner } },
          response,
          () => next++,
        );
      assert.equal(next, 10);
      assert.equal(response.code, 429);
      const priorCalls = httpCalls;
      await State.collection.replaceOne(
        { _id: `action:mutate:${governance.hash(owner)}` },
        {
          _id: `action:mutate:${governance.hash(owner)}`,
          count: 10,
          expiresAt: new Date(Date.now() + 60000),
        },
        { upsert: true },
      );
      assert.equal(
        (await call('manual/connect', { provider: 'leetcode', externalUsername: 'lee215' })).status,
        429,
      );
      assert.equal(httpCalls, priorCalls);
      evidence.checks.push('duplicate connection claim rejected; action 11 returns 429');
    });
    await t.test(
      'token encryption unchanged; unavailable authoritative Mongo returns 503 then recovers',
      async () => {
        const tokens = require('../services/integrationTokenService');
        const sealed = tokens.seal({
          userId: owner,
          provider: 'github',
          accessToken: 'fixture-secret',
          refreshToken: '',
        });
        assert.notEqual(sealed.accessToken, 'fixture-secret');
        assert.equal(
          tokens.open({ ...sealed, userId: owner, provider: 'github' }).accessToken,
          'fixture-secret',
        );
        assert.throws(() => tokens.open({ ...sealed, userId: foreign, provider: 'github' }));
        await mongoose.disconnect();
        let outbound = 0;
        await assert.rejects(
          governance.run('fixture', () => governance.request('mongo-down', async () => outbound++)),
          { status: 503 },
        );
        assert.equal(outbound, 0);
        const response = {
          code: 200,
          status(code) {
            this.code = code;
            return this;
          },
          json() {},
        };
        await governance.actionLimit('mongo-down')({ user: { _id: owner } }, response, () =>
          assert.fail('Must fail closed'),
        );
        assert.equal(response.code, 503);
        await mongoose.connect(runtime.uri, { autoIndex: false, serverSelectionTimeoutMS: 500 });
        await governance.finish(await reserve('mongo-recovered'));
        evidence.checks.push(
          'authenticated encryption/AAD isolation; Mongo 503 with zero outbound calls; reconnect recovery',
        );
      },
    );
    await t.test('polling uses Mongo job admission with Redis disabled', async () => {
      const connected = await call(
        'manual/connect',
        {
          provider: 'certifications',
          externalUsername: 'AWS Certified Solutions Architect',
        },
        foreign,
      );
      assert.equal(connected.status, 200, JSON.stringify(connected.body));
      await Connection.updateMany({}, { $set: { nextSyncAt: new Date(Date.now() + 3600000) } });
      await Connection.updateOne(
        { userId: foreign, provider: 'certifications' },
        { $set: { nextSyncAt: new Date(0) } },
      );
      await require('../services/integrationSyncService').syncDueConnections();
      assert.equal(
        await Log.countDocuments({
          userId: foreign,
          provider: 'certifications',
          reason: 'polling',
          status: 'success',
        }),
        1,
      );
      evidence.checks.push(
        'background polling admitted through Mongo; self-reported fixture persisted',
      );
    });
    await t.test(
      'admission failure returns HTTP 503 and selection never changes at runtime',
      async () => {
        const priorCalls = httpCalls;
        const unavailable = t.mock.method(State.collection, 'findOne', async () => {
          throw Error('fixture admission outage');
        });
        try {
          assert.equal(
            (await call('manual/connect', { provider: 'leetcode', externalUsername: 'lee215' }))
              .status,
            503,
          );
          assert.equal(httpCalls, priorCalls);
        } finally {
          unavailable.mock.restore();
        }
        process.env.INTEGRATION_GOVERNANCE_STORE = 'redis';
        try {
          await governance.finish(await reserve('fixed-store'));
        } finally {
          delete process.env.INTEGRATION_GOVERNANCE_STORE;
        }
        evidence.checks.push('HTTP 503 before provider work; immutable process store selection');
      },
    );
    await t.test(
      'Redis availability, exhaustion, timeout and restart do not control integration admission',
      async () => {
        assert.equal(redisCalls, 0);
        unavailableRedis.mock.restore();
        const { start } = require('./fixtures/integrationRedisCacheFixture');
        const beforeSnapshot = JSON.stringify(await Insight.findOne({ userId: owner }).lean());
        const priorIndexes = await Connection.collection.indexes();
        const priorLimits = [
          process.env.INTEGRATION_PROVIDER_REQUESTS_PER_MIN,
          process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN,
        ];
        process.env.INTEGRATION_PROVIDER_REQUESTS_PER_MIN = '60';
        process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN = '20';
        evidence.redisStates = [];
        try {
          for (const mode of ['healthy', 'unavailable', 'quota', 'timeout', 'recovered']) {
            const actor = new mongoose.Types.ObjectId();
            await User.collection.insertOne({
              _id: actor,
              name: 'Redis state fixture',
              email: `${actor}@invalid.test`,
              role: 'developer',
              isActive: true,
            });
            let fixture;
            const key = `integrations:cache-fixture:${crypto.randomUUID()}`;
            let cacheResult;
            try {
              if (mode === 'unavailable') {
                process.env.REDIS_URL = 'redis://127.0.0.1:1';
                cacheResult = (await cache.getCacheJsonWithMeta(key)).layer;
                assert.equal(cacheResult, 'miss');
              } else {
                fixture = await start(mode === 'recovered' ? 'healthy' : mode);
                process.env.REDIS_URL = fixture.url;
                assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
                if (mode === 'quota') {
                  await assert.rejects(
                    cache.getRedisCacheClient().set(key, 'fixture', { EX: 30 }),
                    /max requests limit exceeded/,
                  );
                  cacheResult = (await cache.getCacheJsonWithMeta(key)).layer;
                  assert.equal(cacheResult, 'miss');
                } else if (mode === 'timeout') {
                  const started = performance.now();
                  cacheResult = (await cache.getCacheJsonWithMeta(key)).layer;
                  assert.equal(cacheResult, 'miss');
                  assert.ok(performance.now() - started >= 140);
                } else {
                  await cache
                    .getRedisCacheClient()
                    .set(key, JSON.stringify({ valid: true }), { EX: 30 });
                  const read = await cache.getCacheJsonWithMeta(key);
                  cacheResult = read.layer;
                  assert.equal(cacheResult, 'redis');
                  assert.deepEqual(read.value, { valid: true });
                }
              }
              const before = (await State.collection.findOne({ _id: 'budget:leetcode' })).count;
              const body = { provider: 'leetcode', externalUsername: 'lee215' };
              const connected = await call('manual/connect', body, actor);
              assert.equal(connected.status, 200, JSON.stringify(connected.body));
              const synced = await call('sync-now', { provider: 'leetcode' }, actor);
              assert.equal(synced.status, 200, JSON.stringify(synced.body));
              const downstream = await call('insights', undefined, actor, 'GET');
              assert.equal(downstream.status, 200);
              assert.ok(downstream.body.providers.some((row) => row.provider === 'leetcode'));
              assert.ok(Number.isFinite(downstream.body.integrationScore));
              assert.equal(
                (await call('connections/leetcode', undefined, actor, 'DELETE')).status,
                200,
              );
              const after = (await State.collection.findOne({ _id: 'budget:leetcode' })).count;
              assert(
                after >= before && after <= before + 2,
                'Only actual HTTP attempts spend provider budgets',
              );
              const accountBudget = await State.collection.findOne({
                _id: `budget:leetcode:user:${governance.hash(actor)}`,
              });
              assert.equal(
                accountBudget.count,
                2,
                'Snapshot reuse must preserve the account request quota',
              );
              const commands = fixture?.commands || [];
              assert(!commands.some((command) => ['EVAL', 'INCR', 'ZADD'].includes(command)));
              evidence.redisStates.push({
                mode,
                cacheResult,
                connect: connected.status,
                sync: synced.status,
                downstream: downstream.status,
                before,
                after,
                cacheCommands: [...commands],
              });
            } finally {
              await fixture?.stop();
              await cache.closeRedisCache();
              cache.clearMemoryCache();
            }
          }
          assert.equal(
            JSON.stringify(await Insight.findOne({ userId: owner }).lean()),
            beforeSnapshot,
          );
          assert.deepEqual(await Connection.collection.indexes(), priorIndexes);
        } finally {
          [
            process.env.INTEGRATION_PROVIDER_REQUESTS_PER_MIN,
            process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN,
          ] = priorLimits;
        }
        evidence.checks.push(
          'five real cache-client states; Connect/Sync/downstream/disconnect; monotonically preserved Mongo counters; historical fixture snapshot/indexes unchanged',
        );
      },
    );
    await t.test('bounded Mongo admission performance sample', async () => {
      const values = [];
      let timing = false,
        reads = 0,
        writes = 0,
        replacements = 0;
      const originalRead = State.collection.findOne.bind(State.collection);
      const originalWrite = State.collection.replaceOne.bind(State.collection);
      const originalFind = State.collection.find.bind(State.collection);
      const originalBulk = State.collection.bulkWrite.bind(State.collection);
      const findMock = t.mock.method(State.collection, 'find', (...args) => {
        if (timing) reads++;
        return originalFind(...args);
      });
      const bulkMock = t.mock.method(State.collection, 'bulkWrite', (operations, ...args) => {
        if (timing) {
          writes++;
          replacements += operations.length;
        }
        return originalBulk(operations, ...args);
      });
      const readMock = t.mock.method(State.collection, 'findOne', (...args) => {
        if (timing) reads++;
        return originalRead(...args);
      });
      const writeMock = t.mock.method(State.collection, 'replaceOne', (...args) => {
        if (timing) {
          writes++;
          replacements++;
        }
        return originalWrite(...args);
      });
      try {
        for (let i = 0; i < 12; i++) {
          timing = true;
          const start = performance.now();
          const reservation = await reserve(`performance-${i}`);
          values.push(performance.now() - start);
          timing = false;
          await governance.finish(reservation);
        }
      } finally {
        timing = false;
        readMock.mock.restore();
        writeMock.mock.restore();
        findMock.mock.restore();
        bulkMock.mock.restore();
      }
      values.sort((a, b) => a - b);
      evidence.performance = {
        workload: '12 sequential admissions, release outside timing',
        n: values.length,
        p50Ms: values[5],
        p95Ms: values[11],
        p99Ms: values[11],
        samplesMs: values,
        collectionReads: reads,
        collectionReplacements: replacements,
        collectionWriteCommands: writes,
      };
      assert.equal(redisCalls, 0);
      evidence.checks.push('zero Redis governance calls; 12-admission bounded comparison');
    });
  },
);
