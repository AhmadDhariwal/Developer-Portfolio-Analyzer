const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');

test(
  'isolated adaptive demand selects a topic, reserves governed prewarm work and persists through the worker',
  {
    skip: !process.env.NEWS_TEST_REDIS_URL || !process.env.NEWS_TEST_MONGODB_URI,
    timeout: 30000
  },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert(['localhost', '127.0.0.1'].includes(uri.hostname));
    const database = 'news_adaptive_test_' + randomUUID().replaceAll('-', '');
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, autoIndex: false })
      .asPromise();
    t.after(async () => {
      assert.equal(connection.name, database);
      await connection.dropDatabase();
      await connection.close();
    });
    const original = { ...process.env };
    t.after(() => {
      for (const key of Object.keys(process.env))
        if (key.startsWith('NEWS_') || key === 'JWT_SECRET') {
          if (original[key] === undefined) delete process.env[key];
          else process.env[key] = original[key];
        }
    });
    Object.assign(process.env, {
      JWT_SECRET: 'isolated-adaptive-demand-secret',
      NEWS_DISCOVERY_ENABLED: 'true',
      NEWS_DISCOVERY_PREWARM_ENABLED: 'true',
      NEWS_PREWARM_STRATEGY: 'demand-only',
      NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED: 'true',
      NEWS_HACKERNEWSSEARCH_DAILY_BUDGET: '12',
      NEWS_HACKERNEWSSEARCH_MONTHLY_BUDGET: '300',
      NEWS_DISCOVERY_DAILY_JOBS: '12',
      NEWS_PREWARM_RESERVED_USER_JOBS: '6',
      NEWS_DISCOVERY_PREWARM_DAILY_JOBS: '4'
    });
    const setup = await fixture(t);
    const worker = await setup.worker();
    const Article = connection.model('NewsArticle', require('../models/newsArticle').schema);
    const Topic = connection.model('NewsTopicCache', require('../models/newsTopicCache').schema);
    await Promise.all([Article.createIndexes(), Topic.createIndexes()]);
    const catalog = load('../services/newsCatalogService.js', {
      '../models/newsArticle': Article,
      './redisCacheService': worker.cache
    });
    const adaptive = load('../services/newsAdaptiveService.js', {
      './newsCatalogService': catalog,
      './redisCacheService': worker.cache
    });
    const governance = load('../services/newsGovernanceService.js', { './redisCacheService': worker.cache });
    let calls = 0;
    const providers = load('../services/newsDiscoveryProviders.js', {
      './newsGovernanceService': governance,
      './platformSettingsService': { getIntegrationSecretsSync: () => ({ newsEnabled: true }) },
      axios: {
        get: async () => {
          calls++;
          return {
            status: 200,
            headers: {},
            data: {
              hits: [
                {
                  title: 'Rust compiler security update',
                  url: 'https://example.com/rust-runtime',
                  created_at: new Date().toISOString()
                }
              ]
            }
          };
        }
      }
    });
    const available = providers.available;
    providers.available = (topic) => available(topic).filter((key) => key === 'hackernewssearch');
    const makeDiscovery = () =>
      load('../services/newsDiscoveryService.js', {
        './newsCatalogService': catalog,
        './newsAdaptiveService': adaptive,
        './newsGovernanceService': governance,
        './redisCacheService': worker.cache,
        './newsDiscoveryProviders': providers,
        '../models/newsTopicCache': Topic
      });
    for (let count = 0; count < 4; count++) await adaptive.record('rust', 'private-account-one');
    assert.deepEqual(await adaptive.candidates(), []);
    await adaptive.record('rust', 'private-account-two');
    await adaptive.record('rust', 'private-account-three');
    assert.equal((await adaptive.candidates())[0].searches, 3);
    const discovery = makeDiscovery();
    await discovery.prewarm();
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(await worker.redis.get(`news:v1:{discovery}:jobs:${day}`), '1');
    assert.equal(calls, 0);
    assert.equal((await discovery.processQueue()).status, 'ready');
    assert.equal(calls, 1);
    const record = await Article.findOne().lean();
    assert(record.technologies.includes('rust') && record.technologies.includes('security'));
    assert(!JSON.stringify(record).includes('private-account'));
    const filters = {
      mode: 'explore',
      tab: 'latest',
      search: 'rust',
      dateRange: 'month',
      source: 'All',
      category: 'All',
      popularity: 'all',
      page: 1,
      limit: 12
    };
    assert.equal((await catalog.query(filters)).total, 1);
    assert.equal(calls, 1, 'Catalog revalidation must not contact a provider');
    for (const account of ['one', 'two', 'three']) await adaptive.record('docker', account);
    process.env.NEWS_PREWARM_RESERVED_USER_JOBS = '12';
    await makeDiscovery().prewarm();
    assert.equal(
      await worker.redis.get(`news:v1:{discovery}:jobs:${day}`),
      '1',
      'Prewarm cannot spend the reserved user jobs'
    );
    assert.equal(calls, 1);
    t.diagnostic(
      JSON.stringify({
        distinctDemand: 3,
        prewarmJobs: 1,
        controlledProviderCalls: calls,
        catalogPersisted: true,
        reservedUserBudgetPreserved: true
      })
    );
  }
);
