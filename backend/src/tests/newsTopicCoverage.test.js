const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const taxonomy = require('../utils/newsTopics');
const providers = require('../services/newsDiscoveryProviders');
const { normalizeItem } = require('../utils/newsFormatter');
const makeItem = (name, index = 0) =>
  normalizeItem({
    title: `${name} technical release and engineering update`,
    url: `https://example.com/${index}`,
    source: 'Hacker News',
    publishedAt: new Date()
  });

test('bounded topic taxonomy covers DevOps aliases, cloud, security and AI without arbitrary upstream queries', () => {
  assert.ok(Object.keys(taxonomy.TOPICS).length <= 64);
  for (const [query, topic] of Object.entries({
    DevOps: 'devops',
    'CI/CD': 'cicd',
    'continuous deployment': 'cicd',
    cloud: 'cloud',
    AWS: 'aws',
    Azure: 'azure',
    'Google Cloud': 'gcp',
    Terraform: 'terraform',
    k8s: 'kubernetes',
    Docker: 'docker',
    GitOps: 'gitops',
    cybersecurity: 'security',
    'artificial intelligence': 'ai',
    'DevOps news': 'devops'
  }))
    assert.equal(taxonomy.topicFor(query), topic);
  for (const query of ['UnknownPrivateTech', 'react OR arbitrary terms', 'https://127.0.0.1', '__proto__'])
    assert.equal(taxonomy.topicFor(query), null);
  assert.ok(taxonomy.matchesTopic(makeItem('AWS Kubernetes'), 'devops'));
  assert.ok(taxonomy.matchesTopic(makeItem('Amazon Web Services'), 'aws'));
  assert.ok(taxonomy.matchesTopic(makeItem('Continuous integration'), 'cicd'));
  assert.equal(taxonomy.matchesTopic(makeItem('Drawing clouds'), 'aws'), false);
});

test('Explore searches independent interests and preserves cached pagination without resolving career signals', async () => {
  const items = ['DevOps', 'Kubernetes', 'Terraform', 'Docker', 'GitOps', 'Observability'].map(makeItem);
  let queueWrites = 0;
  const discovery = load('../services/newsDiscoveryService.js', {
    '../models/newsTopicCache': {},
    './redisCacheService': {
      getRedisCacheClient: () => ({
        eval: () => {
          queueWrites++;
          assert.fail('Sufficient cache must not enqueue');
        }
      })
    }
  });
  const service = load('../services/newsService.js', {
    axios: { get: () => assert.fail('No provider calls from browsing') },
    './newsPoolService': {
      readPool: async () => ({ allItems: items, lastUpdated: new Date() }),
      freshness: () => 'fresh'
    },
    './newsDiscoveryService': { readTopic: async () => null, coverage: discovery.coverage },
    './developerSignalService': {
      getDeveloperSignals: () => assert.fail('Explore must not read career signals'),
      buildSignalHash: () => assert.fail('Explore must not personalize')
    }
  });
  for (const user of [
    { _id: 'frontend-person', activeCareerStack: 'Frontend' },
    { _id: 'ai-person', activeCareerStack: 'AI / ML' }
  ]) {
    const result = await service.getNewsFeed({ user, query: { mode: 'explore', search: 'DevOps', page: 2, limit: 2 } });
    assert.equal(result.total, 6);
    assert.equal(result.items.length, 2);
    assert.equal(result.filters.page, 2);
    assert.equal(result.recommendedBasedOn, null);
    assert.equal(result.mode, 'explore');
    assert.equal(result.coverage.status, 'sufficient');
    assert.equal(result.enrichment.status, 'not_needed');
    assert.ok(
      result.items.every(
        (item) => item.rankScore === null && item.relevanceScore === null && item.relatedSkillEvidence.length === 0
      )
    );
    const controller = load('../controllers/newsController.js', {
      '../services/newsService': service,
      '../models/newsSavedItem': {}
    });
    let payload;
    await controller.getNews(
      { user, query: { mode: 'explore', search: 'DevOps', page: 2, limit: 2 } },
      {
        json: (value) => {
          payload = value;
        }
      }
    );
    assert.equal(payload.mode, 'explore');
    assert.equal(payload.recommendedBasedOn, null);
    assert.equal(payload.totalPages, 3);
    assert.equal(payload.page, 2);
  }
  assert.equal(queueWrites, 0);
});

