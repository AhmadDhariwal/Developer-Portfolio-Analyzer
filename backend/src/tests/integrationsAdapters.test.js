const test = require('node:test');
const assert = require('node:assert/strict');
const { getAdapter, marketplace } = require('../services/integrations');

test('marketplace exposes expected providers', () => {
  const providers = marketplace.map((item) => item.provider).sort();
  assert.deepEqual(providers, [
    'certifications',
    'devblogs',
    'github',
    'hackerrank',
    'kaggle',
    'leetcode',
    'linkedin',
    'portfolio',
    'stackoverflow'
  ]);
  providers.forEach((provider) => {
    assert.ok(getAdapter(provider), `Expected adapter for ${provider}`);
  });
});

test('oauth providers expose oauth2 auth mode', () => {
  const github = getAdapter('github');
  const linkedin = getAdapter('linkedin');
  assert.equal(github.getAuthMode(), 'oauth2');
  assert.equal(linkedin.getAuthMode(), 'oauth2');
});

test('Stack Overflow profile fetch requests answer and question counts', async (t) => {
  const adapter = getAdapter('stackoverflow');
  const originalGet = adapter.get;
  let requestUrl = '';
  adapter.get = async (url) => {
    requestUrl = url;
    return {
      items: [
        {
          user_id: 22656,
          reputation: 1530323,
          answer_count: 35806,
          question_count: 56
        }
      ]
    };
  };
  t.after(() => {
    adapter.get = originalGet;
  });

  const user = await adapter.fetchUser('22656');

  assert.equal(new URL(requestUrl).searchParams.get('filter'), '!0Z-LvgkLYnfxC9thLf37WiBP(');
  assert.equal(user.answer_count, 35806);
  assert.equal(user.question_count, 56);
});

test('Dev.to article extraction preserves the provider publication timestamp', async (t) => {
  const adapter = getAdapter('devblogs');
  const originalGet = adapter.get;
  adapter.get = async () => [
    {
      title: 'Public sample article',
      positive_reactions_count: 18,
      published_at: '2026-10-11T19:41:56Z',
      tag_list: ['ai', 'fintech']
    }
  ];
  t.after(() => {
    adapter.get = originalGet;
  });

  const result = await adapter.fetchDevTo('public-sample');

  assert.equal(result.articles[0].publishedAt, '2026-10-11T19:41:56Z');
});

test('Stack Overflow serializes its three reads within the default shared admission limit', async (t) => {
  const adapter = getAdapter('stackoverflow');
  const originalGet = adapter.get;
  let active = 0;
  let peak = 0;
  adapter.get = async (url) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (url.includes('/badges')) return { items: [{ name: 'Public badge' }] };
    if (url.includes('/top-tags')) return { items: [{ tag_name: 'javascript' }] };
    return { items: [{ user_id: 22656, reputation: 100, answer_count: 5, question_count: 2 }] };
  };
  t.after(() => {
    adapter.get = originalGet;
  });

  const result = await adapter.ingestData({ externalUsername: '22656' });
  assert.equal(peak, 1);
  assert.equal(result.profile.answerCount, 5);
  assert.deepEqual(result.inferredSkills, ['javascript']);
});

test('explicit Dev.to observations do not depend on Hashnode or invent unavailable view counts', async (t) => {
  const adapter = getAdapter('devblogs');
  const originalGet = adapter.get;
  const originalPost = adapter.post;
  adapter.get = async (url) => {
    assert.equal(new URL(url).hostname, 'dev.to');
    return [
      {
        title: 'Public article',
        positive_reactions_count: 18,
        published_at: '2026-10-11T19:41:56Z',
        tag_list: ['javascript']
      }
    ];
  };
  adapter.post = async () => {
    assert.fail('A Dev.to account must not contact Hashnode');
  };
  t.after(() => {
    adapter.get = originalGet;
    adapter.post = originalPost;
  });

  const result = await adapter.ingestData({ externalUsername: 'devto@swyx' });
  assert.equal(result.profile.username, 'swyx');
  assert.equal(result.profile.totalArticles, 1);
  assert.equal(result.profile.totalReactions, 18);
  assert.equal(result.profile.totalViews, null);
  assert.equal(result.activity.recentArticles[0].publishedAt, '2026-10-11T19:41:56Z');
  assert.deepEqual(result.activity.platforms, ['Dev.to']);
});

