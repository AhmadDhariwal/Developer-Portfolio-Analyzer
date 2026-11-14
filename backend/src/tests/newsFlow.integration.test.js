const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');
const realProviders = require('../services/newsDiscoveryProviders');
const BASE = 'news:v1:{discovery}';
const filters = (search) => ({ search, source: 'All', category: 'All', dateRange: 'week', page: 1 });

test(
  'atomic discovery accounting, reserved capacity, deduplication and expired quota revalidation',
  { skip: !process.env.NEWS_TEST_REDIS_URL, timeout: 30000 },
  async (t) => {
    const original = { ...process.env };
    Object.assign(process.env, {
      NEWS_DISCOVERY_DAILY_JOBS: '12',
      NEWS_DISCOVERY_PREWARM_ENABLED: 'true',
      NEWS_DISCOVERY_PREWARM_DAILY_JOBS: '4',
      NEWS_PREWARM_RESERVED_USER_JOBS: '6'
    });
    t.after(() => {
      for (const key of Object.keys(process.env))
        if (key.startsWith('NEWS_')) {
          if (original[key] === undefined) delete process.env[key];
          else process.env[key] = original[key];
        }
    });
    const setup = await fixture(t);
    const one = await setup.worker();
    let allowed = false;
    const make = () =>
      load('../services/newsDiscoveryService.js', {
        './redisCacheService': one.cache,
        './newsAdaptiveService': { candidates: async () => [{ topic: 'rust' }, { topic: 'python' }] },
        './newsGovernanceService': {
          COUNTER: require('../services/newsGovernanceService').COUNTER,
          policy: (provider) => ({ daily: provider === 'hackernews' ? 12 : 0, monthly: 300 }),
          inspect: async () => ({
            allowed,
            reason: 'daily_budget',
            nextEligibleAt: new Date(Date.now() + 60000).toISOString()
          }),
          withLease: async (_name, _seconds, callback) => callback()
        },
        './newsDiscoveryProviders': {
          ...realProviders,
          enabled: () => true,
          available: () => ['hackernewssearch']
        },
        '../models/newsTopicCache': { db: { readyState: 1 }, findOne: () => ({ lean: async () => null }) }
      });
    const day = new Date().toISOString().slice(0, 10);
    const global = `${BASE}:jobs:${day}`;
    const prewarm = `${BASE}:prewarm:${day}`;
    await one.redis.set(`${BASE}:worker`, String(Date.now()));
    await make().prewarm();
    assert.equal(await one.redis.get(prewarm), null, 'Provider-denied prewarming consumes no counter');
    const broad = await make().coverage({
      filters: filters(''),
      total: 0,
      broadTotal: 0,
      revalidate: true,
      admissionKey: 'isolated-account'
    });
    assert.equal(broad.enrichment.status, 'quota_limited');
    assert.equal(await one.redis.get(global), null, 'Blocked general-feed checks consume no job');
    allowed = true;
    await make().prewarm();
    assert.equal(await one.redis.get(prewarm), '1', 'Only the first job enters the queue');
    assert.equal(await one.redis.get(global), '1');
    await make().prewarm();
    assert.equal(await one.redis.get(prewarm), '1', 'Duplicate/occupied queue attempts consume nothing');
    await one.redis.eval("return redis.call('ZREM', KEYS[1], ARGV[1])", {
      keys: [BASE + ':queue'],
      arguments: ['rust']
    });
    await one.redis.del(make().stateKey('rust'));
    await one.redis.set(global, '6');
    await make().prewarm();
    assert.equal(await one.redis.get(prewarm), '1', 'Reserved user capacity cannot be spent by prewarming');
    await one.redis.set(global, '1');
    await one.redis.set(prewarm, '4');
    await make().prewarm();
    assert.equal(await one.redis.get(global), '1', 'Prewarm cap denial consumes no global job');
    const service = make();
    const request = (search, extra = {}) =>
      service.coverage({
        filters: filters(search),
        total: 0,
        broadTotal: 0,
        admissionKey: 'isolated-account',
        ...extra
      });
    await one.redis.set(global, '12');
    const limited = await request('EC2');
    assert.equal(limited.enrichment.reason, 'discovery_daily_budget');
    const now = new Date();
    assert.equal(
      limited.enrichment.nextEligibleAt,
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
    );
    // Only fixture-owned counters change; simulate a fresh day and a surviving expired status.
    await one.redis.set(global, '0');
    await one.redis.set(
      service.stateKey('EC2'),
      JSON.stringify({
        status: 'quota_limited',
        reason: 'discovery_daily_budget',
        nextEligibleAt: new Date(Date.now() - 1000).toISOString()
      })
    );
    const read = await request('EC2', { readOnly: true });
    assert.equal(read.enrichment.reason, 'catalog_only');
    assert.equal(await one.redis.get(global), '0');
    const admitted = await Promise.all([
      request('EC2', { revalidate: true }),
      request('EC2', { revalidate: true })
    ]);
    assert(admitted.every((response) => response.enrichment.status === 'queued'));
    assert.equal(await one.redis.get(global), '1', 'Concurrent eligible duplicate charges once');
    assert.equal(await one.redis.get(`${BASE}:user:isolated-account:day:${day}`), '1');
    assert.equal(await one.redis.get(prewarm), '4', 'User jobs never charge prewarm counters');
  }
);
