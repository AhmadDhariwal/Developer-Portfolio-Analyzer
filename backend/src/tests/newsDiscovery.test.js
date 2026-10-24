const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { normalizeItem } = require('../utils/newsFormatter');
const realProviders = require('../services/newsDiscoveryProviders');
const article = (extra = {}) =>
  normalizeItem({
    title: 'React engineering release update',
    url: 'https://example.com/react',
    publishedAt: new Date(),
    source: 'Hacker News',
    ...extra
  });
const filters = (extra = {}) => ({
  search: 'react',
  source: 'All',
  category: 'All',
  dateRange: 'week',
  popularity: 'all',
  page: 1,
  ...extra
});
const fakeProviders = (extra = {}) => ({
  ...realProviders,
  enabled: () => true,
  available: () => ['hackernewssearch'],
  ...extra
});
test('expired sufficient query results schedule automatic revalidation without becoming a manual check', async () => {
  const old = Date.now() - 3600000;
  let mode;
  const discovery = create({
    './redisCacheService': {
      getRedisCacheClient: () => ({
        get: async (key) =>
          key.endsWith(':worker') ? 'heartbeat' : JSON.stringify({ status: 'ready', checkedAtMs: old }),
        eval: async (_script, options) => {
          mode = options.arguments[12];
          return options.arguments[2];
        }
      })
    }
  });
  const result = await discovery.coverage({
    filters: filters(),
    total: 6,
    broadTotal: 6,
    queryAttemptAt: old
  });
  assert.equal(result.enrichment.status, 'queued');
  assert.equal(mode, 'stale');
});
function create(extra = {}) {
  return load('../services/newsDiscoveryService.js', {
    './newsCatalogService': { ingest: async (items) => ({ inserted: items.length }) },
    '../models/newsTopicCache': { findOne: () => ({ lean: async () => null }), updateOne: async () => ({}) },
    './redisCacheService': { getRedisCacheClient: () => null },
    './newsDiscoveryProviders': fakeProviders(),
    './newsGovernanceService': { inspect: async () => ({ allowed: true }) },
    ...extra
  });
}

test('coverage distinguishes genuine gaps, restrictive filters, unsupported topics and source exhaustion', async () => {
  const discovery = create();
  assert.equal(discovery.classify(filters(), 0, 0), 'coverage_gap');
  assert.equal(discovery.classify(filters(), 6, 6), 'sufficient');
  assert.equal(discovery.classify(filters(), 2, 8), 'restrictive_filters');
  for (const change of [{ source: 'NewsAPI' }])
    assert.equal(discovery.classify(filters(change), 0, 0), 'restrictive_filters');
  assert.equal(discovery.classify(filters({ category: 'Frontend' }), 0, 0), 'coverage_gap');
  assert.equal(
    discovery.classify(filters({ category: 'Backend', dateRange: 'today', popularity: 'high' }), 0, 0),
    'coverage_gap'
  );
  assert.equal(discovery.classify(filters({ search: '' }), 0, 0), 'general_pool');
  assert.equal(
    discovery.classify(filters({ search: 'react OR secret private repository' }), 0, 0),
    'unsupported_query'
  );
  assert.equal(
    discovery.classify(filters({ source: 'Dev.to' }), 0, 0, [
      { provider: 'Dev.to', reachable: true, articlesFetched: 0 }
    ]),
    'coverage_gap'
  );
  assert.equal(
    (await discovery.coverage({ filters: filters(), total: 0, broadTotal: 0 })).enrichment.status,
    'unavailable'
  );
  assert.equal(realProviders.topicFor(' NODE.JS '), 'node');
  assert.equal(realProviders.topicFor('https://localhost/private'), null);
});

