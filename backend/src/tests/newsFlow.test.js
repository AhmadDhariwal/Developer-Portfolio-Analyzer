const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { queryFor, matchesQuery, suggestionFor } = require('../utils/newsQuery');
const filters = (search) => ({ search, source: 'All', category: 'All', dateRange: 'week', page: 1 });

test('reviewed spelling suggestions preserve literal queries, aliases and arbitrary phrases', () => {
  assert.deepEqual(suggestionFor(' Kubernets '), { query: 'kubernetes', label: 'Kubernetes' });
  assert.equal(queryFor('kubernets').text, 'kubernets');
  for (const query of [
    'kubernetes',
    'k8s',
    'devops',
    'EC2',
    'generative ai',
    'kubernets operator',
    'noveltech'
  ])
    assert.equal(suggestionFor(query), null);
  assert.equal(queryFor('k8s').text, 'kubernetes');
  assert(matchesQuery({ title: 'Amazon EC2 deployment' }, 'EC2'));
  assert(!matchesQuery({ title: 'Amazon S3 deployment' }, 'EC2'));
  assert(matchesQuery({ title: 'Generative artificial intelligence tooling' }, 'generative ai'));
  assert(!matchesQuery({ title: 'General AI tooling' }, 'generative ai'));
});

test('typos, invalid manual searches and empty discover requests never enter admission', async () => {
  let reads = 0;
  const discovery = load('../services/newsDiscoveryService.js', {
    './redisCacheService': {
      getRedisCacheClient: () => {
        reads++;
        throw new Error('Unexpected admission');
      }
    },
    './newsDiscoveryProviders': { enabled: () => true }
  });
  for (const revalidate of [false, true]) {
    const result = await discovery.coverage({
      filters: filters('kubernets'),
      total: 0,
      broadTotal: 0,
      revalidate
    });
    assert.equal(result.enrichment.reason, 'spelling_suggestion');
    assert.equal(result.coverage.suggestion.query, 'kubernetes');
  }
  const invalid = await discovery.coverage({
    filters: filters('react OR private'),
    total: 0,
    broadTotal: 0,
    revalidate: true
  });
  assert.equal(invalid.enrichment.reason, 'unsupported_query');
  const empty = await discovery.coverage({ filters: filters(''), total: 0, broadTotal: 0 });
  assert.equal(empty.enrichment.reason, 'general_pool');
  assert.equal(reads, 0);
});

test('coverage exclusions use the longest selectable date without shortening source retention', () => {
  const catalog = require('../services/newsCatalogService');
  const now = Date.now();
  const broad = catalog.predicate(filters('kubernetes'), { broad: true });
  assert(Math.abs(now - new Date(broad.publishedAt.$gte).getTime() - 30 * 86400000) < 1000);
  const source = catalog.prepare({
    title: 'Kubernetes release',
    url: 'https://example.com/retention',
    source: 'Hacker News',
    publishedAt: new Date(now - 32 * 86400000),
    tags: ['kubernetes']
  });
  assert(source, 'Retained 32-day-old source records remain accepted');
});

test('freshly ingested older publications do not trigger stale discovery or stale cache labels', async () => {
  let jobs = 0;
  const discovery = load('../services/newsDiscoveryService.js', {
    './newsDiscoveryProviders': { enabled: () => true, available: () => ['hackernewssearch'] },
    './newsGovernanceService': { inspect: async () => ({ allowed: true }) },
    './redisCacheService': {
      getRedisCacheClient: () => ({
        get: async (key) => (key.endsWith(':worker') ? 'heartbeat' : null),
        eval: async (_script, options) => {
          jobs++;
          return options.arguments[2];
        }
      })
    }
  });
  const publishedAt = new Date(Date.now() - 2 * 86400000).toISOString();
  const lastUpdated = new Date().toISOString();
  const items = Array.from({ length: 6 }, (_, index) => ({
    title: `DevOps release ${index}`,
    url: `https://example.com/fresh/${index}`,
    source: 'Hacker News',
    publishedAt,
    tags: ['devops'],
    category: 'DevOps'
  }));
  const service = load('../services/newsService.js', {
    './newsCatalogService': {
      query: async () => ({
        items,
        total: 6,
        broadTotal: 6,
        historicalTotal: 6,
        sourceSummary: { 'Hacker News': 6 },
        newestArticleAt: publishedAt,
        lastUpdated
      })
    },
    './newsAdaptiveService': { record: async () => {} },
    './newsPoolService': { readPool: async () => null, freshness: () => 'fresh' },
    './newsDiscoveryService': {
      ...discovery,
      readTopic: async () => ({
        filters: { attemptedAt: Date.now() - 7200000 },
        allItems: [],
        lastUpdated: publishedAt
      })
    }
  });
  const result = await service.getNewsFeed({
    user: { _id: 'fresh-catalog' },
    query: { mode: 'explore', search: 'devops', discover: 'true' }
  });
  assert.equal(jobs, 0, 'Publication age is not catalog freshness');
  assert.equal(result.telemetry.queryFreshness, 'fresh');
  assert.equal(result.total, 6);
});
