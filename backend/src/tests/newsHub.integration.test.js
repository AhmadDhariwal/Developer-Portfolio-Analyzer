const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');
const { normalizeItem } = require('../utils/newsFormatter');
const makeArticle = (extra = {}) =>
  normalizeItem({
    title: 'React security update',
    source: 'Dev.to',
    url: 'https://example.com/news',
    publishedAt: new Date(),
    ...extra
  });

test(
  'disposable Upstash: atomic quotas, cooldown, circuits, leases, shared cache and outage fallback',
  { skip: !process.env.NEWS_TEST_REDIS_URL, timeout: 120000 },
  async (t) => {
    const setup = await fixture(t);
    const one = await setup.worker();
    const two = await setup.worker();
    const a = load('../services/newsGovernanceService.js', { './redisCacheService': one.cache });
    const b = load('../services/newsGovernanceService.js', { './redisCacheService': two.cache });
    const reservations = await Promise.all(
      Array.from({ length: 25 }, (_, index) => (index % 2 ? a : b).reserve('devto'))
    );
    assert.equal(reservations.filter((value) => value.allowed).length, 1);
    const reservation = reservations.find((value) => value.allowed);
    const base = reservation.base;
    assert.equal((await b.health()).devto.dailyUsed, 1);
    for (const suffix of [
      ':active',
      ':interval',
      `:day:${new Date().toISOString().slice(0, 10)}`,
      `:month:${new Date().toISOString().slice(0, 7)}`
    ])
      assert.ok((await one.redis.pTTL(base + suffix)) > 0);
    await a.finish(reservation, { status: 429, headers: { 'retry-after': '120' }, failed: true });
    await one.redis.del(base + ':interval');
    assert.equal((await b.reserve('devto')).reason, 'upstream_rate_limit');
    await a.finish(reservation, { status: 429, headers: { 'retry-after': '30' } });
    assert.ok((await one.redis.pTTL(base + ':cooldown')) > 100000);
    await one.redis.del(base + ':cooldown');
    await one.redis.del('news:v3:{devtosearch}:cooldown');
    await one.redis.del('news:v3:{devto}:shared:interval');
    const active = await b.reserve('devto');
    assert.equal(active.allowed, true);
    await one.redis.del(base + ':interval');
    await one.redis.del('news:v3:{devto}:shared:interval');
    assert.equal((await a.reserve('devto')).reason, 'concurrency');
    await b.finish(active);
    await one.redis.set(`${base}:day:${new Date().toISOString().slice(0, 10)}`, '72');
    assert.equal((await a.reserve('devto')).reason, 'daily_budget');
    await one.redis.set(`${base}:day:${new Date().toISOString().slice(0, 10)}`, '0');
    await one.redis.set(`${base}:month:${new Date().toISOString().slice(0, 7)}`, '2200');
    assert.equal((await a.reserve('devto')).reason, 'monthly_budget');
    for (let index = 0; index < 3; index++) {
      const slot = await a.reserve('hackernews');
      assert.equal(slot.allowed, true);
      await a.finish(slot, { status: 503, failed: true });
      await one.redis.del(slot.base + ':interval');
      await one.redis.del('news:v3:{hackernews}:shared:interval');
    }
    assert.equal((await b.reserve('hackernews')).reason, 'circuit_open');
    let calls = 0;
    await Promise.all(
      [a, b].map((governor) =>
        governor.withLease('race', 60, async () => {
          calls++;
          await new Promise((resolve) => setTimeout(resolve, 500));
        })
      )
    );
    assert.equal(calls, 1);
    await a.withLease('owner', 60, async ({ key }) => one.redis.set(key, 'replacement', { EX: 60 }));
    assert.equal(await two.redis.get('news:v3:lease:owner'), 'replacement');

    const middleware = load('../middleware/newsMiddleware.js', { '../services/redisCacheService': one.cache });
    for (const [kind, maximum, handler] of [
      ['feed', 120, middleware.feedLimit],
      ['mutation', 30, middleware.mutationLimit],
      ['refresh', 3, middleware.validateFeed]
    ]) {
      let accepted = 0;
      let rejected = 0;
      await Promise.all(
        Array.from({ length: maximum + 1 }, () =>
          handler(
            { user: { _id: `integration-${kind}` }, query: { refresh: 'true' } },
            {
              set() {},
              status(code) {
                assert.equal(code, 429);
                rejected++;
                return { json() {} };
              }
            },
            () => {
              accepted++;
            }
          )
        )
      );
      assert.equal(accepted, maximum);
      assert.equal(rejected, 1);
    }

    let document;
    const model = {
      findOne: () => ({ lean: async () => document }),
      updateOne: async (_query, update) => {
        document = update.$set;
      }
    };
    const makePool = (worker, governor) =>
      load('../services/newsPoolService.js', {
        '../models/news': model,
        './redisCacheService': worker.cache,
        './newsGovernanceService': governor
      });
    const poolA = makePool(one, a);
    const poolB = makePool(two, b);
    const result = {
      sourceBuckets: {
        'Dev.to': [makeArticle(), makeArticle({ url: 'https://example.com/news?utm_source=duplicate' })]
      },
      providerDiagnostics: [{ provider: 'Dev.to', enabled: true, configured: true, reachable: true }],
      providerFailureCount: 0
    };
    await poolA.refreshPool(async () => result);
    const shared = await poolB.readPool();
    assert.equal(shared.allItems.length, 1);
    assert.equal(poolB.freshness(shared), 'fresh');
    assert.ok((await two.redis.pTTL(poolA.KEY)) <= 86400000);
    let providerCalls = 0;
    await poolB.refreshPool(async () => {
      providerCalls++;
      return result;
    });
    assert.equal(providerCalls, 0);
    // Advance only the synthetic snapshot's source time, never actual quota clocks.
    document.filters.attemptedAt = Date.now() - 21 * 60000;
    document.filters.sourceTimes['Dev.to'] = Date.now() - 21 * 60000;
    document.lastUpdated = new Date(document.filters.sourceTimes['Dev.to']);
    await one.redis.set(poolA.KEY, JSON.stringify(document), { EX: 3600 });
    await poolB.refreshPool(async () => ({ ...result, sourceBuckets: {}, providerFailureCount: 1 }));
    const stale = await poolA.readPool({ bypass: true });
    assert.equal(stale.allItems.length, 1);
    assert.equal(poolA.freshness(stale), 'stale');
    const originalTime = new Date(stale.lastUpdated).getTime();
    assert.equal(originalTime, document.filters.sourceTimes['Dev.to']);
    document.filters.attemptedAt = Date.now() - 21 * 60000;
    await one.redis.set(poolA.KEY, JSON.stringify(document), { EX: 3600 });
    const lost = await poolB.refreshPool(async () => {
      await one.redis.set('news:v3:lease:ingestion', 'replacement', { EX: 60 });
      return result;
    });
    assert.equal(lost.reason, 'lease_lost');
    assert.equal(await two.redis.get('news:v3:lease:ingestion'), 'replacement');
    const fallback = load('../services/newsPoolService.js', {
      '../models/news': model,
      './redisCacheService': { getRedisCacheClient: () => null }
    });
    assert.equal((await fallback.readPool()).allItems.length, 1);
    assert.equal(
      (
        await load('../services/newsGovernanceService.js', {
          './redisCacheService': { getRedisCacheClient: () => null }
        }).reserve('devto')
      ).allowed,
      false
    );
  }
);