test('legacy combined and Hashnode blog handles fail closed before unsupported API calls', async (t) => {
  const adapter = getAdapter('devblogs');
  const originalGet = adapter.get;
  adapter.get = async () => {
    assert.fail('Ambiguous or unavailable blog selection must not fetch');
  };
  t.after(() => {
    adapter.get = originalGet;
  });
  for (const externalUsername of ['swyx', 'hashnode@unclebigbay'])
    await assert.rejects(adapter.ingestData({ externalUsername }), /approved Pro publication/);
  assert.deepEqual(await adapter.fetchHashnode('unclebigbay'), {
    articles: [],
    failed: true,
    unavailable: true
  });
});

test('Kaggle does not invent skills absent from the provider response', async (t) => {
  const adapter = getAdapter('kaggle');
  const originalFetch = adapter.fetchProfilePayload;
  adapter.fetchProfilePayload = async () => ({
    profile: { username: 'public-sample', competitions: 2 },
    stats: { competitions: 2, notebooks: 1 }
  });
  t.after(() => {
    adapter.fetchProfilePayload = originalFetch;
  });

  const result = await adapter.ingestData({
    externalUsername: 'public-sample'
  });

  assert.deepEqual(result.inferredSkills, []);
  assert.equal(result.profile.competitions, 2);
  assert.equal(result.profile.notebooks, 1);
});

test('Kaggle fails closed instead of calling undocumented profile endpoints or scraping HTML', async (t) => {
  const adapter = getAdapter('kaggle');
  let requestCount = 0;
  const originalGet = adapter.get;
  adapter.get = async () => {
    requestCount += 1;
    throw new Error('Unexpected provider request.');
  };
  t.after(() => {
    adapter.get = originalGet;
  });

  await assert.rejects(
    adapter.ingestData({ externalUsername: 'cdeotte' }),
    /documented profile API and authorized access/
  );
  assert.equal(requestCount, 0);
});

test('HackerRank fails closed rather than calling undocumented developer profile endpoints', async (t) => {
  const adapter = getAdapter('hackerrank');
  let requestCount = 0;
  const originalGet = adapter.get;
  adapter.get = async () => {
    requestCount += 1;
    throw new Error('Unexpected provider request.');
  };
  t.after(() => {
    adapter.get = originalGet;
  });

  await assert.rejects(
    adapter.ingestData({ externalUsername: '115cs2425' }),
    /no supported public profile API is configured/
  );
  assert.equal(requestCount, 0);
});

test('portfolio adapter rejects unsafe URL schemes and private targets without network calls', async () => {
  const adapter = getAdapter('portfolio');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'blob:https://example.com/id',
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://192.168.1.10'
  ]) {
    await assert.rejects(
      () => adapter.ingestData({ externalUsername: value }),
      /valid http|public host|private or local/i
    );
  }
});

test('portfolio rejects IPv6, mapped addresses, CGNAT and rebinding at connection lookup', async () => {
  const adapter = getAdapter('portfolio');
  for (const value of [
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://100.64.0.1',
    'http://0x7f000001',
    'http://169.254.169.254'
  ])
    await assert.rejects(adapter.validatePublicUrl(value));
  const axios = require('axios');
  const governance = require('../services/integrationGovernanceService');
  const dns = require('node:dns').promises;
  const original = {
    get: axios.get,
    request: governance.request,
    lookup: dns.lookup
  };
  try {
    governance.request = async (_provider, operation) => operation({});
    dns.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    axios.get = async (_url, controls) =>
      new Promise((resolve, reject) =>
        controls.lookup('rebound.invalid', {}, (error) => {
          assert.ok(error);
          reject(error);
        })
      );
    await assert.rejects(adapter.scanPortfolio('https://rebound.invalid'), /request failed/);
  } finally {
    axios.get = original.get;
    governance.request = original.request;
    dns.lookup = original.lookup;
  }
});

test('provider registry rejects inherited properties and non-string inputs', () => {
  for (const value of ['constructor', '__proto__', 'toString', {}, ['github'], null])
    assert.equal(getAdapter(value), null);
});
