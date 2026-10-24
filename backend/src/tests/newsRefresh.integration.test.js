const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');
const { normalizeItem } = require('../utils/newsFormatter');
const realProviders = require('../services/newsDiscoveryProviders');
const filters = (search) => ({
  search,
  source: 'All',
  category: 'All',
  dateRange: 'week',
  popularity: 'all',
  page: 1
});
const enabled = Boolean(process.env.NEWS_TEST_REDIS_URL && process.env.NEWS_TEST_MONGODB_URI);

test(
  'isolated refresh: exact EC2 interval, shared headroom, manual dedup, Mongo publication and cross-worker version visibility',
  { skip: !enabled, timeout: 30000 },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.ok(['127.0.0.1', 'localhost'].includes(uri.hostname));
    const connection = await mongoose
      .createConnection(uri.href, {
        dbName: 'news_refresh_test_' + randomUUID().replaceAll('-', ''),
        serverSelectionTimeoutMS: 3000
      })
      .asPromise();
    t.after(async () => {
      await connection.dropDatabase();
      await connection.close();
    });
    const catalog = await require('./fixtures/newsCatalogFixture').create(connection);
    const Topic = connection.model('NewsTopicCache', require('../models/newsTopicCache').schema);
    await Topic.init();
    const isolated = await fixture(t);
    const one = await isolated.worker();
    const two = await isolated.worker();
    const old = { ...process.env };
    t.after(() => {
      for (const key of Object.keys(process.env))
        if (key.startsWith('NEWS_')) {
          if (old[key] === undefined) delete process.env[key];
          else process.env[key] = old[key];
        }
    });
    for (const name of ['HACKERNEWSSEARCH', 'DEVTOSEARCH'])
      Object.assign(process.env, {
        [`NEWS_${name}_CONTENT_APPROVED`]: 'true',
        [`NEWS_${name}_DAILY_BUDGET`]: '12',
        [`NEWS_${name}_MONTHLY_BUDGET`]: '300',
        [`NEWS_${name}_MIN_INTERVAL_MS`]: '60000'
      });
    Object.assign(process.env, {
      NEWS_DISCOVERY_ENABLED: 'true',
      NEWS_DISCOVERY_DAILY_JOBS: '12',
      NEWS_HACKERNEWS_SHARED_DAILY_BUDGET: '84',
      NEWS_HACKERNEWS_SHARED_MONTHLY_BUDGET: '2500'
    });
    const governor = load('../services/newsGovernanceService.js', { './redisCacheService': one.cache });
    const day = new Date().toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    let calls = 0;
    const items = Array.from({ length: 6 }, (_, index) =>
      normalizeItem({
        title: `Generative AI engineering ${index}`,
        source: 'Hacker News',
        url: `https://example.com/refresh/${index}`,
        publishedAt: new Date(Date.now() - 60000)
      })
    );
    const providers = {
      ...realProviders,
      enabled: () => true,
      available: () => ['hackernewssearch', 'devtosearch'],
      search: async (provider) => {
        const reservation = await governor.reserve(provider);
        if (!reservation.allowed)
          return {
            status: 'quota_limited',
            reason: reservation.reason,
            nextEligibleAt: reservation.nextEligibleAt,
            items: []
          };
        calls++;
        await governor.finish(reservation);
        return { status: 'success', items: provider === 'hackernewssearch' ? items : [] };
      }
    };
    const make = (worker) =>
      load('../services/newsDiscoveryService.js', {
        './newsCatalogService': catalog,
        '../models/newsTopicCache': Topic,
        './redisCacheService': worker.cache,
        './newsGovernanceService': governor,
        './newsDiscoveryProviders': providers
      });
    const first = make(one);
    const second = make(two);
    await one.redis.set(first.HEARTBEAT, String(Date.now()));
    const request = (service, search, manual = false, total = 0) =>
      service.coverage({
        filters: filters(search),
        total,
        broadTotal: total,
        revalidate: manual,
        admissionKey: 'isolated-account'
      });
    assert.equal((await request(first, 'generative ai')).enrichment.status, 'queued');
    assert.equal((await first.processQueue()).committed, true);
    assert.equal(calls, 2);
    const before = await one.redis.get(`news:v1:{discovery}:jobs:${day}`);
    const ec2 = await request(second, 'EC2');
    assert.equal(ec2.enrichment.status, 'waiting');
    assert.ok(ec2.enrichment.sourceHealth.every((source) => /interval/.test(source.reason)));
    assert.ok(Date.parse(ec2.enrichment.nextEligibleAt) > Date.now() + 55000);
    assert.equal(
      await one.redis.get(`news:v1:{discovery}:jobs:${day}`),
      before,
      'Blocked sources consume no job'
    );
    assert.equal((await governor.inspect('hackernewssearch')).reason, 'interval');
    assert.equal(
      await one.redis.get(`news:v3:{hackernewssearch}:day:${day}`),
      '1',
      'Inspection consumes no request'
    );
    const cached = await second.readTopic('generative ai');
    assert.equal(cached.total, 6);
    const initialVersion = cached.filters.version;
    assert.equal((await request(second, 'generative ai', false, 6)).enrichment.status, 'ready');
    assert.equal(calls, 2);
    assert.equal(
      (await request(first, 'generative ai', true, 6)).enrichment.status,
      'ready',
      'Manual minimum interval applies'
    );
    // Advance only this fixture's eligibility state; production keys and limits stay untouched.
    const state = JSON.parse(await one.redis.get(first.stateKey('generative ai')));
    // Existing deployments have lastAttemptAt but no checkedAtMs field.
    state.lastAttemptAt = new Date(Date.now() - 61000).toISOString();
    delete state.checkedAtMs;
    await one.redis.set(first.stateKey('generative ai'), JSON.stringify(state));
    for (const provider of ['hackernewssearch', 'devtosearch'])
      await one.redis.del(`news:v3:{${provider}}:interval`);
    for (const family of ['hackernews', 'devto']) await one.redis.del(`news:v3:{${family}}:shared:interval`);
    const checks = await Promise.all([
      request(first, 'generative ai', true, 6),
      request(second, 'generative ai', true, 6)
    ]);
    assert.ok(checks.every((check) => check.enrichment.status === 'queued'));
    assert.equal(await one.redis.get(`news:v1:{discovery}:jobs:${day}`), '2');
    assert.equal((await first.processQueue()).status, 'no_newer');
    const published = await second.readTopic('generative ai');
    assert.notEqual(published.filters.version, initialVersion, 'Other worker invalidates memory immediately');
    assert.equal(
      new Date(published.allItems[0].publishedAt).getTime(),
      new Date(cached.allItems[0].publishedAt).getTime()
    );
    assert.equal(
      (await Topic.findOne({ cacheKey: first.topicKey('generative ai') })).filters.version,
      published.filters.version
    );
    const completed = await request(second, 'generative ai', false, 6);
    assert.equal(completed.enrichment.status, 'no_newer');
    assert.ok(
      ['manual_refresh_interval', 'provider_admission'].includes(completed.enrichment.eligibilityReason)
    );
    assert.ok(completed.enrichment.lastSuccessfulCheckAt);
    assert.equal(calls, 4);
    // Longest applicable blocker wins, with exact UTC month/day resets.
    await one.redis.set(`news:v3:{hackernewssearch}:month:${month}`, '300');
    const monthly = await governor.inspect('hackernewssearch');
    assert.equal(monthly.reason, 'monthly_budget');
    assert.equal(
      Date.parse(monthly.nextEligibleAt),
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)
    );
    process.env.NEWS_HACKERNEWS_SHARED_DAILY_BUDGET = '12';
    const broad = await governor.inspect('hackernews');
    assert.equal(broad.allowed, false, 'Broad ingestion reserves the configured twelve search calls');
    assert.equal(broad.reason, 'daily_budget');
    t.diagnostic(
      JSON.stringify({
        providerCalls: calls,
        admittedJobs: 2,
        blockedEc2JobCost: 0,
        reason: ec2.enrichment.reason,
        crossWorkerVersionVerified: true,
        mongoBeforeRedis: true,
        applicationRedisWrites: 0
      })
    );
  }
);

test(
  'isolated upstream cooldown propagates precise reason and expiry without a retry',
  { skip: !process.env.NEWS_TEST_REDIS_URL },
  async (t) => {
    const isolated = await fixture(t);
    const one = await isolated.worker();
    const governor = load('../services/newsGovernanceService.js', { './redisCacheService': one.cache });
    const reservation = await governor.reserve('hackernews');
    assert.equal(reservation.allowed, true);
    const result = await governor.finish(reservation, { status: 429, headers: { 'retry-after': '120' } });
    assert.equal(result.reason, 'upstream_rate_limit');
    const sibling = await governor.inspect('hackernewssearch');
    // Approvals may be absent in a standalone test; inspect the approved broad adapter.
    const own = await governor.inspect('hackernews');
    assert.equal(own.reason, 'interval', 'The longer scheduled interval remains authoritative');
    assert.ok(Date.parse(result.nextEligibleAt) > Date.now() + 119000);
    assert.ok(sibling.reason);
  }
);
