const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { queryFor, matchesQuery } = require('../utils/newsQuery');
const { normalizeItem } = require('../utils/newsFormatter');

test('news configuration rejects malformed flags, quotas and cache bounds before startup', () => {
  const { z } = require('zod');
  const { newsEnvShape, NEWS_PROVIDER_KEYS } = require('../config/newsConfig');
  const schema = z.object(newsEnvShape);
  assert.ok(schema.safeParse({ NEWS_NEWSAPI_DAILY_BUDGET: '0', NEWS_NEWSAPI_CONTENT_APPROVED: 'false' }).success);
  for (const entry of [
    { NEWS_DISCOVERY_ENABLED: 'yes' },
    { NEWS_DISCOVERY_DAILY_JOBS: '0' },
    { NEWS_HACKERNEWSSEARCH_DAILY_BUDGET: '-1' },
    { NEWS_DEVTO_SHARED_DAILY_BUDGET: 'NaN' },
    { NEWS_QUERY_NEGATIVE_TTL_MS: '86400000' },
    { NEWS_QUERY_MEMORY_ENTRIES: '1000000' }
  ])
    assert.equal(schema.safeParse(entry).success, false);
  assert.ok(NEWS_PROVIDER_KEYS.includes('cloudflarechangelog'));
  assert.ok(!NEWS_PROVIDER_KEYS.includes('arxiv'));
});

test('bounded free text retains multiword meaning, normalizes aliases and rejects private/complex input', () => {
  for (const value of [
    'generative ai',
    'Next.js updates',
    'AWS Lambda',
    'Docker vulnerabilities',
    'Python async',
    'NewTech SDK'
  ])
    assert.ok(queryFor(value), value);
  assert.equal(queryFor(' Generative   AI ').key, queryFor('genai').key);
  assert.equal(queryFor('Node.js').key, queryFor('nodejs').key);
  assert.equal(queryFor('generative artificial intelligence').text, 'generative ai');
  assert.match(queryFor('generative ai').key, /^q-[a-f0-9]{32}$/);
  for (const value of [
    'a',
    '12345',
    'https://example.com',
    'person@example.com',
    'react OR vue',
    'react AND vue',
    'a '.repeat(7),
    'x'.repeat(81),
    'react\nsecret',
    'a/b/c',
    'abcdef12-1234-1234-1234-123456789abc',
    'eyJabc.secret.token',
    '20261234567890'
  ])
    assert.equal(queryFor(value), null, value);
  assert.ok(matchesQuery({ title: 'Generative artificial intelligence systems' }, 'generative ai'));
  assert.ok(matchesQuery({ title: 'Asynchronous Python techniques' }, 'Python async'));
  assert.ok(matchesQuery({ title: 'Next.js 17 release' }, 'Next.js updates'));
  assert.ok(matchesQuery({ title: 'Docker vulnerability advisory' }, 'Docker vulnerabilities'));
  assert.equal(matchesQuery({ title: 'Python release' }, 'Python async'), false);
  assert.equal(matchesQuery({ title: 'AI hardware' }, 'generative ai'), false);
});

