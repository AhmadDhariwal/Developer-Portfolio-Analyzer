const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { createClient } = require('redis');

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error('Redis test configuration contains an invalid URL');
  }
}

function safeTarget() {
  const target = parseUrl(process.env.NEWS_TEST_REDIS_URL);
  assert.ok(!target.search && !target.hash, 'Test Redis URL must not contain query or fragment');
  if (['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    assert.ok(['redis:', 'rediss:'].includes(target.protocol));
    return target.href;
  }
  assert.equal(
    process.env.NEWS_TEST_REDIS_DISPOSABLE,
    'true',
    'Remote tests require explicit disposable-database acknowledgement'
  );
  assert.equal(target.protocol, 'rediss:', 'Remote tests require Redis TLS');
  assert.ok(target.hostname.endsWith('.upstash.io'), 'Remote test target must be Upstash');
  const envFile = path.resolve(__dirname, '../../../.env');
  const env = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {};
  const productionUrl = process.env.REDIS_URL || env.REDIS_URL;
  const productionHost = productionUrl
    ? parseUrl(productionUrl).hostname
    : String(process.env.UPSTASH_REDIS_HOST || env.UPSTASH_REDIS_HOST || '')
        .replace(/^\w+:\/\//, '')
        .split(/[/:]/)[0];
  assert.ok(productionHost, 'Application endpoint must be known to enforce isolation');
  assert.ok(
    target.hostname.toLowerCase() !== productionHost.toLowerCase(),
    'Test database must differ from the application database'
  );
  const productionPassword = productionUrl
    ? decodeURIComponent(parseUrl(productionUrl).password)
    : process.env.UPSTASH_REDIS_TOKEN || env.UPSTASH_REDIS_TOKEN;
  assert.ok(
    target.password && decodeURIComponent(target.password) !== productionPassword,
    'Test credentials must differ from application credentials'
  );
  return target.href;
}

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : original(name));
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  return unit.exports;
}

async function fixture(t) {
  const url = safeTarget();
  const namespace = process.env.NEWS_TEST_REDIS_NAMESPACE || `news-test:${randomUUID()}:`;
  assert.match(namespace, /^news-test:[a-f\d-]{36}:$/);
  const owned = new Set();
  const clients = [];
  const scope = (name) => {
    assert.equal(typeof name, 'string');
    const scoped = namespace + name;
    owned.add(scoped);
    return scoped;
  };
  const worker = async () => {
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { reconnectStrategy: false, connectTimeout: 3000 }
    });
    client.on('error', () => {});
    clients.push(client);
    try {
      await client.connect();
    } catch {
      throw new Error('Disposable Redis connection failed');
    }
    const redis = {
      eval: (script, options) => client.eval(script, { ...options, keys: options.keys.map(scope) }),
      set: (name, value, options = {}) =>
        client.set(scope(name), value, Object.keys(options).length ? options : { EX: 600 }),
      get: (name) => client.get(scope(name)),
      del: (name) => client.del(scope(name)),
      zRem: (name, token) => client.zRem(scope(name), token),
      pTTL: (name) => client.pTTL(scope(name)),
      mGet: (names) => client.mGet(names.map(scope))
    };
    return { redis, client, cache: { getRedisCacheClient: () => (client.isReady ? redis : null) } };
  };
  t.after(async () => {
    const cleanup = clients.find((client) => client.isReady);
    try {
      assert.ok([...owned].every((name) => name.startsWith(namespace)));
      if (owned.size) {
        assert.ok(cleanup, 'A live test connection is required for cleanup');
        await cleanup.del([...owned]);
        assert.ok((await cleanup.mGet([...owned])).every((value) => value === null));
      }
      t.diagnostic(JSON.stringify({ isolatedKeysRemoved: owned.size, remainingOwnedKeys: 0 }));
    } finally {
      for (const client of clients) if (client.isOpen) await client.quit();
    }
  });
  return { worker, namespace, scope };
}

module.exports = { fixture, load, safeTarget };
