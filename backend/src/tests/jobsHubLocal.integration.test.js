const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

// Opt-in only. Never read .env or reuse the application's database/Redis URL.
function localUrl(value, protocol) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, protocol);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'Integration tests require a local disposable service'
  );
  return value;
}
function load(relative, stubs) {
  const filename = path.resolve(__dirname, relative);
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (id) => (Object.hasOwn(stubs, id) ? stubs[id] : original(id));
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  return unit.exports;
}

test(
  'local Redis executes actual Lua for shared admission, cooldown, concurrency and ownership',
  {
    skip:
      !process.env.JOBS_TEST_REDIS_URL &&
      'Set JOBS_TEST_REDIS_URL to an isolated local Redis service'
  },
  async (t) => {
    const { createClient } = require('redis');
    const client = createClient({
      url: localUrl(process.env.JOBS_TEST_REDIS_URL, 'redis:'),
      socket: { reconnectStrategy: false, connectTimeout: 1500 }
    });
    client.on('error', () => {});
    await client.connect();
    const prefix = `jobs-test:${randomUUID()}:`;
    const owned = new Set();
    const key = (value) => {
      const scoped = prefix + value;
      owned.add(scoped);
      return scoped;
    };
    const adapter = {
      eval: (script, options) => client.eval(script, { ...options, keys: options.keys.map(key) }),
      set: (name, ...args) => client.set(key(name), ...args),
      del: (name) => client.del(key(name)),
      zRem: (name, token) => client.zRem(key(name), token),
      mGet: (names) => client.mGet(names.map(key))
    };
    t.after(async () => {
      assert.ok([...owned].every((name) => name.startsWith(prefix)));
      if (owned.size) await client.del([...owned]);
      await client.quit();
    });
    const governance = load('../services/jobGovernanceService.js', {
      './redisCacheService': { getRedisCacheClient: () => adapter }
    });
    const simultaneous = await Promise.all(
      Array.from({ length: 30 }, () => governance.reserve('arbeitnow'))
    );
    assert.equal(simultaneous.filter((entry) => entry.allowed).length, 1);
    const reservation = simultaneous.find((entry) => entry.allowed);
    await governance.finish(reservation, {
      status: 429,
      headers: { 'retry-after': '120' },
      failed: true
    });
    await adapter.del(`${reservation.base}:interval`);
    assert.equal((await governance.reserve('arbeitnow')).reason, 'cooldown');
    assert.equal((await governance.health()).arbeitnow.dailyUsed, 1);
    await adapter.del(`${reservation.base}:cooldown`);
    const next = await governance.reserve('arbeitnow');
    await adapter.del(`${reservation.base}:interval`);
    assert.equal((await governance.reserve('arbeitnow')).reason, 'concurrency');
    await governance.finish(next);
    await adapter.del(`${reservation.base}:interval`);
    const date = new Date().toISOString();
    await adapter.set(`${reservation.base}:day:${date.slice(0, 10)}`, '24');
    assert.equal((await governance.reserve('arbeitnow')).reason, 'daily_budget');
    await adapter.set(`${reservation.base}:day:${date.slice(0, 10)}`, '0');
    await adapter.set(`${reservation.base}:month:${date.slice(0, 7)}`, '1000');
    assert.equal((await governance.reserve('arbeitnow')).reason, 'monthly_budget');
    await governance.withLease('owner-check', 60, async () =>
      adapter.set('jobs:v2:lease:owner-check', 'new-owner', { EX: 60 })
    );
    assert.equal(await client.get(key('jobs:v2:lease:owner-check')), 'new-owner');
  }
);

