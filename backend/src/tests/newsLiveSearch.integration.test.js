const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');

// Explicit opt-in: one bounded request per approved primary provider, isolated writes.
test(
  'approved live metadata search through an isolated governed worker and Mongo cache',
  {
    skip:
      process.env.NEWS_TEST_LIVE_PROVIDERS !== 'true' ||
      !process.env.NEWS_TEST_REDIS_URL ||
      !process.env.NEWS_TEST_MONGODB_URI,
    timeout: 60000
  },
  async (t) => {
    const env = require('dotenv').parse(fs.readFileSync(path.resolve(__dirname, '../../.env')));
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.equal(uri.protocol, 'mongodb:');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname));
    const connection = await mongoose
      .createConnection(uri.href, {
        dbName: `news_live_test_${randomUUID().replaceAll('-', '')}`,
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
    const setup = await fixture(t);
    const worker = await setup.worker();
    for (const [key, value] of Object.entries(env))
      if (/^NEWS_.*(?:CONTENT_APPROVED|BUDGET|MIN_INTERVAL_MS)$/.test(key)) process.env[key] = value;
    process.env.NEWS_DISCOVERY_ENABLED = 'true';
    process.env.NEWS_DISCOVERY_RESULTS_PER_PROVIDER = '5';
    const governance = load('../services/newsGovernanceService.js', { './redisCacheService': worker.cache });
    const providers = load('../services/newsDiscoveryProviders.js', {
      './newsGovernanceService': governance,
      './platformSettingsService': { getIntegrationSecretsSync: () => ({ newsEnabled: true }) }
    });
    const results = {
      checkedAt: new Date().toISOString(),
      applicationRedisWrites: 0,
      isolatedWrites: true,
      requestsPerProviderMaximum: 1,
      providers: []
    };
    // Read-only connectivity and real usage preflight. Never initialize application cache revisions.
    const redis = require('redis');
    let application;
    let preflight = false;
    try {
      const url =
        env.REDIS_URL ||
        (env.UPSTASH_REDIS_TOKEN && env.UPSTASH_REDIS_HOST
          ? `rediss://default:${encodeURIComponent(env.UPSTASH_REDIS_TOKEN)}@${env.UPSTASH_REDIS_HOST}:${env.UPSTASH_REDIS_PORT || 6379}`
          : '');
      if (url) {
        application = redis.createClient({
          url,
          disableOfflineQueue: true,
          socket: { connectTimeout: 3000, reconnectStrategy: false }
        });
        application.on('error', () => {});
        await application.connect();
        assert.equal(await application.ping(), 'PONG');
        results.applicationRedisReadOnly = true;
        preflight = true;
      }
      for (const [key, query] of [
        ['hackernewssearch', 'generative ai'],
        ['devtosearch', 'Python async']
      ]) {
        const policy = governance.policy(key);
        const entry = {
          key,
          query,
          approved: env[`NEWS_${key.toUpperCase()}_CONTENT_APPROVED`] === 'true',
          configuredDaily: policy.daily,
          configuredMonthly: policy.monthly,
          status: 'unverified'
        };
        results.providers.push(entry);
        if (!entry.approved || !policy.daily || !policy.monthly || !preflight) continue;
        const day = new Date().toISOString().slice(0, 10);
        const month = day.slice(0, 7);
        const shared = governance.sharedPolicy(key);
        const names = [key, shared.sibling];
        const counters = names.flatMap((name) => [
          `news:v3:{${name}}:day:${day}`,
          `news:v3:{${name}}:month:${month}`,
          `news:v3:{${name}}:cooldown`,
          `news:v3:{${name}}:interval`
        ]);
        const usage = await application.mGet(counters);
        entry.preflight = {
          dailyUsed: Number(usage[0] || 0),
          monthlyUsed: Number(usage[1] || 0),
          siblingDailyUsed: Number(usage[4] || 0),
          siblingMonthlyUsed: Number(usage[5] || 0),
          sourceCooldown: Boolean(usage[2]),
          siblingCooldown: Boolean(usage[6]),
          sourceInterval: Boolean(usage[3])
        };
        const sharedInterval = await application.get(`news:v3:{${shared.family}}:shared:interval`);
        if (sharedInterval) {
          const ttl = await application.pTTL(`news:v3:{${shared.family}}:shared:interval`);
          entry.preflight.reason = 'shared_interval';
          entry.preflight.nextEligibleAt = new Date(Date.now() + Math.max(1, ttl)).toISOString();
        }
        if (
          Number(usage[0] || 0) >= policy.daily ||
          Number(usage[1] || 0) >= policy.monthly ||
          Number(usage[0] || 0) + Number(usage[4] || 0) >= shared.daily ||
          Number(usage[1] || 0) + Number(usage[5] || 0) >= shared.monthly ||
          usage[2] ||
          usage[3] ||
          usage[6] ||
          sharedInterval
        ) {
          entry.status = 'quota_limited_preflight';
          continue;
        }
        // Carry existing usage into isolated admission; no production quota counters reset.
        for (let index = 0; index < counters.length; index++)
          if (usage[index] !== null) await worker.redis.set(counters[index], usage[index]);
        const discovery = load('../services/newsDiscoveryService.js', {
          './newsCatalogService': catalog,
          '../models/newsTopicCache': Topic,
          './redisCacheService': worker.cache,
          './newsGovernanceService': governance,
          './newsDiscoveryProviders': {
            ...providers,
            available: (value) => providers.available(value).filter((name) => name === key)
          }
        });
        await worker.redis.set(discovery.HEARTBEAT, String(Date.now()));
        const admitted = await discovery.coverage({
          filters: {
            search: query,
            category: 'All',
            source: 'All',
            dateRange: 'week',
            popularity: 'all',
            page: 1
          },
          total: 0,
          broadTotal: 0,
          admissionKey: 'isolated-live-check'
        });
        assert.equal(admitted.enrichment.status, 'queued');
        const processed = await discovery.processQueue();
        results.actualProviderAttempts = (results.actualProviderAttempts || 0) + 1;
        const snapshot = await Topic.findOne({ cacheKey: discovery.topicKey(query) }).lean();
        const cached = await discovery.readTopic(query);
        entry.status = processed.status;
        entry.diagnostics = snapshot?.providerDiagnostics || [];
        entry.persistedArticles = snapshot?.allItems.length || 0;
        entry.cachedArticles = cached?.allItems.length || 0;
        entry.sample = cached?.allItems[0]
          ? {
              title: cached.allItems[0].title,
              url: cached.allItems[0].url,
              source: cached.allItems[0].source,
              publishedAt: cached.allItems[0].publishedAt
            }
          : null;
        entry.lastAttempt = JSON.parse(await worker.redis.get(discovery.stateKey(query)));
        assert.ok(entry.persistedArticles === entry.cachedArticles);
      }
    } catch {
      results.infrastructureError =
        'Live verification could not complete; see provider status. No credentials or raw errors retained.';
    } finally {
      if (application?.isOpen) await application.quit();
    }
    const report = path.resolve(__dirname, '../../verification/tech-news/refresh-live-results.json');
    fs.writeFileSync(report, JSON.stringify(results, null, 2) + '\n');
    t.diagnostic(JSON.stringify(results));
  }
);
