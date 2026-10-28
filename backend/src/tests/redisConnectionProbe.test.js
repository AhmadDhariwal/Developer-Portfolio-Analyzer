const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

test('cache shutdown tolerates a socket closing during QUIT and awaits disconnect failures', async () => {
  const filename = path.resolve(__dirname, '../services/redisCacheService.js');
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://fixture.invalid';
  let instance;
  let disconnects = 0;
  class Client extends EventEmitter {
    isOpen = true;
    isReady = true;
    async connect() {
      this.emit('ready');
    }
    async quit() {
      this.isOpen = false;
      throw Error('Socket closed during QUIT');
    }
    async disconnect() {
      disconnects++;
      this.isOpen = false;
      throw Error('Client already closed');
    }
  }
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (name) =>
    name === 'redis' ? { createClient: () => (instance = new Client()) } : original(name);
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  try {
    await unit.exports.initRedisCache({ silent: true, probeOnly: true });
    await assert.doesNotReject(unit.exports.closeRedisCache());
    assert.equal(disconnects, 0);
    await unit.exports.initRedisCache({ silent: true, probeOnly: true });
    instance.isReady = false;
    await assert.doesNotReject(unit.exports.closeRedisCache());
    assert.equal(disconnects, 1);
  } finally {
    await unit.exports.closeRedisCache();
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

test('read-only probes skip revision writes; ordinary startup still initializes revisions', async () => {
  const filename = path.resolve(__dirname, '../services/redisCacheService.js');
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://fixture.invalid';
  let writes = 0;
  let pingDelay = 0;
  class Client extends EventEmitter {
    isOpen = true;
    isReady = true;
    async connect() {
      this.emit('ready');
    }
    async set() {
      writes++;
      return 'OK';
    }
    async ping() {
      if (pingDelay) await new Promise((resolve) => setTimeout(resolve, pingDelay));
      return 'PONG';
    }
    async quit() {
      this.isOpen = false;
    }
  }
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (name) =>
    name === 'redis' ? { createClient: () => new Client() } : original(name);
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  const cache = unit.exports;
  try {
    await cache.initRedisCache({ silent: true, probeOnly: true });
    assert.equal(await cache.pingRedisCache(), 'PONG');
    assert.equal(writes, 0);
    pingDelay = 220;
    assert.equal(await cache.getRedisCacheClient({ commandTimeoutMs: 1000 }).ping(), 'PONG');
    await assert.rejects(cache.getRedisCacheClient().ping(), /timed out/);
    pingDelay = 0;
    await cache.closeRedisCache();
    await cache.initRedisCache({ silent: true });
    assert.equal(writes, 1);
  } finally {
    await cache.closeRedisCache();
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

test('remote test safety rejects application databases, reused credentials, REST URLs and missing acknowledgement', () => {
  const { safeTarget } = require('./fixtures/jobsHubRedisFixture');
  const names = ['REDIS_URL', 'JOBS_TEST_REDIS_URL', 'JOBS_TEST_REDIS_DISPOSABLE'];
  const previous = names.map((name) => process.env[name]);
  try {
    process.env.REDIS_URL =
      'rediss://default:production-placeholder@application.example.upstash.io:6379';
    process.env.JOBS_TEST_REDIS_URL =
      'rediss://default:test-placeholder@test.example.upstash.io:6379';
    delete process.env.JOBS_TEST_REDIS_DISPOSABLE;
    assert.throws(() => safeTarget(), /explicit disposable/);
    process.env.JOBS_TEST_REDIS_DISPOSABLE = 'true';
    process.env.JOBS_TEST_REDIS_URL = process.env.REDIS_URL;
    assert.throws(() => safeTarget(), /differ from the application database/);
    process.env.JOBS_TEST_REDIS_URL =
      'rediss://default:production-placeholder@test.example.upstash.io:6379';
    assert.throws(() => safeTarget(), /credentials must differ/);
    process.env.JOBS_TEST_REDIS_URL = 'https://test.example.upstash.io';
    assert.throws(() => safeTarget(), /TLS/);
    process.env.JOBS_TEST_REDIS_URL = 'invalid Redis configuration';
    assert.throws(() => safeTarget(), /invalid URL/);
    process.env.JOBS_TEST_REDIS_URL =
      'rediss://default:test-placeholder@test.example.upstash.io:6379';
    assert.ok(Boolean(safeTarget()));
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test('connection checker resolves backend .env independently of the working directory and requests a read-only probe', async () => {
  const filename = path.resolve(__dirname, '../scripts/checkRedisConnection.js');
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  let configuration;
  let closed = false;
  unit.require = (name) => {
    if (name === 'dotenv')
      return {
        config: (options) => {
          configuration = options;
        }
      };
    if (name === '../services/redisCacheService')
      return {
        initRedisCache: async (options) => {
          assert.equal(options.probeOnly, true);
          return {};
        },
        pingRedisCache: async () => 'PONG',
        closeRedisCache: async () => {
          closed = true;
        }
      };
    return original(name);
  };
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(configuration.path, path.resolve(__dirname, '../../.env'));
  assert.equal(closed, true);
});
