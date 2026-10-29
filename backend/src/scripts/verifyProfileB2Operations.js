// Bounded explicit acceptance: production Mongo metadata is read-only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function worker(subject, count) {
  assert.match(subject, /^[a-f0-9]{24}$/);
  assert.ok(count > 0 && count <= 6);
  const cache = require('../services/redisCacheService');
  const controls = require('../middleware/publicPortfolioRateLimit');
  try {
    assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
    const result = [];
    for (let index = 0; index < count; index++) {
      let status = 200;
      const response = {
        set() {
          return this;
        },
        status(value) {
          status = value;
          return this;
        },
        json() {
          return this;
        }
      };
      await controls.uploadLimit({ user: { _id: subject } }, response, () => {});
      result.push(status);
    }
    return result;
  } finally {
    await cache.closeRedisCache();
  }
}
async function main() {
  if (process.argv[2] === '--worker') {
    console.log(JSON.stringify(await worker(process.argv[3], Number(process.argv[4]))));
    return;
  }
  assert.ok(process.env.PROFILE_B2_LIVE_OUTPUT);
  const output = path.resolve(process.env.PROFILE_B2_LIVE_OUTPUT);
  const report = {
    mongo: {},
    redis: {},
    productionRecordsRead: false,
    productionRecordsWritten: false
  };
  const client = new MongoClient(process.env.MONGODB_URI || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 5000
  });
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1, maxTimeMS: 5000 });
    report.mongo.connectivity = 'PASS';
    report.mongo.transactionTopology =
      !!(hello.setName || hello.msg === 'isdbgrid') && !!hello.logicalSessionTimeoutMinutes;
    const db = client.db();
    const names = new Set(
      (await db.listCollections({}, { nameOnly: true, maxTimeMS: 5000 }).toArray()).map(
        (c) => c.name
      )
    );
    report.mongo.collections = {};
    for (const name of ['users', 'storedassets', 'accountdeletioncleanups']) {
      const present = names.has(name);
      const indexes = present
        ? await db.collection(name).listIndexes({ maxTimeMS: 5000 }).toArray()
        : [];
      report.mongo.collections[name] = {
        present,
        indexes: indexes.map(({ key, unique, expireAfterSeconds }) => ({
          key,
          unique: !!unique,
          ...(expireAfterSeconds === undefined ? {} : { expireAfterSeconds })
        }))
      };
    }
  } catch {
    report.mongo.status = 'UNVERIFIED: metadata read failed (sanitized)';
  } finally {
    await client.close();
  }
  const subject = crypto.randomBytes(12).toString('hex');
  const other = crypto.randomBytes(12).toString('hex');
  const windowStart = Math.floor(Date.now() / 3600000);
  const cache = require('../services/redisCacheService');
  try {
    // Do not straddle a fixed limiter window; no sleeps or load test.
    assert.ok(Date.now() % 3600000 < 3500000);
    const run = async (id, count) => {
      const { stdout } = await execFile(
        process.execPath,
        [__filename, '--worker', id, String(count)],
        { timeout: 20000, maxBuffer: 1024, windowsHide: true }
      );
      return JSON.parse(stdout.trim());
    };
    const first = await run(subject, 6);
    assert.deepEqual(first, [200, 200, 200, 200, 200, 200]);
    const second = await run(subject, 5);
    const isolated = await run(other, 1);
    assert.deepEqual(first, [200, 200, 200, 200, 200, 200]);
    assert.deepEqual(second, [200, 200, 200, 200, 429]);
    assert.deepEqual(isolated, [200]);
    report.redis = {
      status: 'PASS',
      freshProcesses: 3,
      realUploadLimiterAdmissions: 10,
      sharedDenials: 1,
      differentOwnerAdmitted: true
    };
  } catch {
    report.redis = { status: 'FAIL or unavailable (sanitized)' };
    try {
      assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
      await cache
        .getRedisCacheClient({ commandTimeoutMs: 1500 })
        .eval('return 1', { keys: [], arguments: [] });
    } catch (error) {
      report.redis.providerQuotaExceeded = /quota|limit exceeded|max requests|budget/i.test(
        String(error.message || '')
      );
    }
  } finally {
    try {
      assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
      const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
      for (const id of [subject, other]) {
        const identity = crypto.createHash('sha256').update(id).digest('hex');
        for (const window of new Set([windowStart, Math.floor(Date.now() / 3600000)])) {
          const key = `public-portfolio:v3:rate:upload:${identity}:${window}`;
          try {
            await redis.del(key);
          } catch {
            assert.equal(await redis.get(key), null);
          }
        }
      }
      report.redis.disposableCountersRemoved = true;
    } catch {
      report.redis.disposableCountersRemoved = false;
    }
    await cache.closeRedisCache();
  }
  await fs.writeFile(path.join(output, 'operations-results.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      mongoConnectivity: report.mongo.connectivity || 'unverified',
      mongoTransactions: report.mongo.transactionTopology || false,
      redis: report.redis.status,
      fixtureCountersRemoved: report.redis.disposableCountersRemoved
    })
  );
}
main().catch(() => {
  console.log('Operations verification failed (sanitized).');
  process.exitCode = 1;
});
