const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');
const providers = require('../services/newsDiscoveryProviders');
const { normalizeItem } = require('../utils/newsFormatter');
const query = (search = 'react') => ({
  search,
  source: 'All',
  category: 'All',
  dateRange: 'week',
  popularity: 'all',
  page: 1
});
const item = (topic = 'React') =>
  normalizeItem({
    title: `${topic} security release update`,
    url: `https://example.com/${topic.toLowerCase()}`,
    publishedAt: new Date(),
    source: 'Hacker News'
  });
const controlledProviders = (extra = {}) => ({
  ...providers,
  enabled: () => true,
  available: () => ['hackernewssearch'],
  ...extra
});

test(
  'isolated Mongo discovery persistence, source expiry and cold-worker fallback preserve the general pool',
  { skip: !process.env.NEWS_TEST_MONGODB_URI, timeout: 60000 },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.equal(uri.protocol, 'mongodb:');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname));
    const database = `news_discovery_test_${randomUUID().replaceAll('-', '')}`;
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, serverSelectionTimeoutMS: 3000 })
      .asPromise();
    t.after(async () => {
      assert.match(connection.name, /^news_discovery_test_/);
      await connection.dropDatabase();
      await connection.close();
    });
    const Topic = connection.model('NewsTopicCache', require('../models/newsTopicCache').schema);
    const General = connection.model('NewsCache', require('../models/news').schema);
    await Promise.all([Topic.init(), General.init()]);
    assert.notEqual(Topic.collection.name, General.collection.name);
    assert.ok((await Topic.collection.indexes()).some((index) => index.unique && index.key.cacheKey));
    assert.ok(
      (await Topic.collection.indexes()).some((index) => index.expireAfterSeconds === 0 && index.key.expiresAt)
    );
    const values = new Map([['lease', 'owned']]);
    const redis = {
      get: async (key) => values.get(key) || null,
      set: async (key, value) => {
        values.set(key, value);
        return 'OK';
      },
      eval: async (script, options) => {
        if (script.includes('ZRANGEBYSCORE')) return 'react';
        if (!script.includes('ZREM')) {
          values.set(options.keys[1], options.arguments[1]);
          return 1;
        }
        values.set(options.keys[1], options.arguments[1]);
        if (options.arguments[4]) values.set(options.keys[3], options.arguments[4]);
        return 1;
      }
    };
    const dependencies = {
      '../models/newsTopicCache': Topic,
      './newsDiscoveryProviders': controlledProviders({ search: async () => ({ status: 'success', items: [item()] }) }),
      './redisCacheService': { getRedisCacheClient: () => redis },
      './newsGovernanceService': { withLease: (_name, _ttl, work) => work({ key: 'lease', token: 'owned' }) }
    };
    const worker = load('../services/newsDiscoveryService.js', dependencies);
    assert.equal((await worker.processQueue()).status, 'ready');
    assert.equal(await Topic.countDocuments({}), 1);
    assert.equal(await General.countDocuments({}), 0);
    assert.equal(JSON.stringify((await Topic.findOne().lean()).recommendedBasedOn), '{}');
    const coldWorker = () =>
      load('../services/newsDiscoveryService.js', {
        ...dependencies,
        './redisCacheService': { getRedisCacheClient: () => null }
      });
    assert.equal((await coldWorker().readTopic('react')).allItems.length, 1);
    await Topic.updateOne({}, { $set: { 'filters.sourceTimes.Hacker News': Date.now() - worker.RETENTION - 1 } });
    assert.equal((await coldWorker().readTopic('react')).allItems.length, 0);
    await Topic.updateOne({}, { $set: { expiresAt: new Date(0) } });
    assert.equal(await coldWorker().readTopic('react'), null);
  }
);

