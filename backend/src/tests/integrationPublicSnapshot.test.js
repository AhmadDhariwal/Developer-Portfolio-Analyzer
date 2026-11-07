'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const Module = require('node:module');

test(
  'public observations: isolation, fencing, quotas and bounded 1000-user simulation',
  { timeout: 120000 },
  async (t) => {
    const previousEnv = { ...process.env };
    const { startMongo } = require('../scripts/verifyIntegrationsRealProviders');
    const runtime = await startMongo();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      INTEGRATION_TEST_URI: runtime.uri,
      REDIS_URL: 'redis://127.0.0.1:1',
      UPSTASH_REDIS_TOKEN: ''
    });
    for (const name of [
      'INTEGRATION_GLOBAL_CONCURRENCY',
      'INTEGRATION_PROVIDER_CONCURRENCY',
      'INTEGRATION_PROVIDER_REQUESTS_PER_MIN',
      'INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN'
    ])
      delete process.env[name];
    const snapshots = require('../services/integrationPublicSnapshotService');
    const governance = require('../services/integrationGovernanceService');
    const State = require('../models/integrationGovernanceState');
    const Snapshot = require('../models/integrationPublicSnapshot');
    const Connection = require('../models/integrationConnection');
    const workers = [];
    const evidence = {
      checkedAt: new Date().toISOString(),
      providerHttpRequests: 0,
      checks: [],
      failures: []
    };
    t.after(async () => {
      for (const worker of workers) await worker.stop();
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      for (const name of Object.keys(process.env))
        if (!(name in previousEnv)) delete process.env[name];
      Object.assign(process.env, previousEnv);
      fs.writeFileSync(
        path.resolve(
          __dirname,
          '../../verification/integrations/final-scalability-acceptance.json'
        ),
        JSON.stringify(evidence, null, 2) + '\n'
      );
    });
    await mongoose.connect(runtime.uri, {
      autoIndex: false,
      monitorCommands: true,
      maxPoolSize: 8
    });
    await snapshots.initialize();
    await require('../services/integrationMongoGovernanceService').initialize();
    await Connection.createCollection();
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    let serial = 0;
    async function worker(uri = runtime.uri) {
      const child = fork(path.resolve(__dirname, 'fixtures/integrationScalabilityWorker.js'), [], {
        env: { ...process.env, INTEGRATION_TEST_URI: uri },
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      });
      const result = {
        child,
        request(action, extra = {}) {
          const id = ++serial;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              child.off('message', receive);
              reject(Error('Worker operation deadline'));
            }, 10000);
            const receive = (message) => {
              if (message.id !== id) return;
              clearTimeout(timer);
              child.off('message', receive);
              message.error ? reject(Error(message.error)) : resolve(message.value);
            };
            child.on('message', receive);
            child.send({ id, action, ...extra });
          });
        },
        async stop() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exit = new Promise((resolve) => child.once('exit', resolve));
          try {
            await result.request('stop');
          } finally {
            child.kill();
            await exit;
          }
        }
      };
      workers.push(result);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker readiness deadline')), 15000);
        child.once('message', (message) => {
          clearTimeout(timer);
          message.ready ? resolve() : reject(Error('Worker failed'));
        });
      });
      return result;
    }
    const stats = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (p) => sorted[Math.ceil(sorted.length * p) - 1];
      return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) };
    };
    const adapter = {
      provider: 'leetcode',
      getAuthMode: () => 'manual',
      async ingestData(connection) {
        return governance.request('projection-fixture', async () => ({
          profile: {
            username: connection.externalUsername,
            ranking: 1,
            reputation: 2,
            solvedProblems: 3,
            token: 'must-not-share'
          },
          activity: { easy: 1, medium: 1, hard: 1 },
          inferredSkills: ['Algorithms'],
          accessToken: 'must-not-share',
          ownershipVerified: true,
          profileScore: 999,
          raw: { secret: 'must-not-share' }
        }));
      }
    };

    await t.test('public allowlist, aliases and private/OAuth bypass remain safe', async () => {
      assert.equal(snapshots.identity('stackoverflow', { externalUsername: '00042' }), '42');
      assert.equal(snapshots.identity('stackoverflow', { externalUsername: 'display name' }), null);
      assert.equal(snapshots.identity('leetcode', { externalUsername: ' lee215 ' }), 'lee215');
      assert.equal(
        snapshots.identity('leetcode', { externalUsername: 'lee215', accessToken: 'private' }),
        null
      );
      for (const provider of ['github', 'linkedin', 'certifications', 'portfolio', 'kaggle'])
        assert.equal(snapshots.identity(provider, { externalUsername: 'same' }), null);
      const before = await Snapshot.collection.countDocuments();
      const privateAdapter = {
        provider: 'github',
        getAuthMode: () => 'oauth2',
        ingestData: async (connection) => ({ private: connection.accessToken })
      };
      assert.deepEqual(await snapshots.ingest(privateAdapter, { accessToken: 'owner-a' }), {
        private: 'owner-a'
      });
      assert.equal(await Snapshot.collection.countDocuments(), before);
      const result = await governance.run('projection-owner', () =>
        snapshots.ingest(adapter, { externalUsername: 'projection' })
      );
      assert(!JSON.stringify(result).includes('must-not-share'));
      assert(!Object.hasOwn(result, 'ownershipVerified'));
      const copy = await governance.run('other-owner', () =>
        snapshots.ingest(adapter, { externalUsername: 'projection' })
      );
      copy.profile.ranking = 999;
      assert.equal(
        (
          await governance.run('third-owner', () =>
            snapshots.ingest(adapter, { externalUsername: 'projection' })
          )
        ).profile.ranking,
        1
      );
      evidence.checks.push(
        'strict public fields; no raw/token/ownership/user score; private providers bypass; detached account copies'
      );
    });
    await t.test('freshness, invalidation, stale writes and lease expiry are fenced', async () => {
      const connection = { externalUsername: 'projection' },
        key = snapshots.keyFor('leetcode', 'projection');
      const current = await Snapshot.collection.findOne({ _id: key });
      await Snapshot.collection.updateOne({ _id: key }, { $set: { freshUntil: new Date(0) } });
      await governance.run('expiry-owner', () => snapshots.ingest(adapter, connection));
      assert((await Snapshot.collection.findOne({ _id: key })).freshUntil > current.freshUntil);
      await snapshots.invalidate('leetcode', 'projection');
      let started, release;
      const entered = new Promise((resolve) => {
        started = resolve;
      });
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      const slow = {
        ...adapter,
        async ingestData(value) {
          started();
          await blocked;
          return adapter.ingestData(value);
        }
      };
      const loading = governance.run('stale-owner', () => snapshots.ingest(slow, connection));
      await entered;
      await snapshots.invalidate('leetcode', 'projection');
      release();
      await assert.rejects(loading, { status: 409 });
      assert.equal((await Snapshot.collection.findOne({ _id: key })).freshUntil.getTime(), 0);
      await Snapshot.collection.updateOne(
        { _id: key },
        { $set: { leaseToken: 'dead-worker', leaseUntil: new Date(0) } }
      );
      await governance.run('recovered-owner', () => snapshots.ingest(adapter, connection));
      await Snapshot.collection.updateOne({ _id: key }, { $set: { freshUntil: new Date(0) } });
      const priorCost = (await State.collection.findOne({ _id: 'budget:projection-fixture' }))
        .count;
      let enteredClaim,
        resumeClaim,
        intercepted = false;
      const enteredUpdate = new Promise((resolve) => {
        enteredClaim = resolve;
      });
      const resumeUpdate = new Promise((resolve) => {
        resumeClaim = resolve;
      });
      const originalUpdate = Snapshot.collection.updateOne.bind(Snapshot.collection);
      const updateMock = t.mock.method(
        Snapshot.collection,
        'updateOne',
        async (filter, ...args) => {
          if (!intercepted && filter.leaseUntil?.$lte) {
            intercepted = true;
            enteredClaim();
            await resumeUpdate;
          }
          return originalUpdate(filter, ...args);
        }
      );
      const filename = path.resolve(__dirname, '../services/integrationPublicSnapshotService.js');
      const other = new Module(filename, module);
      other.filename = filename;
      other.paths = Module._nodeModulePaths(path.dirname(filename));
      other._compile(fs.readFileSync(filename, 'utf8'), filename);
      try {
        const first = governance.run('old-reader', () => snapshots.ingest(adapter, connection));
        await enteredUpdate;
        await governance.run('fresh-writer', () => other.exports.ingest(adapter, connection));
        resumeClaim();
        await first;
        assert.equal(
          (await State.collection.findOne({ _id: 'budget:projection-fixture' })).count,
          priorCost + 1
        );
      } finally {
        resumeClaim();
        updateMock.mock.restore();
      }
      evidence.checks.push(
        'fresh-only expiry; revision invalidation; stale leader fenced; expired dead-worker lease recovered'
      );
    });
    await t.test(
      'public adapters propagate admission errors instead of hiding them in fallbacks',
      async () => {
        const { getAdapter } = require('../services/integrations');
        for (const [provider, method, connection] of [
          ['leetcode', 'post', { externalUsername: 'fixture' }],
          ['stackoverflow', 'get', { externalUsername: '42' }],
          ['devblogs', 'get', { externalUsername: 'devto@fixture' }]
        ]) {
          const target = getAdapter(provider);
          const mock = t.mock.method(target, method, async () => {
            throw Object.assign(Error('limited'), { status: 429 });
          });
          try {
            await assert.rejects(target.ingestData(connection), { status: 429 });
          } finally {
            mock.mock.restore();
          }
        }
        evidence.checks.push('LeetCode, Stack Overflow and Dev.to preserve typed admission 429');
      }
    );
    await t.test('reuse preserves per-account quotas and fail-closed Mongo admission', async () => {
      const key = `budget:leetcode:user:${governance.hash('limited-owner')}`;
      await State.collection.insertOne({
        _id: key,
        count: 20,
        expiresAt: new Date(Date.now() + 60000)
      });
      await assert.rejects(
        governance.run('limited-owner', () =>
          snapshots.ingest(adapter, { externalUsername: 'projection' })
        ),
        { status: 429 }
      );
      assert.equal((await State.collection.findOne({ _id: key })).count, 20);
      const mock = t.mock.method(State.collection, 'findOne', async () => {
        throw Error('admission down');
      });
      try {
        await assert.rejects(
          governance.run('outage-owner', () =>
            snapshots.ingest(adapter, { externalUsername: 'projection' })
          ),
          { status: 503 }
        );
      } finally {
        mock.mock.restore();
      }
      evidence.checks.push(
        'cache hits spend account request budget; quota 429 and authoritative admission 503'
      );
    });
    await t.test('polling index experiment uses 1000 disposable connections', async () => {
      const now = new Date();
      await Connection.collection.insertMany(
        Array.from({ length: 1000 }, (_, i) => ({
          _id: new mongoose.Types.ObjectId(),
          userId: new mongoose.Types.ObjectId(),
          provider: 'leetcode',
          status: 'connected',
          nextSyncAt: new Date(now.getTime() + (i < 10 ? -1000 : 3600000)),
          leaseUntil: null
        }))
      );
      const filter = require('../services/integrationSyncService').buildDueConnectionFilter(now);
      const explain = () =>
        Connection.collection
          .find(filter)
          .sort({ nextSyncAt: 1 })
          .limit(10)
          .explain('executionStats');
      const before = await explain();
      await Connection.collection.createIndex(
        { status: 1, nextSyncAt: 1 },
        { name: 'integration_due_poll' }
      );
      const after = await explain();
      evidence.polling = {
        before: before.executionStats.totalDocsExamined,
        after: after.executionStats.totalDocsExamined,
        returned: after.executionStats.nReturned
      };
      assert(evidence.polling.after < evidence.polling.before);
      evidence.checks.push('measured due-poll index candidate without modifying existing indexes');
    });
    await t.test(
      'bounded two-worker simulation: 1000 users, 500 same public username',
      async () => {
        const baseline = await worker(
          runtime.uri.replace(
            '/integration_live_acceptance?',
            '/integration_live_acceptance_baseline?'
          )
        );
        for (let i = 0; i < 5; i++)
          assert.equal(
            (await baseline.request('baseline', { owner: `baseline-${i}`, username: 'common' }))
              .status,
            200
          );
        evidence.baseline = await baseline.request('stats');
        await baseline.stop();
        assert.equal(evidence.baseline.calls, 5);
        const a = await worker(),
          b = await worker();
        const results = [];
        const start = performance.now();
        for (let offset = 0; offset < 1000; ) {
          const size = Math.min(8, (offset < 500 ? 500 : 1000) - offset);
          const batch = await Promise.all(
            Array.from({ length: size }, (_, index) => {
              const user = offset + index;
              return (user % 2 ? a : b).request('ingest', {
                owner: `virtual-${user}`,
                username: user < 500 ? 'common' : `distinct-${user}`
              });
            })
          );
          results.push(...batch);
          offset += size;
          if (offset === 500) {
            const interim = await Promise.all([a.request('stats'), b.request('stats')]);
            evidence.shared500 = {
              served: results.filter((row) => row.status === 200).length,
              providerCalls: interim.reduce((sum, row) => sum + row.calls, 0)
            };
            assert.equal(evidence.shared500.providerCalls, 1);
            assert.equal(evidence.shared500.served, 500);
          }
        }
        const elapsedMs = performance.now() - start;
        const workerStats = await Promise.all([a.request('stats'), b.request('stats')]);
        const calls = workerStats.reduce((sum, row) => sum + row.calls, 0);
        const statusCounts = Object.fromEntries(
          [...new Set(results.map((row) => row.status))].map((status) => [
            status,
            results.filter((row) => row.status === status).length
          ])
        );
        assert.equal(statusCounts[503] || 0, 0);
        assert.equal(statusCounts[502] || 0, 0);
        assert(calls <= 60, 'Default provider budget must not be raised');
        const hits = (statusCounts[200] || 0) - calls;
        const storage = await mongoose.connection.db.command({
          collStats: Snapshot.collection.collectionName
        });
        evidence.simulation = {
          users: 1000,
          sameUsername: 500,
          concurrency: 8,
          workers: 2,
          elapsedMs,
          throughputPerSecond: 1000 / (elapsedMs / 1000),
          statusCounts,
          providerCalls: calls,
          observationsReused: hits,
          successfulHitRate: hits / (statusCounts[200] || 1),
          latencyMs: stats(results.map((row) => row.ms)),
          mongoCommandMs: stats(workerStats.flatMap((row) => row.durations)),
          transactionConflicts: workerStats.reduce((sum, row) => sum + row.conflicts, 0),
          redisCommands: workerStats.reduce((sum, row) => sum + row.redisCommands, 0),
          mongoCommands: workerStats.reduce((sum, row) => sum + row.commands, 0),
          memory: workerStats.map((row) => row.memory),
          snapshotStorage: {
            count: storage.count,
            logicalBytes: storage.size,
            indexBytes: storage.totalIndexSize
          }
        };
        assert.equal(evidence.simulation.redisCommands, 0);
        await a.stop();
        const recovered = await worker();
        assert.equal(
          (await recovered.request('ingest', { owner: 'after-worker-restart', username: 'common' }))
            .status,
          200
        );
        assert.equal((await recovered.request('stats')).calls, 0);
        evidence.checks.push(
          '1000 virtual users at concurrency eight; shared 500 fetched once; default quota/backpressure preserved; warm snapshot survives worker restart'
        );
      }
    );
  }
);
