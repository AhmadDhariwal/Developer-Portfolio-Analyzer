'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

test(
  'repeated Connect/Sync and optional Redis read-through audit',
  { timeout: 90000 },
  async (t) => {
    const previous = { ...process.env };
    const { startMongo } = require('../scripts/verifyIntegrationsRealProviders');
    const runtime = await startMongo();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:1',
      UPSTASH_REDIS_TOKEN: '',
      JWT_SECRET: crypto.randomBytes(32).toString('hex')
    });
    for (const name of [
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'GROQ_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY'
    ])
      delete process.env[name];
    const Connection = require('../models/integrationConnection'),
      Insight = require('../models/integrationInsight'),
      Log = require('../models/integrationSyncLog'),
      User = require('../models/user');
    const Snapshot = require('../models/integrationPublicSnapshot');
    const persistence = require('../services/integrationPersistenceService');
    const cache = require('../services/redisCacheService');
    const source = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../verification/integrations/real-provider-live-followup.json')
      )
    )
      .providers.find((row) => row.provider === 'leetcode')
      .requests.at(-1).sample;
    let calls = 0,
      normalizations = 0;
    const normalizer = require('../services/integrationNormalizationService');
    const normalize = normalizer.normalizeIngestion;
    t.mock.method(normalizer, 'normalizeIngestion', (...args) => {
      normalizations++;
      return normalize(...args);
    });
    t.mock.method(require('axios'), 'post', async (url) => {
      assert.equal(url, 'https://leetcode.com/graphql');
      calls++;
      return { data: { data: { matchedUser: source } } };
    });
    const evidence = { checkedAt: new Date().toISOString(), providerHttpRequests: 0, checks: [] };
    let server, phase;
    const measure = async (operation) => {
      const counter = { commands: 0, documentWrites: 0 },
        start = performance.now(),
        priorCalls = calls,
        priorNorm = normalizations;
      phase = counter;
      try {
        await operation();
      } finally {
        phase = null;
      }
      return {
        ...counter,
        ms: performance.now() - start,
        providerCalls: calls - priorCalls,
        normalizations: normalizations - priorNorm
      };
    };
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await cache.closeRedisCache();
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      for (const name of Object.keys(process.env))
        if (!(name in previous)) delete process.env[name];
      Object.assign(process.env, previous);
      fs.writeFileSync(
        path.resolve(
          __dirname,
          '../../verification/integrations/repeated-requests-cache-audit.json'
        ),
        JSON.stringify(evidence, null, 2) + '\n'
      );
    });
    await mongoose.connect(runtime.uri, { autoIndex: false, monitorCommands: true });
    mongoose.connection.getClient().on('commandStarted', (event) => {
      if (!phase) return;
      phase.commands++;
      const command = event.command;
      if (command.update) phase.documentWrites += (command.updates || []).length;
      if (command.findAndModify) phase.documentWrites++;
      if (command.insert) phase.documentWrites += (command.documents || []).length;
      if (command.delete) phase.documentWrites += (command.deletes || []).length;
    });
    for (const model of [Connection, Insight, Log, User]) await model.createCollection();
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    await Insight.collection.createIndex({ userId: 1 }, { unique: true });
    const owners = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId());
    await User.collection.insertMany(
      owners.map((id, index) => ({
        _id: id,
        name: 'Repeated fixture',
        email: `repeat-${index}@invalid.test`,
        role: 'developer',
        isActive: true
      }))
    );
    const app = require('express')();
    app.use(require('express').json());
    app.use('/api/integrations', require('../routes/integrations.routes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    async function request(
      route,
      actor = owners[0],
      body = { provider: 'leetcode', externalUsername: 'lee215' }
    ) {
      const token = require('jsonwebtoken').sign({ id: String(actor) }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web'
      });
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/integrations/${route}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body)
        }
      );
      return { status: response.status, body: await response.json() };
    }
    const stats = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        n: values.length,
        p50: sorted[Math.ceil(values.length * 0.5) - 1],
        p95: sorted[Math.ceil(values.length * 0.95) - 1],
        p99: sorted[Math.ceil(values.length * 0.99) - 1]
      };
    };
    async function stopFixture(fixture) {
      await fixture?.stop();
      // A timeout leaves an SDK reply waiter. Observe the socket's disconnect
      // before graceful cleanup, rather than racing QUIT behind that waiter.
      const deadline = Date.now() + 1000;
      while (fixture && cache.isRedisCacheEnabled() && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (fixture) assert.equal(cache.isRedisCacheEnabled(), false);
      await cache.closeRedisCache();
    }

    await t.test(
      'fresh same-account Connect is a no-op; Sync retains its mutation/history semantics',
      async () => {
        for (const owner of owners.slice(0, 2))
          assert.equal((await request('manual/connect', owner)).status, 200);
        assert.equal(calls, 1, 'Different accounts should reuse one fresh public observation');
        const noReuse = t.mock.method(persistence, 'reuseFreshManual', async () => null);
        try {
          evidence.baselineConnect = await measure(async () => {
            for (let i = 0; i < 3; i++)
              assert.equal((await request('manual/connect', owners[1])).status, 200);
          });
        } finally {
          noReuse.mock.restore();
        }
        const before = JSON.stringify(await Connection.findOne({ userId: owners[0] }).lean()),
          insight = JSON.stringify(await Insight.findOne({ userId: owners[0] }).lean());
        evidence.improvedConnect = await measure(async () => {
          for (let i = 0; i < 3; i++) assert.equal((await request('manual/connect')).status, 200);
        });
        assert.equal(
          JSON.stringify(await Connection.findOne({ userId: owners[0] }).lean()),
          before
        );
        assert.equal(JSON.stringify(await Insight.findOne({ userId: owners[0] }).lean()), insight);
        assert.equal(evidence.improvedConnect.normalizations, 0);
        assert(evidence.improvedConnect.documentWrites < evidence.baselineConnect.documentWrites);
        const logBefore = await Log.countDocuments({ userId: owners[0] });
        evidence.manualSync = await measure(async () => {
          for (let i = 0; i < 2; i++)
            assert.equal(
              (await request('sync-now', owners[0], { provider: 'leetcode' })).status,
              200
            );
        });
        assert.equal(await Log.countDocuments({ userId: owners[0] }), logBefore + 2);
        assert.equal(evidence.manualSync.providerCalls, 0);
        assert.equal(evidence.manualSync.normalizations, 2);
        evidence.checks.push(
          'three identical fresh Connect clicks preserve connection/insight; two explicit Syncs still normalize and append history; one source fetch across accounts'
        );
      }
    );
    await t.test(
      'Connect cannot clear or replace an active Sync lease; expired owned freshness is not a no-op',
      async () => {
        const claim = await persistence.claim(owners[0], 'leetcode');
        assert.ok(claim);
        const busy = await request('manual/connect');
        assert.equal(busy.status, 409);
        assert.equal((await Connection.findOne({ userId: owners[0] })).leaseId, claim.leaseId);
        await assert.rejects(persistence.beginManual(owners[0], 'leetcode'), { status: 409 });
        const attempt = await persistence.beginManual(owners[2], 'leetcode');
        await Connection.updateOne({ _id: attempt._id }, { $set: { status: 'connected' } });
        const raced = await persistence.claim(owners[2], 'leetcode');
        assert.ok(raced);
        await assert.rejects(
          persistence.connect(
            owners[2],
            'leetcode',
            { status: 'connected', accessToken: '', refreshToken: '', metadata: {} },
            null,
            attempt.oauthAttempt
          ),
          { status: 409 }
        );
        assert.equal((await Connection.findById(attempt._id)).leaseId, raced.leaseId);
        await persistence.fail(claim, 'fixture release', 'test');
        await Connection.updateOne(
          { userId: owners[0] },
          { $set: { lastSyncError: '', status: 'connected', lastSyncedAt: new Date(0) } }
        );
        assert.equal(
          await persistence.reuseFreshManual(owners[0], 'leetcode', {
            externalUsername: 'lee215',
            accessToken: ''
          }),
          null
        );
        assert.equal(
          await persistence.reuseFreshManual(owners[1], 'leetcode', {
            externalUsername: 'lee215',
            accessToken: 'credential'
          }),
          null
        );
        evidence.checks.push(
          'active lease returns 409 without reset; commit fence preserves a newly claimed Sync; stale/credential-bearing connections do not shortcut'
        );
      }
    );
    await t.test(
      'bounded optional read-through prototype retains Mongo validity and adds no production dependency',
      async () => {
        const { start } = require('./fixtures/integrationRedisCacheFixture');
        const {
          createCandidate,
          digest
        } = require('./fixtures/integrationRedisReadThroughCandidate');
        const documents = [512, 30000].map((size) => ({
          _id: `prototype-${size}`,
          generation: 1,
          freshUntil: new Date(Date.now() + 300000),
          expiresAt: new Date(Date.now() + 300000),
          observation: {
            provider: 'devblogs',
            profile: { username: 'synthetic' },
            activity: { recentArticles: [{ title: 'x'.repeat(size) }] }
          }
        }));
        for (const doc of documents) {
          doc.contentHash = digest(doc.observation);
          await Snapshot.collection.insertOne(doc);
        }
        evidence.readThrough = [];
        let fixture = await start();
        process.env.REDIS_URL = fixture.url;
        try {
          await cache.initRedisCache({ silent: true, probeOnly: true });
          const candidate = createCandidate(Snapshot.collection, () => cache.getRedisCacheClient());
          for (const doc of documents) {
            await candidate.warm(doc._id);
            const baseline = [],
              redis = [];
            const before = { ...candidate.counts };
            for (let i = 0; i < 12; i++) {
              let start = performance.now();
              assert.deepEqual(await candidate.baseline(doc._id), doc.observation);
              baseline.push(performance.now() - start);
              start = performance.now();
              assert.deepEqual(await candidate.read(doc._id), doc.observation);
              redis.push(performance.now() - start);
            }
            evidence.readThrough.push({
              payloadBytes: Buffer.byteLength(JSON.stringify(doc.observation)),
              mongoOnlyMs: stats(baseline),
              readThroughMs: stats(redis),
              mongoReads: candidate.counts.mongoReads - before.mongoReads,
              redisGets: candidate.counts.redisGets - before.redisGets
            });
          }
          const doc = documents[0];
          await Snapshot.collection.updateOne({ _id: doc._id }, { $inc: { generation: 1 } });
          assert.deepEqual(await candidate.read(doc._id), doc.observation);
          await candidate.drain();
          await Snapshot.collection.updateOne(
            { _id: doc._id },
            { $set: { freshUntil: new Date(0) } }
          );
          const gets = candidate.counts.redisGets;
          assert.equal(await candidate.read(doc._id), null);
          assert.equal(candidate.counts.redisGets, gets);
          await Snapshot.collection.updateOne(
            { _id: doc._id },
            { $set: { freshUntil: new Date(Date.now() + 300000) } }
          );
          evidence.prototypeCommands = { ...candidate.counts };
        } finally {
          await stopFixture(fixture);
        }
        for (const mode of ['quota', 'timeout', 'unavailable', 'recovered']) {
          fixture =
            mode === 'unavailable' ? null : await start(mode === 'recovered' ? 'healthy' : mode);
          try {
            if (fixture) {
              process.env.REDIS_URL = fixture.url;
              await cache.initRedisCache({ silent: true, probeOnly: true });
            }
            const candidate = createCandidate(Snapshot.collection, () =>
              cache.getRedisCacheClient()
            );
            const start = performance.now();
            assert.deepEqual(await candidate.read(documents[0]._id), documents[0].observation);
            (evidence.prototypeFailureModes ||= []).push({
              mode,
              ms: performance.now() - start,
              ...candidate.counts
            });
            await candidate.drain();
          } finally {
            await stopFixture(fixture);
          }
        }
        evidence.checks.push(
          'warm read-through measured at two payload sizes; generation mismatch falls back to Mongo; expired metadata bypasses Redis; quota/timeout/unavailable/recovered return authoritative data'
        );
      }
    );
  }
);