test(
  'isolated local Mongo: actual cache persistence, indexes, JWT ownership and idempotent saved actions',
  { skip: !process.env.NEWS_TEST_MONGODB_URI, timeout: 60000 },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.equal(uri.protocol, 'mongodb:');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname));
    const database = `news_hub_test_${randomUUID().replaceAll('-', '')}`;
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, serverSelectionTimeoutMS: 3000 })
      .asPromise();
    t.after(async () => {
      assert.match(connection.name, /^news_hub_test_/);
      await connection.dropDatabase();
      await connection.close();
    });
    const Saved = connection.model('NewsSavedItem', require('../models/newsSavedItem').schema);
    const News = connection.model('NewsCache', require('../models/news').schema);
    const User = connection.model(
      'NewsTestUser',
      new mongoose.Schema({ careerStack: String, experienceLevel: String })
    );
    await Promise.all([Saved.init(), News.init()]);
    assert.ok(
      (await Saved.collection.indexes()).some(
        (index) => index.unique && index.key.userId && index.key.url && index.key.type
      )
    );
    assert.ok((await News.collection.indexes()).some((index) => index.key.expiresAt && index.expireAfterSeconds === 0));
    const pool = load('../services/newsPoolService.js', {
      '../models/news': News,
      './redisCacheService': { getRedisCacheClient: () => null }
    });
    await News.create({
      cacheKey: pool.KEY,
      allItems: [makeArticle()],
      lastUpdated: new Date(),
      expiresAt: new Date(Date.now() + 60000)
    });
    assert.equal((await pool.readPool()).allItems.length, 1);
    assert.equal(await News.countDocuments({ cacheKey: pool.KEY }), 1);
    if (process.env.NEWS_TEST_REDIS_URL) {
      const setup = await fixture(t);
      const worker = await setup.worker();
      const governor = load('../services/newsGovernanceService.js', { './redisCacheService': worker.cache });
      const actualPool = load('../services/newsPoolService.js', {
        '../models/news': News,
        './redisCacheService': worker.cache,
        './newsGovernanceService': governor
      });
      await actualPool.refreshPool(async () => ({
        sourceBuckets: { 'Dev.to': [makeArticle()] },
        providerDiagnostics: [{ provider: 'Dev.to', enabled: true, configured: true, reachable: true }],
        providerFailureCount: 0
      }));
      assert.equal((await News.findOne({ cacheKey: pool.KEY }).lean()).total, 1);
      assert.equal(JSON.parse(await worker.redis.get(pool.KEY)).total, 1);
      assert.equal(await News.countDocuments({ cacheKey: pool.KEY }), 1);
      await worker.redis.del(pool.KEY);
      await News.updateOne({ cacheKey: pool.KEY }, { $set: { 'filters.attemptedAt': Date.now() - 21 * 60000 } });
      const protectedFill = await actualPool.refreshPool(async () => {
        await News.updateOne({ cacheKey: pool.KEY }, { $set: { 'filters.attemptedAt': Date.now() + 10000 } });
        return {
          sourceBuckets: { 'Dev.to': [makeArticle()] },
          providerDiagnostics: [{ provider: 'Dev.to', enabled: true, configured: true }],
          providerFailureCount: 0
        };
      });
      assert.equal(protectedFill.reason, 'newer_snapshot');
    }
    const controller = load('../controllers/newsController.js', {
      '../models/newsSavedItem': Saved,
      '../services/newsService': { getNewsFeed: async () => ({ items: [], total: 0, filters: { page: 1, limit: 12 } }) }
    });
    const auth = load('../middleware/authmiddleware.js', { '../models/user': User });
    const routes = load('../routes/newsRoutes.js', {
      '../controllers/newsController': controller,
      '../middleware/authmiddleware': auth
    });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/news', routes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomUUID();
    t.after(() => {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    });
    const owner = await User.create({ careerStack: 'Frontend' });
    const foreign = await User.create({ careerStack: 'Backend' });
    const token = (user) =>
      require('jsonwebtoken').sign({ id: String(user._id) }, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web',
        expiresIn: '5m'
      });
    const request = (path, user, body, method = 'GET') =>
      fetch(`http://127.0.0.1:${server.address().port}/news${path}`, {
        method,
        headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    assert.equal((await request('/', null)).status, 401);
    assert.equal((await request('/?search[x]=y', owner)).status, 400);
    const body = {
      articleId: 'test-article',
      title: 'React security update',
      url: 'https://example.com/news',
      type: 'read_later',
      source: 'Dev.to'
    };
    const responses = await Promise.all(Array.from({ length: 8 }, () => request('/save', owner, body, 'POST')));
    assert.ok(responses.every((response) => [200, 201].includes(response.status)));
    assert.equal(await Saved.countDocuments({ userId: owner._id }), 1);
    const item = await Saved.findOne({ userId: owner._id }).lean();
    assert.equal((await request(`/save/${item._id}/read`, foreign, {}, 'PATCH')).status, 404);
    assert.equal((await request(`/save/${item._id}`, foreign, undefined, 'DELETE')).status, 404);
    const read = await (await request(`/save/${item._id}/read`, owner, {}, 'PATCH')).json();
    const reread = await (await request(`/save/${item._id}/read`, owner, {}, 'PATCH')).json();
    assert.equal(read.item.readAt, reread.item.readAt);
    assert.equal((await (await request('/saved', foreign)).json()).total, 0);
    assert.equal((await request('/save', owner, { ...body, url: 'http://127.0.0.1/' }, 'POST')).status, 400);
    assert.match((await request('/', owner)).headers.get('cache-control'), /private, no-store/);
    await News.updateOne({ cacheKey: pool.KEY }, { $set: { expiresAt: new Date(0) } });
    const emptyPool = load('../services/newsPoolService.js', {
      '../models/news': News,
      './redisCacheService': { getRedisCacheClient: () => null }
    });
    assert.equal(await emptyPool.readPool(), null);
  }
);
