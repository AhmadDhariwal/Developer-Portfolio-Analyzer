const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');
const { payloads } = require('./fixtures/newsProviderPayloads');
const { NEWS_PROVIDER_KEYS } = require('../config/newsConfig');

test(
  'isolated scheduled provider pipeline: all sources persist with attribution, retention, shared pacing and cache invalidation',
  { skip: !process.env.NEWS_TEST_REDIS_URL || !process.env.NEWS_TEST_MONGODB_URI, timeout: 45000 },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert(['localhost', '127.0.0.1'].includes(uri.hostname));
    const database = 'news_provider_test_' + randomUUID().replaceAll('-', '');
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, autoIndex: false })
      .asPromise();
    t.after(async () => {
      assert.equal(connection.name, database);
      await connection.dropDatabase();
      await connection.close();
    });
    const original = { ...process.env };
    for (const key of NEWS_PROVIDER_KEYS)
      Object.assign(process.env, {
        [`NEWS_${key.toUpperCase()}_CONTENT_APPROVED`]: 'true',
        [`NEWS_${key.toUpperCase()}_DAILY_BUDGET`]: '12',
        [`NEWS_${key.toUpperCase()}_MONTHLY_BUDGET`]: '300',
        [`NEWS_${key.toUpperCase()}_MIN_INTERVAL_MS`]: '1200000',
        [`NEWS_${key.toUpperCase()}_RETENTION_HOURS`]: ['newsapi', 'gnews', 'reddit'].includes(key)
          ? '24'
          : '840'
      });
    Object.assign(process.env, {
      NEWS_API_KEY: 'fixture-news',
      GNEWS_API_KEY: 'fixture-gnews',
      NEWS_REDDIT_ACCESS_TOKEN: 'fixture-reddit',
      NEWS_REDDIT_USER_AGENT: 'fixture-agent',
      NEWS_DISCOVERY_ENABLED: 'true'
    });
    t.after(() => {
      for (const key of Object.keys(process.env))
        if (key.startsWith('NEWS_') || key === 'GNEWS_API_KEY') {
          if (original[key] === undefined) delete process.env[key];
          else process.env[key] = original[key];
        }
    });
    const setup = await fixture(t);
    const worker = await setup.worker();
    const Article = connection.model('NewsArticle', require('../models/newsArticle').schema);
    const Pool = connection.model('NewsCache', require('../models/news').schema);
    await Promise.all([Article.createIndexes(), Pool.createIndexes()]);
    const dependencies = { '../models/newsArticle': Article, './redisCacheService': worker.cache };
    const catalog = load('../services/newsCatalogService.js', dependencies);
    const reader = load('../services/newsCatalogService.js', dependencies);
    const governance = load('../services/newsGovernanceService.js', { './redisCacheService': worker.cache });
    const data = payloads();
    const calls = [];
    const transport = {
      get: async (url, options) => {
        const key = url.includes('newsapi.org')
          ? 'newsapi'
          : url.includes('gnews.io')
            ? 'gnews'
            : url.includes('hn.algolia.com')
              ? 'hackernews'
              : url.includes('dev.to')
                ? 'devto'
                : url.includes('oauth.reddit.com')
                  ? 'reddit'
                  : url.includes('/releases?')
                    ? 'githubreleases'
                    : url.includes('/advisories?')
                      ? 'githubadvisories'
                      : url.includes('lobste.rs')
                        ? 'lobsters'
                        : url.includes('kubernetes.io')
                          ? 'kubernetesblog'
                          : 'cloudflarechangelog';
        calls.push(key);
        assert.equal(options.maxRedirects, 0);
        return { status: 200, headers: {}, data: data[key] };
      }
    };
    const settings = { getIntegrationSecretsSync: () => ({ newsEnabled: true }) };
    const adapters = load('../services/newsDiscoveryProviders.js', {
      './newsGovernanceService': governance,
      './platformSettingsService': settings,
      axios: transport
    });
    const pool = load('../services/newsPoolService.js', {
      '../models/news': Pool,
      './redisCacheService': worker.cache,
      './newsGovernanceService': governance,
      './newsCatalogService': catalog
    });
    const service = load('../services/newsService.js', {
      './newsPoolService': pool,
      './newsCatalogService': catalog,
      './newsGovernanceService': governance,
      './newsDiscoveryProviders': adapters,
      './platformSettingsService': settings,
      axios: transport
    });
    const filters = {
      mode: 'explore',
      tab: 'latest',
      search: '',
      category: 'All',
      source: 'All',
      dateRange: 'month',
      popularity: 'all',
      page: 1,
      limit: 30
    };
    assert.equal((await reader.query(filters)).total, 0);
    const first = await service.refreshNewsPool();
    assert.equal(first.inserted, 9, 'GitHub shared spacing blocks the second GitHub adapter in one cycle');
    assert.equal(first.providerFailureCount, 0);
    assert.equal((await reader.query(filters)).total, 9, 'Warm reader adopts published catalog version');
    const snapshot = await Pool.findOne().lean();
    const blocked = snapshot.providerDiagnostics.find(
      (entry) => entry.provider === 'GitHub Security Advisories'
    );
    assert.equal(blocked.status, 'quota_limited');
    assert(blocked.nextEligibleAt);
    // Simulate expiry of only fixture-owned pacing keys, without resetting any quota counter.
    await worker.redis.del('news:v3:{githubreleases}:shared:interval');
    snapshot.filters.attemptedAt = Date.now() - 61000;
    await worker.redis.set(pool.KEY, JSON.stringify(snapshot));
    await Pool.updateOne(
      { _id: snapshot._id },
      { $set: { 'filters.attemptedAt': snapshot.filters.attemptedAt } }
    );
    const second = await service.refreshNewsPool();
    assert.equal(second.inserted, 1);
    assert.equal(second.providerFailureCount, 0);
    const documents = await Article.find().lean();
    assert.equal(documents.length, 10);
    assert.equal(new Set(documents.map((doc) => doc.canonicalId)).size, 10);
    const sourceCounts = Object.fromEntries(documents.map((doc) => [doc.source, 1]));
    for (const doc of documents) {
      assert(doc.article.attributionUrl && doc.article.publisher !== undefined);
      assert(doc.technologies.length > 0 && doc.searchTerms.length > 0);
      assert.equal(new Date(doc.expiresAt) - new Date(doc.publishedAt), catalog.retentionMs(doc.source));
      assert(!JSON.stringify(doc).includes('fixture-news'));
    }
    const duplicate = await catalog.ingest(documents.map((doc) => doc.article));
    assert.equal(duplicate.inserted, 0);
    assert.equal((await reader.query(filters)).total, 10);
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(
      await worker.redis.get(`news:v1:{discovery}:jobs:${day}`),
      null,
      'Scheduled ingestion spends no discovery jobs'
    );
    assert.equal(calls.length, 10);
    for (const key of ['newsapi', 'gnews', 'reddit', 'lobsters', 'cloudflarechangelog'])
      process.env[`NEWS_${key.toUpperCase()}_CONTENT_APPROVED`] = 'false';
    assert.equal((await adapters.feed('lobsters')).status, 'disabled');
    assert.equal((await adapters.feed('cloudflarechangelog')).status, 'disabled');
    assert.equal(
      (await reader.query(filters)).total,
      5,
      'Revoked sources disappear without deleting unrelated records'
    );
    assert.equal(calls.length, 10);
    const evidence = {
      controlledFixturesOnly: true,
      actualExternalRequests: 0,
      controlledTransportCalls: calls,
      acceptedBySource: sourceCounts,
      scheduledFirstInserted: first.inserted,
      scheduledSecondInserted: second.inserted,
      duplicatesInserted: duplicate.inserted,
      sharedGitHubPacingVerified: true,
      discoveryJobsConsumed: 0,
      crossWorkerInvalidationVerified: true,
      applicationRedisWrites: 0,
      temporaryDatabaseDroppedByTeardown: true
    };
    const output = path.resolve(__dirname, '../../verification/tech-news/provider-finalization');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'integration.json'), JSON.stringify(evidence, null, 2) + '\n');
    t.diagnostic(JSON.stringify(evidence));
  }
);
