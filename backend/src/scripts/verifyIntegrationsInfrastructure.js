const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const envPath = path.join(__dirname, '../../.env');
const file = fs.readFileSync(envPath, 'utf8');
const disk = dotenv.parse(file);
dotenv.config({ path: envPath, quiet: true });
const tokens = require('../services/integrationTokenService');
const redis = require('../services/redisCacheService');
async function main() {
  const report = {
    at: new Date().toISOString(),
    mode: 'read-only infrastructure audit; optional local key initialization',
    config: {},
    encryption: {},
    mongo: {},
    redis: {}
  };
  for (const key of [
    'MONGODB_URI',
    'REDIS_URL',
    'UPSTASH_REDIS_TOKEN',
    'GITHUB_INTEGRATION_CLIENT_ID',
    'GITHUB_INTEGRATION_CLIENT_SECRET',
    'GITHUB_INTEGRATION_CALLBACK_URL',
    'LINKEDIN_CLIENT_ID',
    'LINKEDIN_CLIENT_SECRET',
    'LINKEDIN_OAUTH_REDIRECT_URI'
  ])
    report.config[key] = Boolean(process.env[key]?.trim());
  try {
    tokens.keyring();
    report.encryption.valid = true;
  } catch {
    report.encryption.valid = false;
  }
  report.encryption.durableFileConfig = Boolean(
    disk.INTEGRATION_TOKEN_KEYS && disk.INTEGRATION_TOKEN_ACTIVE_KEY
  );
  const client = new MongoClient(
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devinsight',
    { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 8000 }
  );
  try {
    await client.connect();
    const db = client.db();
    const hello = await db.admin().command({ hello: 1 });
    report.mongo.connected = true;
    report.mongo.transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
    const models = [
      'integrationConnection',
      'integrationInsight',
      'integrationSyncLog',
      'integrationLinkedProfile'
    ].map((name) => require('../models/' + name));
    report.mongo.indexes = [];
    for (const model of models) {
      let actual = [];
      try {
        actual = await db.collection(model.collection.name).listIndexes().toArray();
      } catch (error) {
        if (error.code !== 26) throw error;
      }
      for (const [key, options] of model.schema.indexes()) {
        report.mongo.indexes.push({
          collection: model.collection.name,
          key,
          unique: Boolean(options.unique),
          present: actual.some(
            (index) =>
              JSON.stringify(index.key) === JSON.stringify(key) &&
              Boolean(index.unique) === Boolean(options.unique)
          )
        });
      }
    }
    let credentials = 0,
      encrypted = 0,
      decryptable = 0,
      plaintext = 0;
    const cursor = db
      .collection(models[0].collection.name)
      .find({}, { projection: { userId: 1, provider: 1, accessToken: 1, refreshToken: 1 } })
      .maxTimeMS(8000);
    for await (const row of cursor) {
      for (const field of ['accessToken', 'refreshToken']) {
        if (!row[field]) continue;
        credentials++;
        if (!String(row[field]).startsWith(tokens.PREFIX)) {
          plaintext++;
          continue;
        }
        encrypted++;
        try {
          tokens.decrypt(row[field], row.userId, row.provider, field);
          decryptable++;
        } catch {}
      }
    }
    Object.assign(report.encryption, { credentials, encrypted, decryptable, plaintext });
    if (process.argv.includes('--initialize-local-key')) {
      const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', 'backend/.env'], {
        cwd: path.join(__dirname, '../../..'),
        windowsHide: true
      });
      if (
        process.env.NODE_ENV === 'production' ||
        ignored.status !== 0 ||
        credentials !== 0 ||
        process.env.INTEGRATION_TOKEN_KEYS ||
        process.env.INTEGRATION_TOKEN_ACTIVE_KEY
      ) {
        report.encryption.initialization =
          'SKIPPED: requires local ignored env, zero stored credentials and no existing key configuration';
      } else {
        const ring = JSON.stringify({ local_v1: crypto.randomBytes(32).toString('base64') });
        let next = file;
        for (const [name, value] of [
          ['INTEGRATION_TOKEN_KEYS', "'" + ring + "'"],
          ['INTEGRATION_TOKEN_ACTIVE_KEY', 'local_v1']
        ]) {
          const pattern = new RegExp('^' + name + '=\\s*$', 'm');
          next = pattern.test(next)
            ? next.replace(pattern, name + '=' + value)
            : next + '\n' + name + '=' + value + '\n';
        }
        if (fs.readFileSync(envPath, 'utf8') !== file) throw Error('ENV_CHANGED');
        fs.writeFileSync(envPath, next);
        const saved = dotenv.parse(next);
        process.env.INTEGRATION_TOKEN_KEYS = saved.INTEGRATION_TOKEN_KEYS;
        process.env.INTEGRATION_TOKEN_ACTIVE_KEY = saved.INTEGRATION_TOKEN_ACTIVE_KEY;
        tokens.keyring();
        report.encryption.valid = true;
        report.encryption.durableFileConfig = true;
        report.encryption.initialization =
          'PASS: local ignored env initialized; no stored credential values changed';
      }
    }
  } catch (error) {
    report.mongo.error =
      error.code === 'ENOTFOUND' ? 'DNS resolution failed' : error.name || 'Audit failed';
  } finally {
    await client.close();
  }
  try {
    await redis.initRedisCache({ silent: true, probeOnly: true });
    const cache = redis.getRedisCacheClient({ commandTimeoutMs: 1000 });
    report.redis.ping = cache ? (await cache.ping()) === 'PONG' : false;
  } catch {
    report.redis.ping = false;
  } finally {
    await redis.closeRedisCache();
  }
  const target = path.join(
    __dirname,
    '../../verification/integrations/final-infrastructure-audit-2026-10-27.json'
  );
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => {
  console.error('Infrastructure audit failed; no secret details logged.');
  process.exitCode = 1;
});