test(
  'local Mongo verifies real upserts, owner isolation, persistence, expiry and cache indexes',
  {
    skip:
      !process.env.JOBS_TEST_MONGODB_URI &&
      'Set JOBS_TEST_MONGODB_URI to an isolated local MongoDB service'
  },
  async (t) => {
    const mongoose = require('mongoose');
    const database = `jobs_hub_test_${randomUUID().replaceAll('-', '')}`;
    const connection = await mongoose
      .createConnection(localUrl(process.env.JOBS_TEST_MONGODB_URI, 'mongodb:'), {
        dbName: database,
        autoIndex: false,
        serverSelectionTimeoutMS: 1500
      })
      .asPromise();
    t.after(async () => {
      assert.equal(connection.name, database);
      assert.ok(database.startsWith('jobs_hub_test_'));
      await connection.dropDatabase();
      await connection.close();
    });
    const JobCache = connection.model('JobCache', require('../models/jobCache').schema);
    const UserJobAction = connection.model(
      'UserJobAction',
      require('../models/userJobAction').schema
    );
    await Promise.all([JobCache.createIndexes(), UserJobAction.createIndexes()]);
    const [cacheIndexes, actionIndexes] = await Promise.all([
      JobCache.collection.indexes(),
      UserJobAction.collection.indexes()
    ]);
    assert.ok(
      cacheIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)
    );
    assert.ok(cacheIndexes.some((index) => index.key.jobId === 1 && index.unique === true));
    const cacheOrder = { lastSynced: -1, updatedAt: -1, _id: 1, expiresAt: 1 };
    assert.ok(
      cacheIndexes.some((index) => JSON.stringify(index.key) === JSON.stringify(cacheOrder))
    );
    assert.ok(
      actionIndexes.some(
        (index) => index.key.userId === 1 && index.key.jobId === 1 && index.unique === true
      )
    );
    assert.ok(actionIndexes.every((index) => index.expireAfterSeconds === undefined));
    const jobs = load('../services/jobService.js', {
      '../models/jobCache': JobCache,
      './platformSettingsService': { getIntegrationSecretsSync: () => ({}) }
    });
    const actions = load('../services/jobActionService.js', {
      '../models/userJobAction': UserJobAction,
      './jobService': jobs
    });
    const job = {
      id: 'integration',
      externalJobId: 'external-integration',
      title: 'Engineer',
      company: 'Example',
      source: 'Jooble',
      applyUrl: 'https://example.com/job'
    };
    assert.equal((await jobs.syncJobsToCache([job])).synced, 1);
    assert.equal((await jobs.loadCachedJobs({}, false)).length, 1);
    const owner = new mongoose.Types.ObjectId();
    const foreign = new mongoose.Types.ObjectId();
    await Promise.all(
      Array.from({ length: 15 }, () => actions.update(owner, job.id, { saved: true }))
    );
    assert.equal(await UserJobAction.countDocuments({ userId: owner }), 1);
    await actions.update(foreign, job.id, { hidden: true });
    assert.equal((await actions.forJobs(owner, [job.id]))[0].hidden, false);
    assert.equal((await actions.forJobs(foreign, [job.id]))[0].hidden, true);
    assert.equal((await actions.list(owner, { state: 'saved' })).actions[0].jobId, job.id);
    assert.equal((await actions.update(owner, job.externalJobId, { applied: true })).jobId, job.id);
    assert.equal(await UserJobAction.countDocuments({ userId: owner }), 1);
    await assert.rejects(
      actions.update(owner, job.id, { userId: foreign, saved: false }),
      (error) => error.status === 400
    );
    await assert.rejects(
      actions.update(owner, job.id, { $set: { saved: false } }),
      (error) => error.status === 400
    );
    assert.equal((await actions.forJobs(owner, [job.id]))[0].saved, true);
    await JobCache.updateOne({ jobId: job.id }, { $set: { freshUntil: new Date(0) } });
    assert.equal((await jobs.loadCachedJobs({}, false)).length, 0);
    assert.equal((await jobs.loadCachedJobs({}, true)).length, 1);
    await JobCache.updateOne({ jobId: job.id }, { $set: { validThrough: new Date(0) } });
    assert.equal((await jobs.loadCachedJobs({}, true)).length, 0);
    assert.equal(await jobs.findCachedJobById(job.id), null);
    assert.equal((await actions.update(owner, job.id, { applied: true })).applied, true);
    assert.equal((await actions.list(foreign, { state: 'saved' })).actions.length, 0);
    await JobCache.updateOne(
      { jobId: job.id },
      { $set: { validThrough: null, expiresAt: new Date(0) } }
    );
    assert.equal((await jobs.loadCachedJobs({}, true)).length, 0);
    assert.equal(await jobs.findCachedJobById(job.id), null);
    assert.equal((await actions.update(owner, job.id, { saved: false })).applied, true);
    assert.equal(await UserJobAction.countDocuments({ userId: owner }), 1);
    await assert.rejects(
      actions.update(new mongoose.Types.ObjectId(), job.id, { saved: true }),
      (error) => error.status === 404
    );
    t.diagnostic(
      JSON.stringify({
        cacheIndexes: cacheIndexes.map((index) => index.name),
        actionIndexes: actionIndexes.map((index) => index.name),
        concurrentOwnerUpserts: 15,
        ownerActionCount: await UserJobAction.countDocuments({ userId: owner }),
        databaseIsolation: database.startsWith('jobs_hub_test_')
      })
    );
  }
);