test('new budgets require content approval and related adapters share upstream cooldowns', async () => {
  const writes = [];
  const governor = load('../services/newsGovernanceService.js', {
    './redisCacheService': {
      getRedisCacheClient: () => ({
        eval: async (_script, options) => {
          writes.push(options);
          return 1;
        },
        zRem: async () => 0
      })
    }
  });
  for (const key of realProviders.KEYS) {
    const prefix = `NEWS_${key.toUpperCase()}_`;
    const settings = {
      [`${prefix}CONTENT_APPROVED`]: 'false',
      [`${prefix}DAILY_BUDGET`]: '12',
      [`${prefix}MONTHLY_BUDGET`]: '100',
      [`${prefix}MIN_INTERVAL_MS`]: '60000'
    };
    const old = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
    Object.assign(process.env, settings);
    try {
      assert.equal(governor.policy(key).daily, 0);
      process.env[`${prefix}CONTENT_APPROVED`] = 'true';
      assert.equal(governor.policy(key).daily, 12);
      assert.equal(
        governor.policy(key).interval,
        key.startsWith('github') ? 300000 : key === 'lobsters' ? 600000 : 60000
      );
    } finally {
      for (const [name, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
  for (const [source, sibling] of [
    ['hackernews', 'hackernewssearch'],
    ['githubreleases', 'githubadvisories']
  ]) {
    await governor.finish(
      { allowed: true, base: `news:v3:{${source}}`, token: 'owned' },
      { failed: true, status: 429, headers: { 'retry-after': '120' } }
    );
    assert.ok(
      writes.some(
        (write) => write.keys[0] === `news:v3:{${sibling}}:cooldown` && Number(write.arguments[0]) >= 120000
      )
    );
  }
});

test('simultaneous cross-account-shaped requests deduplicate public queue work and never enqueue restrictions', async () => {
  let calls = 0;
  const discovery = create({
    './redisCacheService': {
      getRedisCacheClient: () => ({
        get: async (key) => (key.endsWith(':worker') ? 'recent-heartbeat' : null),
        eval: async (_script, options) => {
          calls++;
          assert.ok(!JSON.stringify(options).includes('owner'));
          return options.arguments[2];
        }
      })
    }
  });
  const outputs = await Promise.all(
    Array.from({ length: 30 }, () => discovery.coverage({ filters: filters(), total: 0, broadTotal: 0 }))
  );
  assert.equal(calls, 1);
  assert.ok(outputs.every((output) => output.enrichment.status === 'queued'));
  await discovery.coverage({ filters: filters({ source: 'NewsAPI' }), total: 0, broadTotal: 0 });
  await discovery.coverage({ filters: filters({ search: 'react OR secret' }), total: 0, broadTotal: 0 });
  assert.equal(calls, 1);
});

test('topic cache deduplicates misses, uses Mongo fallback, expires data and excludes unapproved sources', async () => {
  let reads = 0;
  const snapshot = {
    allItems: [
      article(),
      article({ source: 'GitHub Releases', url: 'https://github.com/facebook/react/releases/tag/test' })
    ],
    filters: { sourceTimes: { 'Hacker News': Date.now(), 'GitHub Releases': Date.now() } },
    expiresAt: new Date(Date.now() + 60000)
  };
  const discovery = create({
    '../models/newsTopicCache': {
      findOne: () => ({
        lean: async () => {
          reads++;
          return snapshot;
        }
      })
    }
  });
  const outputs = await Promise.all(Array.from({ length: 20 }, () => discovery.readTopic('react')));
  assert.equal(reads, 1);
  assert.ok(outputs.every((output) => output.allItems.length === 1));
  snapshot.expiresAt = new Date(0);
  assert.equal(await discovery.readTopic('react'), null);
  assert.equal(await discovery.readTopic('unsupported'), null);
});

test('provider adapters require approval, protect transport, validate content and do not retry failures', async () => {
  const disabled = load('../services/newsDiscoveryProviders.js', {
    './newsGovernanceService': { policy: () => ({ daily: 0, monthly: 0 }) },
    './platformSettingsService': { getIntegrationSecretsSync: () => ({}) },
    axios: { get: () => assert.fail('Unapproved provider must not be called') }
  });
  assert.deepEqual(disabled.available('react'), []);
  let calls = 0;
  const finishes = [];
  const providers = load('../services/newsDiscoveryProviders.js', {
    './newsGovernanceService': {
      policy: () => ({ daily: 12, monthly: 100 }),
      reserve: async () => ({ allowed: true }),
      finish: async (reservation, value) => finishes.push(value)
    },
    './platformSettingsService': { getIntegrationSecretsSync: () => ({}) },
    axios: {
      get: async (url, options) => {
        calls++;
        assert.ok(url.startsWith('https://'));
        assert.equal(options.maxRedirects, 0);
        assert.equal(options.timeout, 7000);
        assert.ok(options.signal);
        assert.equal(options.headers.Authorization, undefined);
        if (url.includes('algolia')) throw { response: { status: 429, headers: { 'retry-after': '120' } } };
        if (url.includes('/releases'))
          return {
            status: 200,
            headers: {},
            data: [
              {
                name: 'Stable version',
                html_url: 'https://github.com/facebook/react/releases/tag/v1',
                published_at: new Date(),
                body: 'Never cache this body'
              },
              { name: 'Draft', draft: true, html_url: 'https://example.com/draft', published_at: new Date() }
            ]
          };
        if (url.includes('/advisories'))
          return {
            status: 200,
            headers: {},
            data: [
              {
                summary: 'React vulnerability advisory',
                html_url: 'https://github.com/advisories/GHSA-test',
                published_at: new Date(),
                description: 'Never cache full advisory'
              }
            ]
          };
        return {
          status: 200,
          headers: {},
          data: `<rss><channel><item><title><![CDATA[React &amp; security news]]></title><link>https://example.com/rss</link><comments>https://lobste.rs/s/test</comments><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`
        };
      }
    }
  });
  const original = process.env.NEWS_DISCOVERY_ENABLED;
  process.env.NEWS_DISCOVERY_ENABLED = 'true';
  try {
    assert.equal((await providers.search('hackernewssearch', 'react')).status, 'quota_limited');
    for (const source of ['githubreleases', 'githubadvisories', 'lobsters']) {
      const output = await providers.search(
        source,
        source === 'githubadvisories' ? 'react security' : 'react'
      );
      assert.equal(output.status, 'success');
      assert.equal(output.items.length, 1);
      assert.equal(output.items[0].description, '');
      assert.equal(output.items[0].popularity, 0);
      assert.ok(output.items[0].attributionUrl);
    }
    assert.equal(calls, 4);
    assert.equal(finishes[0].status, 429);
    assert.throws(() =>
      providers.fromRss('<!DOCTYPE rss [<!ENTITY private SYSTEM "file:///secret">]><rss></rss>')
    );
    assert.throws(() => providers.fromRss('<rss><item></rss>'));
  } finally {
    if (original === undefined) delete process.env.NEWS_DISCOVERY_ENABLED;
    else process.env.NEWS_DISCOVERY_ENABLED = original;
  }
});

test('worker fallback, negative caching, lease loss and persistence failures are bounded and acknowledged', async () => {
  for (const scenario of ['found', 'enough', 'empty', 'limited', 'failure', 'persist', 'lease_lost']) {
    const values = new Map([['lease', 'token']]);
    const attempts = [];
    let publication;
    let committed;
    const redis = {
      get: async (key) => values.get(key) || null,
      set: async (key, value) => {
        values.set(key, value);
        return 'OK';
      },
      eval: async (script, options) => {
        if (script.includes('ZRANGEBYSCORE')) return 'react';
        if (!script.includes('ZREM')) {
          values.set(options.keys[1], options.arguments[1]);
          return 1;
        }
        committed = JSON.parse(options.arguments[1]);
        return 1;
      }
    };
    const discovery = create({
      './redisCacheService': { getRedisCacheClient: () => redis },
      './newsGovernanceService': {
        withLease: (_name, seconds, work) => {
          assert.equal(seconds, 90);
          return work({ key: 'lease', token: 'token' });
        }
      },
      './newsDiscoveryProviders': fakeProviders({
        available: () =>
          scenario === 'enough' ? realProviders.KEYS : ['hackernewssearch', 'githubreleases'],
        search: async (provider) => {
          attempts.push(provider);
          if (scenario === 'lease_lost') values.set('lease', 'new-owner');
          if (scenario === 'limited') return { status: 'quota_limited', items: [] };
          if (scenario === 'failure') return { status: 'unavailable', items: [] };
          if (scenario === 'enough')
            return {
              status: 'success',
              items: Array.from({ length: 3 }, (_, index) =>
                article({
                  title: `React release ${provider} ${index}`,
                  url: `https://example.com/${provider}/${index}`,
                  source: provider === 'hackernewssearch' ? 'Hacker News' : 'GitHub Releases'
                })
              )
            };
          return {
            status: 'success',
            items:
              provider === 'githubreleases' && ['found', 'persist'].includes(scenario)
                ? [article({ source: 'GitHub Releases' })]
                : []
          };
        }
      }),
      '../models/newsTopicCache': {
        findOne: () => ({ lean: async () => null }),
        updateOne: async (_query, update) => {
          if (scenario === 'persist') throw new Error('controlled DB failure');
          publication = update.$set;
        }
      }
    });
    const output = await discovery.processQueue();
    assert.ok(attempts.length <= 2);
    if (scenario === 'lease_lost') {
      assert.equal(output.reason, 'lease_lost');
      assert.equal(committed, undefined);
      continue;
    }
    const expected = {
      found: 'ready',
      enough: 'ready',
      empty: 'exhausted',
      limited: 'quota_limited',
      failure: 'source_unavailable',
      persist: 'unavailable'
    };
    assert.equal(committed.status, expected[scenario]);
    assert.ok(Date.parse(committed.nextEligibleAt) > Date.now());
    if (scenario === 'enough') {
      assert.equal(attempts.length, 2);
      assert.equal(publication.allItems.length, 6);
    }
    if (scenario === 'found') {
      assert.equal(publication.allItems.length, 1);
      assert.equal((await discovery.readTopic('react')).allItems.length, 1);
    }
  }
});

test('topic merge validates, bounds, deduplicates and retains only unexpired source evidence', () => {
  const discovery = create();
  const items = Array.from({ length: 60 }, (_, index) =>
    article({ title: `React release update ${index}`, url: `https://example.com/react/${index}` })
  );
  const snapshot = discovery.buildSnapshot(
    'react',
    null,
    [
      {
        provider: 'hackernewssearch',
        status: 'success',
        items: [...items, items[0], article({ title: 'Duplicate title has unique URL', url: items[0].url })]
      }
    ],
    Date.now()
  );
  assert.equal(snapshot.allItems.length, 40);
  assert.equal(new Set(snapshot.allItems.map((item) => item.url)).size, 40);
  const retained = discovery.buildSnapshot(
    'react',
    snapshot,
    [{ provider: 'hackernewssearch', status: 'unavailable', items: [] }],
    Date.now()
  );
  assert.equal(retained.allItems.length, 40);
  assert.equal(retained.filters.sourceTimes['Hacker News'], snapshot.filters.sourceTimes['Hacker News']);
  const expired = discovery.buildSnapshot('react', snapshot, [], Date.now() + discovery.RETENTION + 1);
  assert.equal(expired.allItems.length, 0);
});

test('discovered articles preserve feed ranking, pagination, skill evidence and account separation without provider calls', async () => {
  const discovery = create();
  const items = Array.from({ length: 8 }, (_, index) =>
    article({ title: `React release engineering ${index}`, url: `https://example.com/new/${index}` })
  );
  const service = load('../services/newsService.js', {
    axios: { get: () => assert.fail('Feed cannot fetch providers') },
    './newsPoolService': { readPool: async () => null, freshness: () => 'fresh' },
    './newsDiscoveryService': {
      readTopic: async () => ({
        allItems: items,
        expiresAt: new Date(Date.now() + 60000),
        lastUpdated: new Date(),
        providerUsed: ['Hacker News']
      }),
      coverage: async (input) => ({
        coverage: { status: discovery.classify(input.filters, input.total, input.broadTotal) },
        enrichment: { status: 'not_needed' }
      })
    },
    './developerSignalService': {
      getDeveloperSignals: async (id) => ({
        resumeSignals: { skills: id === 'owner' ? ['React'] : ['Python'] }
      }),
      buildSignalHash: (value) => JSON.stringify(value)
    }
  });
  const user = { _id: 'owner' };
  const context = await service.buildUserContext(user);
  const ranked = require('../utils/newsRanker').rankNewsItems(items, context);
  const feed = await service.getNewsFeed({ user, query: { search: 'react', page: 2, limit: 3 } });
  assert.equal(feed.total, 8);
  assert.deepEqual(
    feed.items.map((item) => item.id),
    ranked.slice(3, 6).map((item) => item.id)
  );
  assert.ok(
    feed.items.every(
      (item, index) =>
        item.rankScore === ranked[index + 3].rankScore && Array.isArray(item.relatedSkillEvidence)
    )
  );
  const other = await service.getNewsFeed({
    user: { _id: 'other' },
    query: { search: 'react', page: 2, limit: 3, refresh: 'true' }
  });
  assert.notDeepEqual(other.recommendedBasedOn.detectedSkills, feed.recommendedBasedOn.detectedSkills);
  assert.equal(feed.telemetry.freshness, 'fresh');
});
