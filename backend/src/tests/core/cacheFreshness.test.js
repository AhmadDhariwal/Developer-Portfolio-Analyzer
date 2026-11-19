'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const fs = require('node:fs');

test('layered cache never extends 120/900-second source TTLs and rejects absent expiry', async () => {
  const filename = require.resolve('../../core/cache/redisCacheService');
  const previous = process.env.REDIS_URL;
  const realNow = Date.now;
  let now = realNow();
  let source;
  let reads = 0;
  class Client extends EventEmitter {
    isReady = true;
    isOpen = true;
    async connect() {
      this.emit('ready');
    }
    async quit() {
      this.isOpen = false;
    }
    async eval() {
      reads++;
      if (!source || source.expiresAt <= now) return [null, -2];
      return [
        JSON.stringify(source.value),
        source.expiresAt === Infinity ? -1 : source.expiresAt - now
      ];
    }
  }
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(require('node:path').dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (name) =>
    name === 'redis' ? { createClient: () => new Client() } : original(name);
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  const cache = unit.exports;
  process.env.REDIS_URL = 'redis://fixture.invalid';
  Date.now = () => now;
  try {
    await cache.initRedisCache({ silent: true, probeOnly: true });
    for (const [key, ttl] of [
      ['career_sprint:overview-v4:owner', 120],
      ['courses:result:owner', 900],
      ['recommendations:result:owner', 900]
    ]) {
      source = { value: { revision: 1 }, expiresAt: now + ttl * 1000 };
      assert.deepEqual(await cache.getCacheJson(key), { revision: 1 });
      const before = reads;
      now += ttl * 1000 - 1;
      assert.deepEqual(await cache.getCacheJson(key), { revision: 1 });
      assert.equal(reads, before);
      now += 2;
      assert.equal(await cache.getCacheJson(key), null);
      assert.equal(reads, before + 1);
    }
    source = { value: { revision: 'unbounded' }, expiresAt: Infinity };
    assert.equal(await cache.getCacheJson('courses:no-expiry'), null);
    source = null;
    assert.equal(await cache.getCacheJson('courses:missing'), null);
  } finally {
    Date.now = realNow;
    await cache.closeRedisCache();
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

test(
  'real disposable Redis retains source expiry and rejects no-expiry payloads',
  {
    skip: !process.env.DPA_TEST_REDIS_URL,
    timeout: 10000
  },
  async () => {
    const target = new URL(process.env.DPA_TEST_REDIS_URL);
    assert.equal(target.protocol, 'redis:');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
    assert.equal(process.env.DPA_TEST_REDIS_DISPOSABLE, 'true');
    const { createClient } = require('redis');
    const { randomUUID } = require('node:crypto');
    const redis = createClient({
      url: target.href,
      socket: { reconnectStrategy: false, connectTimeout: 1000 }
    });
    redis.on('error', () => {});
    const previous = process.env.REDIS_URL;
    const key = `freshness-test:${randomUUID()}`;
    const cache = require('../../core/cache/redisCacheService');
    process.env.REDIS_URL = target.href;
    try {
      await redis.connect();
      await cache.initRedisCache({ silent: true, probeOnly: true });
      await redis.set(key, JSON.stringify({ revision: 1 }), { PX: 200 });
      assert.deepEqual(await cache.getCacheJson(key), { revision: 1 });
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(await cache.getCacheJson(key), null);
      await redis.set(key, JSON.stringify({ revision: 2 }));
      assert.equal(await cache.getCacheJson(key), null);
      assert.equal(await cache.acquireCacheLock(`${key}:lock`, 'owner', 2), true);
      await cache.releaseCacheLock(`${key}:lock`, 'other');
      assert.equal(await redis.get(`${key}:lock`), 'owner');
      await cache.releaseCacheLock(`${key}:lock`, 'owner');
      assert.equal(await redis.get(`${key}:lock`), null);
    } finally {
      cache.clearMemoryCache();
      await cache.closeRedisCache();
      if (redis.isReady) await redis.del([key, `${key}:lock`]);
      if (redis.isOpen) await redis.quit();
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  }
);
