const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./fixtures/publicPortfolioFixture');

test('both cleanup commands share the bounded worker; failures defer and do not stop other accounts', async () => {
  const updates = [];
  const calls = [];
  let selectedLimit;
  const worker = load('services/storageCleanupWorkerService.js', {
    '../models/accountDeletionCleanup': {
      find(filter) {
        assert.ok(filter.$or.some((part) => part.retryAfter?.$lte instanceof Date));
        return {
          sort() {
            return this;
          },
          select() {
            return this;
          },
          limit(value) {
            selectedLimit = value;
            return this;
          },
          lean() {
            return this;
          },
          async *cursor() {
            for (const id of ['failed', 'healthy']) yield { _id: id, createdAt: new Date(0) };
          }
        };
      },
      updateOne: async (...args) => updates.push(args)
    },
    './storedAssetService': {
      retryCleanup: async () => {
        throw Error('fixture provider outage');
      }
    },
    './accountDeletionService': {
      processCleanup: async (id, options) => {
        calls.push({ id, options });
        if (id === 'failed') throw Error('fixture legacy outage');
      }
    }
  });
  const summary = await worker.runBatch();
  assert.equal(selectedLimit, 50);
  assert.equal(summary.objectBatchLimit, 50);
  assert.equal(summary.accountReceiptsProcessed, 2);
  assert.equal(summary.failures, 2);
  assert.deepEqual(calls, [
    { id: 'failed', options: { deferObjects: true } },
    { id: 'healthy', options: { deferObjects: true } }
  ]);
  assert.equal(updates[0][1].$inc.cleanupAttempts, 1);
  assert.ok(updates[0][1].$set.retryAfter.getTime() > Date.now() + 59000);
  for (const name of ['retryStorageCleanup.js', 'retryAccountDeletionCleanup.js'])
    assert.match(
      require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../scripts', name),
        'utf8'
      ),
      /storageCleanupWorkerService/
    );
});

test('startup validates B2 before success logs and does not disclose JWT secret fragments', (t) => {
  const previous = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  for (const key of Object.keys(process.env)) if (key.startsWith('B2_')) delete process.env[key];
  process.env.JWT_SECRET = 'NEVER-PRINT-THIS-SECRET-OR-ITS-FRAGMENTS';
  process.env.STORAGE_DRIVER = 'filesystem';
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'warn', () => {});
  const env = load('config/env.js', {
    './newsConfig': {
      newsEnvShape: {},
      validateNewsRelationships() {},
      auditNewsConfiguration: () => ({ missing: [], deprecated: [] })
    }
  });
  env.validateEnv();
  assert.match(logs.join(' '), /JWT_SECRET=configured/);
  assert.ok(!logs.join(' ').includes('NEVER'));
  const count = logs.length;
  process.env.STORAGE_DRIVER = 'b2';
  assert.throws(() => env.validateEnv(), /configuration/);
  assert.equal(logs.length, count);
});

test('provisioning has explicit target gates and no implicit production URI', () => {
  const { target } = require('../scripts/provisionStorageCollections');
  assert.throws(() => target({ MONGODB_URI: 'mongodb://production.invalid' }, true));
  assert.throws(() =>
    target(
      {
        STORAGE_MAINTENANCE_MONGO_URI: 'mongodb://example.invalid/db',
        STORAGE_MAINTENANCE_DATABASE: 'admin'
      },
      false
    )
  );
  const env = {
    STORAGE_MAINTENANCE_MONGO_URI: 'mongodb://example.invalid/db',
    STORAGE_MAINTENANCE_DATABASE: 'explicit_staging'
  };
  assert.throws(() => target(env, true));
  assert.equal(
    target(
      {
        ...env,
        STORAGE_MAINTENANCE_ENV: 'staging',
        STORAGE_MAINTENANCE_ACK: 'authorized-staging-target'
      },
      true
    ).database,
    'explicit_staging'
  );
});

