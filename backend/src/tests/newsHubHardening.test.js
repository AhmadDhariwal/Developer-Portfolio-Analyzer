const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { normalizeItem, fromNewsAPI, inferCategory } = require('../utils/newsFormatter');
const { rankNewsItems } = require('../utils/newsRanker');
const { safeNewsUrl } = require('../utils/newsUrl');
const article = (extra = {}) => ({
  title: 'React security engineering update',
  source: 'Dev.to',
  url: 'https://example.com/React',
  publishedAt: new Date(),
  popularity: 0,
  ...extra
});

test('article quality rejects missing, invalid, future and expired dates and unsafe URLs', () => {
  for (const publishedAt of [
    undefined,
    'invalid',
    new Date(Date.now() + 86400000),
    new Date(Date.now() - 36 * 86400000)
  ])
    assert.equal(normalizeItem(article({ publishedAt })), null);
  for (const url of [
    'javascript:alert(1)',
    'http://127.0.0.1/x',
    'http://2130706433/x',
    'https://[::1]/x',
    'http://user:pass@example.com/x',
    'http://example.local/x',
    'http://localhost/x'
  ])
    assert.equal(safeNewsUrl(url), '');
  assert.equal(
    safeNewsUrl('https://example.com/Case?utm_source=test&b=2&a=1#fragment'),
    'https://example.com/Case?a=1&b=2'
  );
  assert.equal(normalizeItem(article({ popularity: Infinity })).popularity, 0);
  assert.equal(normalizeItem(article({ popularity: -10 })).popularity, 0);
  assert.equal(normalizeItem(article({ source: 'Invented' })), null);
  assert.equal(inferCategory('Email delivery', ''), 'Backend');
  const news = fromNewsAPI({
    articles: [
      {
        title: 'Engineering news update',
        url: 'https://publisher.com/news',
        publishedAt: new Date(),
        source: { name: 'Publisher' },
        content: 'full copyrighted content'
      }
    ]
  });
  assert.equal(news[0].description, '');
  assert.equal(news[0].publisher, 'Publisher');
  assert.equal(news[0].popularity, 0);
});

test('ranking preserves 50/30/20, stable ties and separates recommendations from detected skills', () => {
  const original = Date.now;
  Date.now = () => 1800000000000;
  try {
    const item = article({
      id: 'b',
      title: 'React engineering update',
      publishedAt: new Date(Date.now() - 24 * 3600000)
    });
    const context = { careerStack: 'Frontend', recommendationTechnologies: ['React'], skillGaps: ['React'] };
    const [scored] = rankNewsItems([item], context);
    const expected = Math.round(((1 / 7) * 0.5 + (1 - 24 / 168) * 0.3) * 10000) / 100;
    assert.equal(scored.rankScore, expected);
    assert.deepEqual(scored.relatedSkills, []);
    assert.deepEqual(scored.relatedSkillGaps, ['React']);
    assert.ok(!scored.relevanceReasons.some((reason) => /proven|detected skills/.test(reason)));
    assert.deepEqual(
      rankNewsItems([item, { ...item, id: 'a' }], context).map((entry) => entry.id),
      ['a', 'b']
    );
    assert.equal(
      rankNewsItems([item, { ...item, id: 'popular', popularity: 100 }], {}, 'trending')[0].id,
      'popular'
    );
    assert.equal(
      rankNewsItems([item, { ...item, id: 'new', publishedAt: new Date(Date.now()) }], {}, 'latest')[0].id,
      'new'
    );
  } finally {
    Date.now = original;
  }
});