test(
  'isolated Redis/Upstash discovery queue is atomic, bounded, recoverable and fenced across workers',
  { skip: !process.env.NEWS_TEST_REDIS_URL, timeout: 120000 },
  async (t) => {
    const setup = await fixture(t);
    const one = await setup.worker(),
      two = await setup.worker();
    const config = {
      NEWS_DISCOVERY_DAILY_JOBS: '48',
      NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED: 'true',
      NEWS_HACKERNEWSSEARCH_DAILY_BUDGET: '2',
      NEWS_HACKERNEWSSEARCH_MONTHLY_BUDGET: '3',
      NEWS_HACKERNEWSSEARCH_MIN_INTERVAL_MS: '60000'
    };
    const original = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
    Object.assign(process.env, config);
    t.after(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const a = load('../services/newsGovernanceService.js', { './redisCacheService': one.cache });
    const b = load('../services/newsGovernanceService.js', { './redisCacheService': two.cache });
    let requests = 0;
    let empty = false;
    const model = { findOne: () => ({ lean: async () => null }), updateOne: async () => ({}) };
    const create = (runtime, governor) =>
      load('../services/newsDiscoveryService.js', {
        '../models/newsTopicCache': model,
        './redisCacheService': runtime.cache,
        './newsGovernanceService': governor,
        './newsDiscoveryProviders': controlledProviders({
          search: async (_provider, topic) => {
            const reservation = await governor.reserve('hackernewssearch');
            if (!reservation.allowed) return { status: 'quota_limited', items: [] };
            requests++;
            await new Promise((resolve) => setTimeout(resolve, 40));
            await governor.finish(reservation);
            return { status: 'success', items: empty ? [] : [item(topic)] };
          }
        })
      });
    await one.redis.set('news:v1:{discovery}:worker', String(Date.now()));
    const workerA = create(one, a),
      workerB = create(two, b);
    const queued = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        (index % 2 ? workerA : workerB).coverage({ filters: query(), total: 0, broadTotal: 0 })
      )
    );
    assert.ok(queued.every((result) => result.enrichment.status === 'queued'));
    assert.equal(requests, 0);
    const date = new Date().toISOString().slice(0, 10);
    assert.equal(await one.redis.get(`news:v1:{discovery}:jobs:${date}`), '1');
    await Promise.all([workerA.processQueue(), workerB.processQueue()]);
    assert.equal(requests, 1);
    assert.equal(JSON.parse(await one.redis.get(workerA.stateKey('react'))).status, 'ready');
    assert.equal((await create(two, b).readTopic('react')).allItems.length, 1);
    // Successful empty searches get a five-minute negative cache; readers cannot requeue them.
    await one.redis.del('news:v3:{hackernewssearch}:interval');
    await one.redis.del('news:v3:{hackernews}:shared:interval');
    await workerA.coverage({ filters: query('angular'), total: 0, broadTotal: 0 });
    empty = true;
    await workerA.processQueue();
    assert.equal(JSON.parse(await one.redis.get(workerA.stateKey('angular'))).status, 'exhausted');
    assert.ok((await one.redis.pTTL(workerA.stateKey('angular'))) > 240000);
    assert.equal(
      (await create(two, b).coverage({ filters: query('angular'), total: 0, broadTotal: 0 })).enrichment.status,
      'exhausted'
    );
    // A new topic cannot bypass exhausted provider budgets.
    const denied = await workerA.coverage({ filters: query('python'), total: 0, broadTotal: 0 });
    assert.equal(denied.enrichment.status, 'quota_limited');
    assert.equal(denied.enrichment.reason, 'daily_budget');
    await one.redis.del('news:v3:{hackernewssearch}:interval');
    await one.redis.del('news:v3:{hackernews}:shared:interval');
    await workerA.processQueue();
    assert.equal(await one.redis.get(workerA.stateKey('python')), null, 'Preflight denial does not create a job');
    assert.equal(requests, 2);
    const broad = await a.reserve('hackernews');
    await a.finish(broad, { failed: true, status: 429, headers: { 'retry-after': '120' } });
    assert.equal((await b.reserve('hackernewssearch')).reason, 'daily_budget');
    // Lost tokens cannot publish or remove another worker's queued job.
    await one.redis.set('owned-lease', 'new-owner');
    assert.equal(
      await one.redis.eval(workerA.COMMIT, {
        keys: ['owned-lease', 'fenced-state', workerA.QUEUE, 'fenced-topic'],
        arguments: ['old-owner', '{}', '10000', 'react', '{}', '10000']
      }),
      0
    );
    assert.equal(await one.redis.get('fenced-state'), null);
    // Queue bound and daily job budget are enforced by actual Lua, including parallel submitters.
    const now = Date.now();
    const enqueue = (index, maximum = '48') =>
      one.redis.eval(workerA.ENQUEUE, {
        keys: [
          'bounded-queue',
          `bounded-state-${index}`,
          'bounded-day',
          'bounded-user-minute',
          'bounded-user-day',
          `bounded-mode-${index}`
        ],
        arguments: [
          String(now),
          `topic-${index}`,
          JSON.stringify({ status: 'queued' }),
          String(now + 600000),
          JSON.stringify({ status: 'full' }),
          maximum,
          JSON.stringify({ status: 'daily' }),
          'prewarm',
          '3',
          '6',
          '{}',
          '{}',
          'automatic',
          '60000'
        ]
      });
    const bounded = await Promise.all(Array.from({ length: 25 }, (_, index) => enqueue(index)));
    assert.equal(bounded.filter((value) => JSON.parse(value).status === 'queued').length, 16);
    assert.equal(JSON.parse(await enqueue(30, '1')).status, 'full');
    await one.redis.del('bounded-queue');
    assert.equal(JSON.parse(await enqueue(31, '1')).status, 'daily');
    // Crash recovery reclaims only jobs whose visibility deadline has elapsed.
    await one.redis.set('claim-lease', 'owned');
    await one.redis.eval("redis.call('ZADD', KEYS[1], ARGV[1], 'react'); return 1", {
      keys: ['recovery-queue'],
      arguments: [String(now)]
    });
    assert.equal(
      await one.redis.eval(workerA.CLAIM, {
        keys: ['recovery-queue', 'claim-lease'],
        arguments: ['owned', String(now)]
      }),
      'react'
    );
    assert.equal(
      await one.redis.eval(workerA.CLAIM, {
        keys: ['recovery-queue', 'claim-lease'],
        arguments: ['owned', String(now + 119999)]
      }),
      ''
    );
    assert.equal(
      await one.redis.eval(workerA.CLAIM, {
        keys: ['recovery-queue', 'claim-lease'],
        arguments: ['owned', String(now + 120001)]
      }),
      'react'
    );
    // Controlled cold-start discovery becomes searchable public news on the next
    // cache read, independent of the user's career stack and without feed HTTP.
    await one.redis.del('news:v3:{hackernewssearch}:cooldown');
    await one.redis.del('news:v3:{hackernews}:cooldown');
    await one.redis.del('news:v3:{hackernewssearch}:interval');
    await one.redis.del('news:v3:{hackernews}:shared:interval');
    await one.redis.set(`news:v3:{hackernewssearch}:day:${date}`, '0');
    empty = false;
    assert.equal(
      (await workerA.coverage({ filters: query('DevOps'), total: 0, broadTotal: 0 })).enrichment.status,
      'queued'
    );
    assert.equal((await workerA.processQueue()).status, 'ready');
    const feedService = load('../services/newsService.js', {
      axios: { get: () => assert.fail('Feed cannot fetch providers') },
      './newsPoolService': { readPool: async () => null, freshness: () => 'fresh' },
      './newsDiscoveryService': workerA,
      './developerSignalService': { getDeveloperSignals: () => assert.fail('Explore cannot resolve career signals') }
    });
    const news = await feedService.getNewsFeed({
      user: { _id: 'frontend-user', activeCareerStack: 'Frontend' },
      query: { mode: 'explore', search: 'DevOps' }
    });
    assert.equal(news.total, 1);
    assert.equal(news.items[0].rankScore, null);
    assert.equal(news.recommendedBasedOn, null);
    assert.equal(news.enrichment.status, 'ready');
  }
);