test(
  'disposable Mongo provisioning is additive/idempotent; retry batch respects backoff and preserves records',
  { skip: !process.env.STORAGE_SECURITY_MONGO, timeout: 60000 },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = process.env.STORAGE_SECURITY_MONGO;
    assert.equal(uri, 'mongodb://127.0.0.1:27141/?replicaSet=profileB2Security');
    const name = 'profile_b2_security_' + crypto.randomBytes(12).toString('hex');
    const env = { STORAGE_MAINTENANCE_MONGO_URI: uri, STORAGE_MAINTENANCE_DATABASE: name };
    const provisioner = require('../scripts/provisionStorageCollections');
    const Cleanup = require('../models/accountDeletionCleanup');
    const Asset = require('../models/storedAsset');
    t.after(async () => {
      if (mongoose.connection.readyState !== 1) await mongoose.connect(uri, { dbName: name });
      assert.equal(mongoose.connection.name, name);
      assert.match(name, /^profile_b2_security_[a-f0-9]{24}$/);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });
    const execute = require('node:util').promisify(require('node:child_process').execFile);
    const cliEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      MONGODB_URI: `mongodb://127.0.0.1:27141/${name}?replicaSet=profileB2Security`,
      STORAGE_DRIVER: 'filesystem'
    };
    const runCli = (file) =>
      execute(process.execPath, [require('node:path').join(__dirname, '../scripts', file)], {
        env: cliEnv,
        timeout: 20000,
        maxBuffer: 4096
      });
    await assert.rejects(
      runCli('retryStorageCleanup.js'),
      (error) => error.code === 1 && /durable receipts retained/.test(error.stderr)
    );
    const first = await provisioner.provision({ env, apply: true });
    for (const file of ['retryStorageCleanup.js', 'retryAccountDeletionCleanup.js']) {
      const result = JSON.parse((await runCli(file)).stdout.trim());
      assert.equal(result.failures, 0);
      assert.equal(result.objectReceiptsProcessed, 0);
      assert.equal(result.accountReceiptsProcessed, 0);
    }
    assert.ok(first.collections.accountdeletioncleanups.present);
    await mongoose.connect(uri, { dbName: name, autoIndex: false });
    const owner = new mongoose.Types.ObjectId();
    await Cleanup.create({ _id: owner, resumeUrls: ['fixture-preserved-path'] });
    await Asset.collection.insertOne({ reference: 'fixture-preserved-reference' });
    await mongoose.disconnect();
    await provisioner.provision({ env, apply: true });
    await mongoose.connect(uri, { dbName: name, autoIndex: false });
    assert.deepEqual((await Cleanup.findById(owner).lean()).resumeUrls, ['fixture-preserved-path']);
    assert.equal(await Asset.countDocuments({ reference: 'fixture-preserved-reference' }), 1);
    await assert.rejects(
      Asset.collection.insertOne({ reference: 'fixture-preserved-reference' }),
      (error) => error.code === 11000
    );
    await Cleanup.deleteMany({ _id: owner });
    const deferred = new mongoose.Types.ObjectId();
    const due = new mongoose.Types.ObjectId();
    const successful = new mongoose.Types.ObjectId();
    const legacy = new mongoose.Types.ObjectId();
    await Cleanup.collection.insertOne({ _id: legacy, resumeUrls: [], createdAt: new Date(0) });
    await Cleanup.create([
      { _id: deferred, retryAfter: new Date(Date.now() + 60000) },
      { _id: due },
      { _id: successful }
    ]);
    const worker = load('services/storageCleanupWorkerService.js', {
      './storedAssetService': { retryCleanup: async () => 0 },
      './accountDeletionService': {
        processCleanup: async (id) => {
          if (String(id) === String(due)) throw Error('fixture outage');
          await Cleanup.deleteOne({ _id: id });
        }
      }
    });
    const summary = await worker.runBatch();
    assert.equal(summary.accountReceiptsProcessed, 3);
    assert.equal(summary.failures, 1);
    assert.equal((await Cleanup.findById(due).lean()).cleanupAttempts, 1);
    assert.ok(await Cleanup.exists({ _id: deferred }));
    assert.equal(await Cleanup.exists({ _id: successful }), null);
    assert.equal(await Cleanup.exists({ _id: legacy }), null);
    assert.equal((await worker.runBatch()).accountReceiptsProcessed, 0);
    await Cleanup.create(
      Array.from({ length: 52 }, () => ({ _id: new mongoose.Types.ObjectId() }))
    );
    assert.equal((await worker.runBatch()).accountReceiptsProcessed, 50);
    assert.equal((await worker.runBatch()).accountReceiptsProcessed, 2);
    assert.ok(
      !(await Cleanup.collection.indexes()).some((index) => index.expireAfterSeconds !== undefined)
    );
  }
);