test('free-text provider requests use fixed keyword APIs and exclude unrelated fixed feeds', async () => {
  const before = process.env.NEWS_DISCOVERY_ENABLED;
  process.env.NEWS_DISCOVERY_ENABLED = 'true';
  const requests = [];
  const providers = load('../services/newsDiscoveryProviders.js', {
    './platformSettingsService': { getIntegrationSecretsSync: () => ({}) },
    './newsGovernanceService': {
      policy: () => ({ daily: 12, monthly: 300 }),
      reserve: async () => ({ allowed: true }),
      finish: async () => {}
    },
    axios: {
      get: async (url, options) => {
        requests.push({ url, options });
        if (url.includes('cloudflare.com'))
          return {
            status: 200,
            headers: {},
            data: `<rss><channel><item><title>Cloudflare Workers update</title><link>https://developers.cloudflare.com/changelog/example</link><pubDate>${new Date().toUTCString()}</pubDate><description>Do not retain full bodies</description></item></channel></rss>`
          };
        const item = {
          title: 'Generative AI engineering',
          url: 'https://example.com/generative-ai',
          published_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        };
        return { status: 200, headers: {}, data: url.includes('algolia') ? { hits: [item] } : [item] };
      }
    }
  });
  try {
    assert.deepEqual(providers.available('generative ai'), ['hackernewssearch', 'devtosearch']);
    assert.ok(!providers.available('react').includes('githubadvisories'));
    assert.ok(providers.available('Docker vulnerabilities').includes('githubadvisories'));
    for (const key of providers.available('generative ai')) {
      const output = await providers.search(key, 'generative ai');
      assert.equal(output.status, 'success');
      assert.equal(output.items.length, 1);
    }
    assert.equal(new URL(requests[0].url).searchParams.get('query'), 'generative ai');
    assert.equal(new URL(requests[1].url).pathname, '/api/articles/search');
    assert.equal(new URL(requests[1].url).searchParams.get('q'), 'generative ai');
    assert.equal(requests[1].options.headers['api-key'], undefined);
    assert.equal(requests[1].options.maxRedirects, 0);
    assert.equal(requests[1].options.maxContentLength, 1048576);
    const cloudflare = await providers.search('cloudflarechangelog', 'Cloudflare workers');
    assert.equal(cloudflare.status, 'success');
    assert.equal(cloudflare.items[0].source, 'Cloudflare Changelog');
    assert.equal(cloudflare.items[0].publisher, 'Cloudflare Changelog');
    assert.equal(cloudflare.items[0].description, '');
    assert.equal(new URL(requests[2].url).pathname, '/changelog/rss/index.xml');
  } finally {
    if (before === undefined) delete process.env.NEWS_DISCOVERY_ENABLED;
    else process.env.NEWS_DISCOVERY_ENABLED = before;
  }
});

test('worker downtime, user admission denial and empty-cache states remain distinct and account-safe', async () => {
  let evaluations = 0;
  let online = false;
  const providers = require('../services/newsDiscoveryProviders');
  const service = load('../services/newsDiscoveryService.js', {
    '../models/newsTopicCache': {},
    './newsGovernanceService': { inspect: async () => ({ allowed: true }) },
    './newsDiscoveryProviders': { ...providers, enabled: () => true, available: () => ['hackernewssearch'] },
    './redisCacheService': {
      getRedisCacheClient: () => ({
        get: async (key) => (online && key.endsWith(':worker') ? 'heartbeat' : null),
        eval: async (_script, options) => {
          evaluations++;
          return options.arguments[7] === 'denied' ? options.arguments[10] : options.arguments[2];
        }
      })
    }
  });
  const filters = {
    search: 'generative ai',
    source: 'All',
    category: 'All',
    dateRange: 'week',
    popularity: 'all',
    page: 1
  };
  const denied = await service.coverage({ filters, total: 0, broadTotal: 0, admissionKey: 'denied' });
  assert.equal(denied.enrichment.reason, 'user_discovery_budget');
  const other = await service.coverage({ filters, total: 0, broadTotal: 0, admissionKey: 'other' });
  assert.equal(other.enrichment.status, 'worker_unavailable');
  assert.equal(evaluations, 2);
  online = true;
  const page = await service.coverage({
    filters: { ...filters, search: 'python async', page: 2 },
    total: 0,
    broadTotal: 0
  });
  assert.equal(page.enrichment.status, 'not_needed');
  assert.equal(evaluations, 2);
});

test('This Week excludes older matching results and returns explicit broader-date guidance', async () => {
  const item = normalizeItem({
    title: 'Generative AI practical engineering',
    url: 'https://example.com/old',
    source: 'Hacker News',
    publishedAt: new Date(Date.now() - 10 * 86400000)
  });
  const real = load('../services/newsDiscoveryService.js', { '../models/newsTopicCache': {} });
  const feed = load('../services/newsService.js', {
    './newsPoolService': { readPool: async () => ({ allItems: [item] }), freshness: () => 'fresh' },
    './newsDiscoveryService': { readTopic: async () => null, coverage: real.coverage },
    './developerSignalService': { getDeveloperSignals: () => assert.fail('Explore must remain independent') }
  });
  const week = await feed.getNewsFeed({
    user: { _id: 'one' },
    query: { mode: 'explore', search: 'generative ai', date: 'week' }
  });
  assert.equal(week.total, 0);
  assert.equal(week.coverage.dateExcludedMatches, 1);
  assert.equal(week.coverage.suggestedDate, 'month');
  const month = await feed.getNewsFeed({
    user: { _id: 'two' },
    query: { mode: 'explore', search: 'generative ai', date: 'month' }
  });
  assert.equal(month.total, 1);
  assert.equal(month.items[0].rankScore, null);
});