test('unknown interests can search existing articles but never become discovery jobs', async () => {
  const discovery = load('../services/newsDiscoveryService.js', {
    '../models/newsTopicCache': {},
    './redisCacheService': { getRedisCacheClient: () => ({ eval: () => assert.fail('Unknown topics must not queue') }) }
  });
  const service = load('../services/newsService.js', {
    './newsPoolService': {
      readPool: async () => ({ allItems: [makeItem('UnknownPrivateTech')] }),
      freshness: () => 'fresh'
    },
    './newsDiscoveryService': { readTopic: async () => null, coverage: discovery.coverage }
  });
  const response = await service.getNewsFeed({
    user: { _id: 'owner' },
    query: { mode: 'explore', search: 'UnknownPrivateTech' }
  });
  assert.equal(response.total, 1);
  assert.equal(response.coverage.status, 'unsupported_query');
  assert.equal(response.enrichment.status, 'not_needed');
});

test('pagination never creates discovery jobs and explicit stale-topic revalidation respects shared state', async () => {
  let writes = 0;
  const discovery = load('../services/newsDiscoveryService.js', {
    '../models/newsTopicCache': {},
    './newsDiscoveryProviders': { ...providers, enabled: () => true, available: () => ['hackernewssearch'] },
    './redisCacheService': {
      getRedisCacheClient: () => ({
        get: async () => null,
        eval: async (_script, options) => {
          writes++;
          return options.arguments[2];
        }
      })
    }
  });
  const filters = { search: 'DevOps', category: 'All', source: 'All', dateRange: 'week', popularity: 'all', page: 2 };
  const page = await discovery.coverage({ filters, total: 0, broadTotal: 0 });
  assert.equal(page.enrichment.reason, 'pagination_only');
  assert.equal(writes, 0);
  const fresh = await discovery.coverage({
    filters: { ...filters, page: 1 },
    total: 6,
    broadTotal: 6,
    revalidate: true,
    lastUpdated: new Date()
  });
  assert.equal(fresh.enrichment.status, 'not_needed');
  assert.equal(writes, 0);
  const input = {
    filters: { ...filters, page: 1 },
    total: 6,
    broadTotal: 6,
    revalidate: true,
    lastUpdated: new Date(Date.now() - 3600000)
  };
  assert.equal((await discovery.coverage(input)).enrichment.status, 'queued');
  await discovery.coverage(input);
  assert.equal(writes, 1);
});

