const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');

test(
  'isolated catalog: scheduled ingestion, discovery, indexed history, shared tags, refresh and worker caches',
  {
    skip: !process.env.NEWS_TEST_MONGODB_URI || !process.env.NEWS_TEST_REDIS_URL,
    timeout: 90000
  },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.ok(['127.0.0.1', 'localhost'].includes(uri.hostname));
    const database = 'news_catalog_test_' + randomUUID().replaceAll('-', '');
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, autoIndex: false, serverSelectionTimeoutMS: 3000 })
      .asPromise();
    t.after(async () => {
      assert.equal(connection.name, database);
      await connection.dropDatabase();
      await connection.close();
    });
    const Article = connection.model('NewsArticle', require('../models/newsArticle').schema);
    const Pool = connection.model('NewsCache', require('../models/news').schema);
    const Topic = connection.model('NewsTopicCache', require('../models/newsTopicCache').schema);
    await Promise.all([Article.createIndexes(), Pool.createIndexes(), Topic.createIndexes()]);
    const setup = await fixture(t);
    const one = await setup.worker(),
      two = await setup.worker();
    const original = { ...process.env };
    t.after(() => {
      for (const key of Object.keys(process.env))
        if (key.startsWith('NEWS_') || key === 'JWT_SECRET') {
          if (original[key] === undefined) delete process.env[key];
          else process.env[key] = original[key];
        }
    });
    Object.assign(process.env, {
      NEWS_DISCOVERY_ENABLED: 'true',
      NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED: 'true',
      NEWS_HACKERNEWSSEARCH_DAILY_BUDGET: '12',
      NEWS_HACKERNEWSSEARCH_MONTHLY_BUDGET: '300',
      NEWS_HACKERNEWSSEARCH_MIN_INTERVAL_MS: '60000',
      NEWS_HACKERNEWS_SHARED_DAILY_BUDGET: '84',
      NEWS_HACKERNEWS_SHARED_MONTHLY_BUDGET: '2500',
      NEWS_DISCOVERY_DAILY_JOBS: '12',
      JWT_SECRET: 'isolated-catalog-test-secret'
    });
    for (const key of [
      'DEVTOSEARCH',
      'GITHUBRELEASES',
      'GITHUBADVISORIES',
      'KUBERNETESBLOG',
      'CLOUDFLARECHANGELOG',
      'LOBSTERS'
    ])
      process.env[`NEWS_${key}_CONTENT_APPROVED`] = 'false';
    const makeCatalog = (worker) =>
      load('../services/newsCatalogService.js', {
        '../models/newsArticle': Article,
        './redisCacheService': worker.cache
      });
    const catalog = makeCatalog(one),
      otherCatalog = makeCatalog(two);
    const governor = load('../services/newsGovernanceService.js', { './redisCacheService': one.cache });
    const integrations = { getIntegrationSecretsSync: () => ({ newsEnabled: true }) };
    let calls = 0;
    const axios = {
      get: async (url) => {
        calls++;
        const parsed = new URL(url);
        if (parsed.hostname === 'dev.to') return { status: 200, headers: {}, data: [] };
        const query = parsed.searchParams.get('query');
        return {
          status: 200,
          headers: {},
          data: {
            hits: [
              {
                title: query ? 'Rust compiler: release update.' : 'Docker Kubernetes security release',
                url: `https://example.com/${query ? 'rust' : 'shared'}`,
                created_at: new Date().toISOString(),
                points: 50
              }
            ]
          }
        };
      }
    };
    const providers = load('../services/newsDiscoveryProviders.js', {
      axios,
      './newsGovernanceService': governor,
      './platformSettingsService': integrations
    });
    const adaptive = load('../services/newsAdaptiveService.js', {
      './newsCatalogService': catalog,
      './redisCacheService': one.cache
    });
    let service;
    const discovery = load('../services/newsDiscoveryService.js', {
      './newsService': { refreshNewsPool: () => service.refreshNewsPool() },
      './newsCatalogService': catalog,
      './newsAdaptiveService': adaptive,
      './redisCacheService': one.cache,
      './newsGovernanceService': governor,
      './newsDiscoveryProviders': providers,
      '../models/newsTopicCache': Topic
    });
    const pool = load('../services/newsPoolService.js', {
      '../models/news': Pool,
      './newsCatalogService': catalog,
      './redisCacheService': one.cache,
      './newsGovernanceService': governor
    });
    service = load('../services/newsService.js', {
      axios,
      './newsCatalogService': catalog,
      './newsAdaptiveService': adaptive,
      './newsPoolService': pool,
      './newsDiscoveryService': discovery,
      './newsGovernanceService': governor,
      './newsDiscoveryProviders': providers,
      './platformSettingsService': integrations,
      './developerSignalService': { getDeveloperSignals: async () => ({}), buildSignalHash: () => 'isolated' }
    });
    const filters = {
      search: '',
      mode: 'explore',
      tab: 'latest',
      source: 'All',
      category: 'All',
      dateRange: 'month',
      popularity: 'all',
      page: 1,
      limit: 12
    };
    await service.refreshNewsPool();
    assert.equal(await Article.countDocuments(), 1);
    assert.equal((await catalog.query({ ...filters, search: 'docker' })).total, 1);
    assert.equal((await catalog.query({ ...filters, search: 'docker unrelatedword' })).total, 0);
    assert.equal((await catalog.query({ ...filters, search: 'k8s' })).total, 1);
    const shared = await Article.findOne().lean();
    const migration = load('../scripts/migrateNewsCatalog.js', {
      '../models/newsArticle': Article,
      '../models/news': Pool,
      '../models/newsTopicCache': Topic,
      '../services/newsCatalogService': catalog
    });
    const legacyBefore = JSON.stringify(await Pool.findOne().lean());
    assert.equal((await migration.migrate()).apply, false);
    assert.equal(await Article.countDocuments(), 1);
    assert.equal((await migration.migrate({ apply: true })).inserted, 0);
    assert.equal(JSON.stringify(await Pool.findOne().lean()), legacyBefore);

    await Promise.all(
      Array.from({ length: 8 }, () => catalog.ingest([{ ...shared.article, source: 'Dev.to' }]))
    );
    assert.equal(await Article.countDocuments(), 1);
    assert.equal((await Article.findOne().lean()).expiresAt.getTime(), shared.expiresAt.getTime());
    await catalog.ingest([
      {
        ...shared.article,
        title: 'Docker older historical release',
        url: 'https://example.com/history',
        publishedAt: new Date(Date.now() - 20 * 86400000)
      }
    ]);
    assert.equal((await otherCatalog.query({ ...filters, dateRange: 'week' })).total, 1);
    assert.equal((await otherCatalog.query(filters)).total, 2);
    const beforeBrowse = calls;
    for (const query of [
      { date: 'month' },
      { search: 'docker', bypassCache: 'true' },
      { page: '2', limit: '1' },
      { category: 'DevOps' }
    ]) {
      const result = await service.getNewsFeed({
        user: { _id: 'one' },
        query: { mode: 'explore', ...query }
      });
      assert.equal(result.recommendedBasedOn, null);
    }
    assert.equal(calls, beforeBrowse);
    await one.redis.set(discovery.HEARTBEAT, String(Date.now()));
    await one.redis.del('news:v3:{hackernews}:shared:interval');
    const admitted = await discovery.coverage({
      filters: { ...filters, search: 'rust' },
      total: 0,
      broadTotal: 0,
      admissionKey: 'one'
    });
    assert.equal(admitted.enrichment.status, 'queued');
    await discovery.processQueue();
    assert.equal((await otherCatalog.query({ ...filters, search: 'rust' })).total, 1);
    assert.equal(calls, beforeBrowse + 1);
    assert.equal((await catalog.query({ ...filters, search: 'compiler update' })).total, 1);
    const denied = await governor.reserve('hackernewssearch');
    assert.equal(denied.allowed, false);
    await Pool.updateOne({ cacheKey: pool.KEY }, { $set: { 'filters.attemptedAt': Date.now() - 61000 } });
    await one.redis.del(pool.KEY);
    for (const key of [
      'news:v3:{hackernews}:interval',
      'news:v3:{devto}:interval',
      'news:v3:{hackernews}:shared:interval',
      'news:v3:{devto}:shared:interval'
    ])
      await one.redis.del(key);
    const broad = await discovery.coverage({
      filters,
      total: 3,
      broadTotal: 3,
      admissionKey: 'one',
      revalidate: true
    });
    assert.equal(broad.enrichment.status, 'queued');
    assert.equal((await discovery.processQueue()).status, 'no_newer');
    const polled = await discovery.coverage({ filters, total: 3, broadTotal: 3, readOnly: true });
    assert.equal(polled.enrichment.status, 'no_newer');
    assert.ok(polled.enrichment.lastSuccessfulCheckAt);
    for (let attempt = 0; attempt < 8; attempt++) await adaptive.record('rust', 'same-account');
    assert.equal((await adaptive.candidates()).length, 0);
    await adaptive.record('rust', 'second-account');
    await adaptive.record('rust', 'third-account');
    assert.equal((await adaptive.candidates())[0].topic, 'rust');
    // TTL readers enforce expiry before the asynchronous Mongo TTL monitor runs.
    await Article.updateOne(
      { canonicalId: shared.canonicalId },
      { $set: { expiresAt: new Date(Date.now() - 1) } }
    );
    assert.equal((await catalog.query({ ...filters, search: 'kubernetes' }, { bypass: true })).total, 0);
    const plans = [];
    for (const [search, extra] of [
      ['rust', {}],
      ['compiler update', {}],
      ['', { source: 'Hacker News' }],
      ['', { category: 'Frontend' }],
      ['', {}]
    ]) {
      const explain = await Article.find(catalog.predicate({ ...filters, search, ...extra }))
        .sort({ publishedAt: -1, canonicalId: 1 })
        .explain('executionStats');
      assert.ok(!JSON.stringify(explain.queryPlanner.winningPlan).includes('COLLSCAN'));
      plans.push({
        search,
        extra,
        examined: explain.executionStats.totalDocsExamined,
        plan: explain.queryPlanner.winningPlan
      });
    }
    require('node:fs').writeFileSync(
      require('node:path').resolve(
        __dirname,
        '../../verification/tech-news/runtime-audit/catalog-results.json'
      ),
      JSON.stringify(
        {
          status: 'VERIFIED',
          infrastructure: 'disposable localhost MongoDB 8.2 and Redis 7.2.7',
          controlledProviderCalls: calls,
          catalogRecords: await Article.countDocuments(),
          indexes: (await Article.collection.indexes()).map((entry) => entry.name),
          plans
        },
        null,
        2
      )
    );
    t.diagnostic(
      JSON.stringify({
        catalogRecords: await Article.countDocuments(),
        providerCalls: calls,
        indexes: (await Article.collection.indexes()).map((index) => index.name),
        plans
      })
    );
  }
);