test('provider policies fail closed without Redis or explicit paid/content authorization', async () => {
  const governor = load('../services/newsGovernanceService.js', {
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  for (const source of ['newsapi', 'gnews', 'reddit']) assert.equal(governor.policy(source).daily, 0);
  assert.equal((await governor.reserve('devto')).reason, 'quota_store_unavailable');
  let called = false;
  await governor.withLease('test', 60, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(governor.retryDelay({ 'retry-after': '120' }), 120000);
  assert.equal(
    governor.retryDelay({ 'retry-after': new Date(1800000060000).toUTCString() }, 1800000000000),
    60000
  );
});

test('feeds share public articles, isolate user signals and never call providers, including refresh', async () => {
  const service = load('../services/newsService.js', {
    axios: {
      get: () => {
        throw new Error('Feed must not call HTTP');
      }
    },
    './newsPoolService': {
      readPool: async () => ({ allItems: [normalizeItem(article())], lastUpdated: new Date() }),
      freshness: () => 'fresh'
    },
    './developerSignalService': {
      getDeveloperSignals: async (id) => ({
        resumeSignals: { skills: [id === 'one' ? 'React' : 'Go'] },
        recommendationSignal: { skills: { recommendedTechnologies: ['Docker'] } }
      }),
      buildSignalHash: (signals) => JSON.stringify(signals)
    },
    './platformSettingsService': { getIntegrationSecretsSync: () => ({}) }
  });
  const one = await service.getNewsFeed({ user: { _id: 'one' }, query: { refresh: 'true' } });
  const two = await service.getNewsFeed({ user: { _id: 'two' }, query: {} });
  assert.deepEqual(one.items[0].relatedSkills, ['React']);
  assert.deepEqual(two.items[0].relatedSkills, []);
  assert.ok(!one.recommendedBasedOn.detectedSkills.includes('Docker'));
  assert.notEqual(one.telemetry.signalHash, two.telemetry.signalHash);
  assert.equal(one.telemetry.freshness, 'fresh');
  service.invalidateNewsSignalCache('one');
});

test('controlled provider failure is bounded, secret-safe and retains partial success', async () => {
  let requests = 0;
  const finishes = [];
  let result;
  const service = load('../services/newsService.js', {
    axios: {
      get: async (url, options) => {
        requests++;
        assert.equal(options.timeout, 7000);
        assert.equal(options.maxRedirects, 0);
        assert.ok(options.signal);
        if (url.includes('dev.to'))
          throw { response: { status: 429, headers: { 'retry-after': '120' } }, message: 'secret API key' };
        return {
          status: 200,
          headers: {},
          data: {
            hits: [
              {
                title: 'Engineering security update',
                url: 'https://example.com/story',
                created_at: new Date(),
                objectID: '123',
                points: 7
              }
            ]
          }
        };
      }
    },
    './newsGovernanceService': {
      policy: () => ({ daily: 72, monthly: 2200 }),
      reserve: async (source) => ({ allowed: true, source }),
      finish: async (reservation, response) => finishes.push({ ...reservation, ...response })
    },
    './newsPoolService': {
      refreshPool: async (loader) => {
        result = await loader();
      }
    },
    './platformSettingsService': { getIntegrationSecretsSync: () => ({}) }
  });
  await service.refreshNewsPool();
  assert.equal(requests, 2);
  assert.equal(result.sourceBuckets['Hacker News'].length, 1);
  assert.equal(result.providerFailureCount, 1);
  assert.ok(!JSON.stringify(result).includes('secret API key'));
  assert.equal(finishes.find((entry) => entry.source === 'devto').status, 429);
});

test('pool read deduplicates Mongo misses and returns useful bounded stale fallback', async () => {
  let reads = 0;
  const snapshot = {
    allItems: [normalizeItem(article())],
    lastUpdated: new Date(Date.now() - 3600000),
    expiresAt: new Date(Date.now() + 3600000)
  };
  const pool = load('../services/newsPoolService.js', {
    '../models/news': {
      findOne: () => ({
        lean: async () => {
          reads++;
          return snapshot;
        }
      })
    },
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  const values = await Promise.all(Array.from({ length: 20 }, () => pool.readPool()));
  assert.equal(reads, 1);
  assert.equal(pool.freshness(values[0]), 'stale');
  snapshot.expiresAt = new Date(0);
  assert.equal(await pool.readPool(), null);
  assert.equal(pool.freshness(null), 'warming');
});

test('feed validation rejects object injection and unbounded pagination', () => {
  const { validateFeed } = require('../middleware/newsMiddleware');
  for (const query of [
    { search: { $gt: '' } },
    { page: '1tail' },
    { limit: '31' },
    { page: '10001' },
    { userId: 'other' }
  ]) {
    let status;
    validateFeed(
      { query },
      {
        status: (code) => {
          status = code;
          return { json() {} };
        }
      },
      () => assert.fail('Invalid query accepted')
    );
    assert.equal(status, 400);
  }
});

test('cold-start misses are cached briefly and expired sources do not discard healthy sources', async () => {
  let reads = 0;
  const makePool = (snapshot) =>
    load('../services/newsPoolService.js', {
      '../models/news': {
        findOne: () => ({
          lean: async () => {
            reads++;
            return snapshot;
          }
        })
      },
      './redisCacheService': { getRedisCacheClient: () => null }
    });
  const cold = makePool(null);
  assert.equal(await cold.readPool(), null);
  assert.equal(await cold.readPool(), null);
  assert.equal(reads, 1);
  const now = Date.now();
  const partial = makePool({
    allItems: [
      normalizeItem(article()),
      normalizeItem(article({ source: 'Hacker News', url: 'https://example.com/other' }))
    ],
    filters: { sourceTimes: { 'Dev.to': now, 'Hacker News': now - 25 * 3600000 } },
    lastUpdated: new Date(now - 25 * 3600000),
    expiresAt: new Date(now + 3600000)
  });
  const value = await partial.readPool();
  assert.deepEqual(value.providerUsed, ['Dev.to']);
  assert.equal(value.allItems.length, 1);
  assert.equal(partial.freshness(value), 'fresh');
});
