const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('Interview cache TTL, cross-worker revisions, targeted invalidation, and outage recovery', async (t) => {
  const redisModule = require.resolve('redis');
  const realRedis = require(redisModule);
  const serviceModule = require.resolve('../services/redisCacheService');
  const shared = new Map();
  let now = Date.now();
  let healthy = true;
  const clients = [];
  t.mock.method(Date, 'now', () => now);
  class RedisFixture extends EventEmitter {
    constructor() {
      super();
      this.isReady = true;
      this.isOpen = true;
      clients.push(this);
    }
    async connect() {
      this.emit('ready');
    }
    async quit() {
      this.isOpen = false;
    }
    async set(key, value, options = {}) {
      if (!healthy) throw new Error('fixture outage');
      shared.set(key, { value, expiresAt: options.EX ? now + options.EX * 1000 : Infinity });
      return 'OK';
    }
    async get(key) {
      if (!healthy) throw new Error('fixture outage');
      const item = shared.get(key);
      return item && item.expiresAt > now ? item.value : null;
    }
    async pTTL(key) {
      const value = await this.get(key);
      return value === null ? -2 : shared.get(key).expiresAt - now;
    }
    async eval(_script, { keys }) {
      return [await this.get(keys[0]), await this.pTTL(keys[0])];
    }
    async mGet(keys) {
      return Promise.all(keys.map((key) => this.get(key)));
    }
  }
  require.cache[redisModule].exports = { ...realRedis, createClient: () => new RedisFixture() };
  const previousUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://fixture.invalid';
  delete require.cache[serviceModule];
  const workerA = require(serviceModule);
  delete require.cache[serviceModule];
  const workerB = require(serviceModule);
  t.after(async () => {
    await Promise.all([workerA.closeRedisCache(), workerB.closeRedisCache()]);
    require.cache[redisModule].exports = realRedis;
    delete require.cache[serviceModule];
    if (previousUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousUrl;
  });
  await Promise.all([workerA.initRedisCache({ silent: true }), workerB.initRedisCache({ silent: true })]);

  await t.test('Redis promotion respects the remaining source TTL', async () => {
    const key = 'interview:search:ttl:topic=javascript:';
    await workerA.setCacheJson(key, { valid: true }, 5);
    workerA.clearMemoryCache();
    now += 4900;
    assert.equal((await workerA.getCacheJsonWithMeta(key)).layer, 'redis');
    now += 101;
    assert.equal((await workerA.getCacheJsonWithMeta(key)).value, null);
  });

  await t.test(
    'topic revisions invalidate other workers and late fills without flushing unrelated topics',
    async () => {
      const base = 'interview:questions:test:topic=javascript:';
      const oldKey = await workerA.resolveInterviewCacheKey(base, 'javascript');
      await workerA.setCacheJson(oldKey, { old: true }, 600);
      assert.equal(await workerB.resolveInterviewCacheKey(base, 'javascript'), oldKey);
      assert.deepEqual(await workerB.getCacheJson(oldKey), { old: true });
      await workerA.invalidateInterviewPrepCache('react');
      assert.equal(await workerB.resolveInterviewCacheKey(base, 'javascript'), oldKey);
      await workerA.invalidateInterviewPrepCache('javascript');
      const newKey = await workerB.resolveInterviewCacheKey(base, 'javascript');
      assert.notEqual(newKey, oldKey);
      await workerA.setCacheJson(oldKey, { late: true }, 600);
      assert.equal(await workerB.getCacheJson(newKey), null);
    }
  );

  await t.test('memory is bounded during optional Redis failure and recovery uses a fresh namespace', async () => {
    const base = 'interview:questions:outage:topic=javascript:';
    const key = await workerA.resolveInterviewCacheKey(base, 'javascript');
    await workerA.setCacheJson(key, { useful: true }, 600);
    healthy = false;
    assert.deepEqual(await workerA.getCacheJson(key), { useful: true });
    now += 30001;
    assert.equal(await workerA.getCacheJson(key), null);
    healthy = true;
    clients[0].emit('ready');
    assert.notEqual(await workerA.resolveInterviewCacheKey(base, 'javascript'), key);
    for (let index = 0; index <= 2000; index++)
      workerA.setMemoryCacheJson(`interview:search:bounded:${index}`, { index }, 30);
    assert.equal(await workerA.getCacheJson('interview:search:bounded:0'), null);
    assert.deepEqual(await workerA.getCacheJson('interview:search:bounded:2000'), { index: 2000 });
  });
});
