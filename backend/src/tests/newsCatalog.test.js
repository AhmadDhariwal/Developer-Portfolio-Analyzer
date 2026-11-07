const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../services/newsCatalogService');
const adaptive = require('../services/newsAdaptiveService');
const { auditNewsConfiguration } = require('../config/newsConfig');
const article = (extra = {}) => ({
  title: 'Docker Kubernetes security release',
  source: 'Hacker News',
  url: 'https://example.com/release?utm_source=hn',
  publishedAt: new Date(),
  ...extra
});

test('catalog identity crosses providers; tags overlap and retention is publication based', () => {
  const first = catalog.prepare(article());
  const second = catalog.prepare(article({ source: 'Dev.to', url: 'http://example.com/release#top' }));
  assert.equal(first.canonicalId, second.canonicalId);
  for (const tag of ['docker', 'kubernetes', 'security', 'devops'])
    assert.ok(first.technologies.includes(tag));
  assert.equal(first.expiresAt.getTime(), new Date(first.article.publishedAt).getTime() + 35 * 86400000);
  assert.equal(
    catalog.prepare(article({ source: 'Reddit', publishedAt: new Date(Date.now() - 2 * 86400000) })),
    null
  );
  assert.equal(catalog.prepare(article({ publishedAt: new Date(Date.now() - 36 * 86400000) })), null);
  assert.equal(catalog.prepare(article({ rankScore: 99, relevanceScore: 99 })).article.rankScore, 0);
});

test('adaptive selection uses distinct demand, actual coverage and freshness without mandatory topics', () => {
  const now = Date.now();
  const trends = [
    { _id: 'rust', count: 1, newest: new Date(now) },
    { _id: 'react', count: 20, newest: new Date(now) }
  ];
  assert.deepEqual(
    adaptive
      .select(
        new Map([
          ['rust', 4],
          ['react', 50],
          ['kubernetes', 1]
        ]),
        trends,
        now
      )
      .map((entry) => entry.topic),
    ['rust']
  );
  assert.deepEqual(adaptive.select(new Map(), [], now), []);
  assert.deepEqual(
    adaptive.select(new Map(), trends, now).map((entry) => entry.topic),
    ['rust']
  );
  assert.equal(adaptive.select(new Map([['rust', 1]]), [], now).length, 0);
});

test('configuration audit detects duplicate and unknown keys without exposing values', () => {
  assert.throws(() => auditNewsConfiguration({ NEWS_UNKNOWN: 'secret' }), /unknown=NEWS_UNKNOWN/);
  assert.throws(
    () => auditNewsConfiguration({}, 'NEWS_INGESTION_ENABLED=true\nNEWS_INGESTION_ENABLED=false'),
    /duplicate=NEWS_INGESTION_ENABLED/
  );
  assert.ok(auditNewsConfiguration({}).missing.includes('NEWS_CATALOG_RETENTION_DAYS'));
});

test('hourly source limits apply before TTL deletion and revoked approval hides stored records', () => {
  const oldHours = process.env.NEWS_HACKERNEWS_RETENTION_HOURS;
  const oldApproval = process.env.NEWS_HACKERNEWS_CONTENT_APPROVED;
  const oldSearchApproval = process.env.NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED;
  try {
    process.env.NEWS_HACKERNEWS_RETENTION_HOURS = '1';
    const value = catalog.prepare(article());
    assert.equal(value.expiresAt - value.article.publishedAt, 3600000);
    assert.equal(catalog.prepare(article({ publishedAt: new Date(Date.now() - 7200000) })), null);
    process.env.NEWS_HACKERNEWS_CONTENT_APPROVED = 'false';
    process.env.NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED = 'false';
    assert.equal(catalog.prepare(article()), null);
    assert.ok(
      !catalog
        .predicate({ dateRange: 'month', source: 'All', category: 'All' })
        .$or.some((entry) => entry.source === 'Hacker News')
    );
  } finally {
    for (const [key, value] of Object.entries({
      NEWS_HACKERNEWS_RETENTION_HOURS: oldHours,
      NEWS_HACKERNEWS_CONTENT_APPROVED: oldApproval,
      NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED: oldSearchApproval
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