test('public source activation enforces approval and fixed Dev.to/Kubernetes transports with attributed license metadata', async () => {
  const before = process.env.NEWS_DISCOVERY_ENABLED;
  process.env.NEWS_DISCOVERY_ENABLED = 'true';
  try {
    const configured = load('../services/newsDiscoveryProviders.js', {
      './platformSettingsService': { getIntegrationSecretsSync: () => ({}) },
      './newsGovernanceService': {
        policy: () => ({ daily: 4, monthly: 100 }),
        reserve: async () => ({ allowed: true }),
        finish: async () => {}
      },
      axios: {
        get: async (url) => {
          if (url.includes('dev.to'))
            return {
              status: 200,
              headers: {},
              data: [
                {
                  title: 'DevOps CI/CD deployment update',
                  url: 'https://dev.to/example/release',
                  description: 'Continuous delivery news',
                  published_at: new Date(),
                  public_reactions_count: 2,
                  comments_count: 1
                }
              ]
            };
          assert.equal(url, 'https://kubernetes.io/feed.xml');
          return {
            status: 200,
            headers: {},
            data: `<rss><channel><item><title>Kubernetes security release update</title><link>https://kubernetes.io/blog/release</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`
          };
        }
      }
    });
    assert.equal((await configured.search('devtosearch', 'cicd')).items.length, 1);
    const result = await configured.search('kubernetesblog', 'devops');
    assert.equal(result.items[0].source, 'Kubernetes Blog');
    assert.equal(result.items[0].license, 'CC-BY-4.0');
    assert.equal(result.items[0].licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
    assert.equal(result.items[0].attributionUrl, result.items[0].url);
    assert.equal(providers.requestFor('lobsters', 'devops').url, 'https://lobste.rs/t/devops.rss');
    assert.ok(providers.requestFor('hackernewssearch', 'aws').url.startsWith('https://hn.algolia.com/'));
  } finally {
    if (before === undefined) delete process.env.NEWS_DISCOVERY_ENABLED;
    else process.env.NEWS_DISCOVERY_ENABLED = before;
  }
});

test('Explore mode is additive and invalid modes are rejected before rate-limit or database work', () => {
  const { validateFeed } = require('../middleware/newsMiddleware');
  let code;
  validateFeed(
    { query: { mode: 'arbitrary' } },
    {
      status: (value) => {
        code = value;
        return { json() {} };
      }
    },
    () => assert.fail('Invalid mode reached handler')
  );
  assert.equal(code, 400);
  let accepted = false;
  validateFeed({ query: { mode: 'explore', search: 'DevOps' } }, { set() {} }, () => {
    accepted = true;
  });
  assert.equal(accepted, true);
});

test('topic cold starts fail quickly without buffering unavailable Mongo or waiting indefinitely', async () => {
  const create = (model) =>
    load('../services/newsDiscoveryService.js', {
      '../models/newsTopicCache': model,
      './newsDiscoveryProviders': { ...providers, enabled: () => true, available: () => ['hackernewssearch'] },
      './redisCacheService': { getRedisCacheClient: () => null }
    });
  const disconnected = create({
    db: { readyState: 0 },
    findOne: () => assert.fail('Disconnected driver must not buffer queries')
  });
  assert.equal(await disconnected.readTopic('devops'), null);
  let reads = 0,
    deadline;
  const stalled = create({
    db: { readyState: 1 },
    findOne: () => {
      reads++;
      return {
        maxTimeMS: (value) => {
          deadline = value;
        },
        lean: () => new Promise(() => {})
      };
    }
  });
  assert.equal(await stalled.readTopic('devops'), null);
  assert.equal(deadline, 300);
  assert.equal(await stalled.readTopic('devops'), null);
  assert.equal(reads, 1);
});

test('proactive prewarming shares the daily queue budget and reserves capacity for user discovery', async () => {
  const settings = {
    NEWS_DISCOVERY_PREWARM_ENABLED: 'true',
    NEWS_DISCOVERY_PREWARM_TOPICS: 'devops,aws,ci/cd,kubernetes,unknown',
    NEWS_DISCOVERY_PREWARM_DAILY_JOBS: '4'
  };
  const old = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  let prewarmCount = 0,
    jobs = 0;
  const redis = {
    get: async () => null,
    eval: async (_script, options) => {
      if (options.keys[0].includes(':prewarm:')) return ++prewarmCount;
      jobs++;
      return options.arguments[2];
    }
  };
  const create = () =>
    load('../services/newsDiscoveryService.js', {
      '../models/newsTopicCache': { findOne: () => ({ lean: async () => null }) },
      './newsDiscoveryProviders': { ...providers, enabled: () => true, available: () => ['hackernewssearch'] },
      './redisCacheService': { getRedisCacheClient: () => redis },
      './newsGovernanceService': { COUNTER: 'controlled-counter', withLease: (_name, _ttl, work) => work() }
    });
  try {
    await create().prewarm();
    await create().prewarm();
    assert.equal(jobs, 4);
  } finally {
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
