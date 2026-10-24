const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { rss, payloads, largeKubernetesFeed } = require('./fixtures/newsProviderPayloads');
const providers = require('../services/newsDiscoveryProviders');

test('Kubernetes generator-shaped large RSS is bounded, metadata-only and entity-safe', () => {
  const xml = largeKubernetesFeed();
  assert(Buffer.byteLength(xml) > 1048576);
  const items = providers.fromRss(xml, 'Kubernetes Blog');
  assert.equal(items.length, 40);
  assert.equal(items[0].title, 'Kubernetes release 0');
  assert.equal(items[0].description, '');
  assert.equal(items[0].license, 'CC-BY-4.0');
  assert.equal(items[0].licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.throws(() => providers.fromRss(xml, 'Lobsters'), { code: 'NEWS_INVALID_PAYLOAD' });
  assert.throws(() => providers.fromRss('<rss>' + 'x'.repeat(8 * 1048576) + '</rss>', 'Kubernetes Blog'));
  assert.throws(() => providers.fromRss('<rss>' + 'é'.repeat(600000) + '</rss>', 'Lobsters'));
  assert.throws(() => providers.fromRss('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss></rss>'));
  assert.throws(() => providers.fromRss('<rss><item></rss>'));
  const cdata = rss(' \n<![CDATA[Kubernetes &#x26; Docker]]>\n ');
  assert.equal(providers.fromRss(cdata)[0].title, 'Kubernetes & Docker');
  const cloudflare = providers.fromRss(
    rss('Cloudflare Workers deployment update'),
    'Cloudflare Changelog'
  )[0];
  assert.equal(cloudflare.publisher, 'Cloudflare (CC BY 4.0)');
  assert.equal(cloudflare.license, 'CC-BY-4.0');
  assert.equal(cloudflare.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(cloudflare.description, '');
  assert.equal(providers.fromRss(xml, 'Cloudflare Changelog').length, 40);
  assert.throws(() =>
    providers.fromRss('<rss>' + 'x'.repeat(8 * 1048576) + '</rss>', 'Cloudflare Changelog')
  );
});

test('provider adapters separate oversized, malformed, timeout and redirect failures without leaking secrets', async (t) => {
  const old = process.env.NEWS_DISCOVERY_ENABLED;
  process.env.NEWS_DISCOVERY_ENABLED = 'true';
  t.after(() =>
    old === undefined ? delete process.env.NEWS_DISCOVERY_ENABLED : (process.env.NEWS_DISCOVERY_ENABLED = old)
  );
  for (const [error, reason] of [
    [{ message: 'maxContentLength size exceeded; secret token' }, 'response_too_large'],
    [{ code: 'ETIMEDOUT' }, 'source_timeout'],
    [{ response: { status: 301 } }, 'unexpected_redirect']
  ]) {
    let calls = 0;
    const adapter = load('../services/newsDiscoveryProviders.js', {
      './platformSettingsService': { getIntegrationSecretsSync: () => ({ newsEnabled: true }) },
      './newsGovernanceService': {
        policy: () => ({ daily: 4, monthly: 100 }),
        reserve: async () => ({ allowed: true }),
        finish: async () => ({ reason: 'source_failure' })
      },
      axios: {
        get: async (_url, options) => {
          calls++;
          assert.equal(options.maxRedirects, 0);
          assert.equal(options.maxContentLength, 8 * 1048576);
          throw error;
        }
      }
    });
    const result = await adapter.search('kubernetesblog', 'kubernetes');
    assert.equal(result.reason, reason);
    assert.equal(calls, 1);
    assert(!JSON.stringify(result).includes('secret'));
  }
});

function broad(t, { allowed = true, invalid = false } = {}) {
  const original = { ...process.env };
  Object.assign(process.env, {
    NEWS_API_KEY: 'fixture-news-key',
    GNEWS_API_KEY: 'fixture-gnews-key',
    NEWS_REDDIT_ACCESS_TOKEN: 'fixture-reddit-token',
    NEWS_REDDIT_USER_AGENT: 'fixture-agent'
  });
  t.after(() => {
    for (const key of [
      'NEWS_API_KEY',
      'GNEWS_API_KEY',
      'NEWS_REDDIT_ACCESS_TOKEN',
      'NEWS_REDDIT_USER_AGENT'
    ]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  const data = payloads();
  let calls = 0;
  const governor = {
    policy: () => ({ daily: 12, monthly: 300 }),
    reserve: async () =>
      allowed
        ? { allowed: true }
        : { allowed: false, reason: 'interval', nextEligibleAt: new Date(Date.now() + 60000).toISOString() },
    finish: async () => ({ reason: 'source_failure' })
  };
  const service = load('../services/newsService.js', {
    './platformSettingsService': { getIntegrationSecretsSync: () => ({ newsEnabled: true }) },
    './newsPoolService': { refreshPool: async (loader) => loader() },
    './newsGovernanceService': governor,
    './newsDiscoveryProviders': {
      ...providers,
      feed: async () => ({
        status: 'quota_limited',
        reason: 'daily_budget',
        nextEligibleAt: new Date(Date.now() + 60000).toISOString(),
        items: []
      })
    },
    axios: {
      get: async (url, options) => {
        calls++;
        let key = url.includes('newsapi.org')
          ? 'newsapi'
          : url.includes('gnews.io')
            ? 'gnews'
            : url.includes('hn.algolia.com')
              ? 'hackernews'
              : url.includes('dev.to')
                ? 'devto'
                : 'reddit';
        if (key === 'newsapi') assert.equal(options.headers['X-Api-Key'], 'fixture-news-key');
        if (key === 'gnews') assert.equal(new URL(url).searchParams.get('apikey'), 'fixture-gnews-key');
        if (key === 'reddit') {
          assert.equal(options.headers.Authorization, 'Bearer fixture-reddit-token');
          assert.equal(options.headers['User-Agent'], 'fixture-agent');
        }
        assert.equal(options.maxRedirects, 0);
        return { status: 200, headers: {}, data: invalid ? { error: 'fixture secret' } : data[key] };
      }
    }
  });
  return { service, calls: () => calls };
}
test('normal scheduled adapters authenticate correctly and accept good rows alongside malformed rows', async (t) => {
  const fixture = broad(t);
  const result = await fixture.service.refreshNewsPool();
  for (const source of ['NewsAPI', 'GNews', 'Hacker News', 'Dev.to', 'Reddit']) {
    assert.equal(result.sourceBuckets[source].length, 1, source);
    assert.equal(result.providerDiagnostics.find((entry) => entry.provider === source).status, 'success');
  }
  assert.equal(fixture.calls(), 5);
  assert(!JSON.stringify(result).includes('fixture-news-key'));
  const formatter = require('../utils/newsFormatter');
  const reddit = payloads().reddit;
  reddit.data.children.push({ data: { ...reddit.data.children[0].data, removed_by_category: 'moderator' } });
  assert.equal(formatter.fromReddit(reddit).length, 1);
  const hn = payloads().hackernews;
  delete hn.hits[1].objectID;
  assert.equal(formatter.fromHackerNews(hn)[0].attributionUrl, hn.hits[1].url);
  delete hn.hits[1].url;
  assert.equal(
    formatter.fromHackerNews(hn).length,
    0,
    'No fabricated discussion link for a missing story ID'
  );
});
test('scheduled quota denials are waiting states, not transport faults, and make zero calls', async (t) => {
  const fixture = broad(t, { allowed: false });
  const result = await fixture.service.refreshNewsPool();
  assert.equal(fixture.calls(), 0);
  assert.equal(result.providerFailureCount, 0);
  assert(
    result.providerDiagnostics.every((entry) => entry.status === 'quota_limited' && entry.nextEligibleAt)
  );
});
test('HTTP 200 malformed broad payloads are faults rather than successful empty feeds', async (t) => {
  const fixture = broad(t, { invalid: true });
  const result = await fixture.service.refreshNewsPool();
  assert.equal(result.providerFailureCount, 5);
  assert(result.providerDiagnostics.slice(0, 5).every((entry) => entry.reason === 'invalid_payload'));
  assert(!JSON.stringify(result).includes('fixture secret'));
});

test('GitHub epoch and Reddit relative reset headers override the unknown-window fallback', async () => {
  for (const [source, status, reset] of [
    ['githubreleases', 403, Math.ceil(Date.now() / 1000) + 300],
    ['reddit', 200, 300]
  ]) {
    const delays = [];
    const governor = load('../services/newsGovernanceService.js', {
      './redisCacheService': {
        getRedisCacheClient: () => ({
          eval: async (_script, options) => {
            delays.push(Number(options.arguments[0]));
            return 1;
          },
          zRem: async () => 1
        })
      }
    });
    const result = await governor.finish(
      { allowed: true, base: `news:v3:{${source}}`, token: 'fixture' },
      { status, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }
    );
    assert.equal(result.reason, 'upstream_rate_limit');
    assert(delays[0] >= 299000 && delays[0] <= 301000, `Expected roughly 300 seconds, got ${delays[0]}ms`);
  }
});
