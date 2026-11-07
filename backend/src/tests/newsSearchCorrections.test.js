const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { normalizeItem } = require('../utils/newsFormatter');
const { queryFor } = require('../utils/newsQuery');

const article = (title, index) =>
  normalizeItem({
    title,
    url: `https://example.com/news/${index}`,
    source: 'Hacker News',
    publishedAt: new Date()
  });

test('legacy For You category/search are ignored while date, source, ranking and Explore remain intact', async () => {
  const items = [article('React engineering update', 1), article('Docker Kubernetes security release', 2)];
  const seen = [];
  let demand = 0;
  const service = load('../services/newsService.js', {
    './newsCatalogService': { query: async () => null },
    './newsAdaptiveService': {
      record: async () => {
        demand++;
      }
    },
    './newsPoolService': { readPool: async () => ({ allItems: items }), freshness: () => 'fresh' },
    './newsDiscoveryService': {
      readTopic: async () => null,
      coverage: async (input) => {
        seen.push(input);
        return {};
      }
    },
    './developerSignalService': {
      getDeveloperSignals: async () => ({ resumeSignals: { skills: ['React'] } }),
      buildSignalHash: () => 'personalized-regression'
    }
  });
  const user = { _id: 'for-you-regression' };
  const base = await service.getNewsFeed({ user });
  const hidden = await service.getNewsFeed({
    user,
    query: { category: 'DevOps', search: 'no matching words' }
  });
  assert.deepEqual(hidden.items, base.items);
  assert.equal(hidden.filters.category, 'All');
  assert.equal(hidden.filters.search, '');
  assert(hidden.recommendedBasedOn);
  assert(hidden.items.every((item) => Number.isFinite(item.rankScore)));
  const filtered = await service.getNewsFeed({ user, query: { source: 'Dev.to', date: 'today' } });
  assert.equal(filtered.total, 0);
  assert.equal(filtered.filters.source, 'Dev.to');
  assert.equal(filtered.filters.dateRange, 'today');
  assert.equal(demand, 0);
  const explore = await service.getNewsFeed({
    user,
    query: { mode: 'explore', category: 'Frontend', search: 'devops' }
  });
  assert.equal(explore.total, 0);
  assert.equal(explore.filters.category, 'Frontend');
  assert.equal(explore.filters.search, 'devops');
  assert.equal(explore.recommendedBasedOn, null);
  assert(seen.every((entry) => entry.readOnly));
});

test('legacy hidden search syntax is ignored only in For You; Explore retains validation', () => {
  const { validateFeed } = require('../middleware/newsMiddleware');
  let accepted = false;
  validateFeed({ query: { category: 'DevOps', search: 'react OR docker' } }, { set() {} }, () => {
    accepted = true;
  });
  assert(accepted);
  let code;
  validateFeed(
    { query: { mode: 'explore', search: 'react OR docker' } },
    {
      status: (value) => {
        code = value;
        return { json() {} };
      }
    },
    () => assert.fail('Explore search validation must remain')
  );
  assert.equal(code, 400);
});

test('authenticated feed envelope includes authoritative server time without changing legacy fields', async () => {
  const controller = load('../controllers/newsController.js', {
    '../models/newsSavedItem': {},
    '../services/newsService': {
      getNewsFeed: async () => ({
        items: [],
        total: 0,
        filters: { limit: 12, page: 1, tab: 'latest', mode: 'explore' }
      })
    }
  });
  let payload;
  const before = Date.now();
  await controller.getNews(
    { user: {}, query: {} },
    {
      json: (value) => {
        payload = value;
      }
    }
  );
  assert(Date.parse(payload.serverTime) >= before);
  assert.equal(payload.mode, 'explore');
  assert.equal(payload.totalPages, 1);
  assert.deepEqual(payload.items, []);
});

test('DevOps catalog totals explain excluded filters independently of the current result page', async () => {
  const service = load('../services/newsService.js', {
    './newsCatalogService': {
      query: async () => ({ items: [], total: 0, broadTotal: 34, historicalTotal: 0, sourceSummary: {} })
    },
    './newsAdaptiveService': { record: async () => {} },
    './newsPoolService': { readPool: async () => null, freshness: () => 'fresh' },
    './newsDiscoveryService': {
      readTopic: async () => null,
      coverage: async (input) => ({ coverage: input })
    }
  });
  const result = await service.getNewsFeed({
    user: { _id: 'one' },
    query: { mode: 'explore', search: 'devops', category: 'Frontend' }
  });
  assert.equal(result.total, 0);
  assert.equal(result.coverage.filterExcludedMatches, 34);
});

test('explicit DevOps search queues one eligible gap; sufficient fresh, filters and pagination never queue', async () => {
  let jobs = 0;
  const discovery = load('../services/newsDiscoveryService.js', {
    '../models/newsTopicCache': {},
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
  const filters = {
    mode: 'explore',
    search: 'devops',
    source: 'All',
    category: 'All',
    dateRange: 'week',
    popularity: 'all',
    page: 1
  };
  assert.equal(queryFor('  DevOps  ').text, 'devops');
  const fresh = await discovery.coverage({ filters, total: 6, broadTotal: 6, queryAttemptAt: Date.now() });
  assert.equal(fresh.enrichment.status, 'not_needed');
  await discovery.coverage({ filters, total: 0, broadTotal: 0, readOnly: true });
  await discovery.coverage({ filters: { ...filters, page: 2 }, total: 0, broadTotal: 0 });
  await discovery.coverage({ filters: { ...filters, category: 'Frontend' }, total: 0, broadTotal: 34 });
  assert.equal(jobs, 0);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => discovery.coverage({ filters, total: 0, broadTotal: 0 }))
  );
  assert(results.every((value) => value.enrichment.status === 'queued'));
  assert.equal(jobs, 1);
});
