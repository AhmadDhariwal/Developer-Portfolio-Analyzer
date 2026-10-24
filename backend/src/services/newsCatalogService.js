const { createHash } = require('node:crypto');
const Article = require('../models/newsArticle');
const cache = require('./redisCacheService');
const telemetry = require('./newsMetricsService');
const { normalizeItem } = require('../utils/newsFormatter');
const { TOPICS, matchesTopic } = require('../utils/newsTopics');
const { queryFor } = require('../utils/newsQuery');
const SOURCE_KEYS = {
  'Hacker News': 'HACKERNEWS',
  'Dev.to': 'DEVTO',
  NewsAPI: 'NEWSAPI',
  GNews: 'GNEWS',
  Reddit: 'REDDIT',
  'GitHub Releases': 'GITHUBRELEASES',
  'GitHub Security Advisories': 'GITHUBADVISORIES',
  Lobsters: 'LOBSTERS',
  'Kubernetes Blog': 'KUBERNETESBLOG',
  'Cloudflare Changelog': 'CLOUDFLARECHANGELOG'
};
const VERSION = 'news:catalog:version';
const memory = new Map();
const metrics = { accepted: 0, inserted: 0, duplicates: 0, failures: 0, reads: 0, cacheHits: 0 };
const days = (value, fallback) => Math.max(1, Math.min(35, Number(value) || fallback));
function sourceAllowed(source) {
  const key = SOURCE_KEYS[source];
  const values = [process.env[`NEWS_${key}_CONTENT_APPROVED`]];
  if (['HACKERNEWS', 'DEVTO'].includes(key)) {
    values.push(process.env[`NEWS_${key}SEARCH_CONTENT_APPROVED`]);
    if (values[0] === undefined) return true;
  }
  return values.includes('true');
}
function retentionMs(source) {
  const key = SOURCE_KEYS[source];
  const fallback = ['REDDIT', 'NEWSAPI', 'GNEWS'].includes(key) ? 24 : 840;
  const hours = Number(process.env[`NEWS_${key}_RETENTION_HOURS`] || fallback);
  const searchHours = ['HACKERNEWS', 'DEVTO'].includes(key)
    ? Number(process.env[`NEWS_${key}SEARCH_RETENTION_HOURS`] || 840)
    : 840;
  return (
    Math.min(
      days(process.env.NEWS_CATALOG_RETENTION_DAYS, 35) * 24,
      Math.max(1, Math.min(840, hours)),
      Math.max(1, Math.min(840, searchHours))
    ) * 3600000
  );
}
function prepare(raw, now = Date.now()) {
  const article = normalizeItem(raw);
  if (!article) return null;
  article.rankScore = 0;
  article.relevanceScore = 0;
  if (!sourceAllowed(article.source)) return null;
  const expiresAt = new Date(new Date(article.publishedAt).getTime() + retentionMs(article.source));
  if (expiresAt.getTime() <= now) return null;
  const technologies = Object.keys(TOPICS).filter((topic) => matchesTopic(article, topic));
  // Exact, indexed word/phrase membership supports AND-of-synonym-groups without regex scans.
  const words =
    `${article.title} ${article.description} ${article.tags.join(' ')}`
      .toLowerCase()
      .match(/[a-z0-9]+(?:[./-][a-z0-9]+)*(?:\+\+|#)?/g) || [];
  const terms = new Set(technologies);
  for (let start = 0; start < words.length; start++) {
    for (let size = 1; size <= 6 && start + size <= words.length; size++) {
      const term = words
        .slice(start, start + size)
        .join(' ')
        .replace(/^[^a-z0-9]+|[^a-z0-9+#.]+$/g, '');
      if (term) terms.add(term);
    }
  }
  const canonicalId = createHash('sha256')
    .update(article.url.replace(/^http:/, 'https:').replace(/\/$/, ''))
    .digest('hex');
  return {
    canonicalId,
    article,
    technologies,
    searchTerms: [...terms],
    source: article.source,
    category: article.category,
    publishedAt: article.publishedAt,
    expiresAt
  };
}
async function ingest(items) {
  const byIdentity = new Map();
  for (const raw of items) {
    const doc = prepare(raw);
    if (!doc) continue;
    const previous = byIdentity.get(doc.canonicalId);
    if (previous) {
      previous.expiresAt = new Date(Math.min(previous.expiresAt, doc.expiresAt));
      previous.technologies = [...new Set([...previous.technologies, ...doc.technologies])].sort();
      previous.searchTerms = [...new Set([...previous.searchTerms, ...doc.searchTerms])].sort();
    } else byIdentity.set(doc.canonicalId, doc);
  }
  const documents = [...byIdentity.values()];
  if (!documents.length) return { accepted: 0, inserted: 0, duplicates: 0 };
  if (Article.db.readyState !== 1) throw new Error('Catalog unavailable');
  try {
    const result = await Article.bulkWrite(
      documents.map(({ expiresAt, technologies, searchTerms, ...doc }) => ({
        updateOne: {
          filter: { canonicalId: doc.canonicalId },
          // Existing attribution is stable; expiry can only become stricter.
          update: {
            $setOnInsert: doc,
            $min: { expiresAt },
            $addToSet: { technologies: { $each: technologies }, searchTerms: { $each: searchTerms } }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );
    const summary = {
      accepted: documents.length,
      inserted: result.upsertedCount,
      duplicates: documents.length - result.upsertedCount
    };
    for (const key of Object.keys(summary)) {
      metrics[key] += summary[key];
      telemetry.ingestion.inc({ outcome: key }, summary[key]);
    }
    return summary;
  } catch (error) {
    metrics.failures++;
    telemetry.ingestion.inc({ outcome: 'failure' });
    // Concurrent upserts may lose the unique-key race; retry the bounded batch idempotently.
    if (error.code === 11000 && !error.writeErrors?.some((entry) => entry.code !== 11000)) {
      await Article.bulkWrite(
        documents.map((doc) => ({
          updateOne: {
            filter: { canonicalId: doc.canonicalId },
            update: {
              $min: { expiresAt: doc.expiresAt },
              $addToSet: {
                technologies: { $each: doc.technologies },
                searchTerms: { $each: doc.searchTerms }
              }
            }
          }
        })),
        { ordered: false }
      );
      return {
        accepted: documents.length,
        inserted: error.result?.upsertedCount || 0,
        duplicates: documents.length - (error.result?.upsertedCount || 0)
      };
    }
    throw error;
  } finally {
    memory.clear();
    // Durable version is authoritative even if Redis publication fails. No cached private ranking.
    const versions = [
      VERSION,
      ...new Set(documents.flatMap((doc) => doc.technologies).map((topic) => VERSION + ':topic:' + topic))
    ];
    await Article.db.collection('newsCatalogVersions').bulkWrite(
      versions.map((key) => ({
        updateOne: { filter: { _id: key }, update: { $inc: { version: 1 } }, upsert: true }
      })),
      { ordered: false }
    );
  }
}
function predicate(filters, { broad = false } = {}) {
  const now = Date.now();
  // Coverage must describe selectable results. Retention remains source-aware, up to 35 days.
  const age = broad ? 30 : { today: 1, week: 7, month: 30 }[filters.dateRange] || 7;
  const match = {
    expiresAt: { $gt: new Date(now) },
    $or: Object.keys(SOURCE_KEYS)
      .filter(sourceAllowed)
      .map((source) => ({ source, publishedAt: { $gte: new Date(now - retentionMs(source)) } })),
    publishedAt: { $gte: new Date(now - age * 86400000), $lte: new Date(now + 300000) }
  };
  if (!match.$or.length) {
    delete match.$or;
    match.canonicalId = { $in: [] };
  }
  const query = queryFor(filters.search);
  if (query?.topic) match.technologies = query.topic;
  else if (query) match.$and = query.groups.map((group) => ({ searchTerms: { $in: group } }));
  if (!broad) {
    if (filters.source !== 'All') match.source = filters.source;
    if (filters.category !== 'All') match.category = filters.category;
    if (filters.popularity === 'high') match['article.popularity'] = { $gte: 200 };
  }
  return match;
}
async function query(filters, { bypass = false } = {}) {
  if (Article.db.readyState !== 1) return null;
  metrics.reads++;
  const topic = queryFor(filters.search)?.topic;
  const revision = await Article.db
    .collection('newsCatalogVersions')
    .findOne({ _id: topic ? VERSION + ':topic:' + topic : VERSION });
  const version = revision?.version || 0;
  const key =
    'news:catalog:query:' +
    createHash('sha256')
      .update(
        JSON.stringify([
          version,
          filters,
          Object.keys(SOURCE_KEYS).map((source) => [source, sourceAllowed(source), retentionMs(source)])
        ])
      )
      .digest('hex');
  const now = Date.now();
  const valid = (entry) => entry && entry.until > now && entry.expiresAt > now;
  if (!bypass && valid(memory.get(key))) {
    metrics.cacheHits++;
    telemetry.queries.inc({ tier: 'memory' });
    return memory.get(key).value;
  }
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!bypass && redis) {
    try {
      const entry = JSON.parse(await redis.get(key));
      if (valid(entry)) {
        metrics.cacheHits++;
        telemetry.queries.inc({ tier: 'redis' });
        return entry.value;
      }
    } catch {
      /* Catalog remains readable without Redis. */
    }
  }
  telemetry.queries.inc({ tier: 'mongo' });
  const match = predicate(filters);
  const sort =
    filters.tab === 'trending'
      ? { 'article.popularity': -1, publishedAt: -1, canonicalId: 1 }
      : { publishedAt: -1, canonicalId: 1 };
  const personalized = filters.mode !== 'explore';
  const cap = Number(process.env.NEWS_CATALOG_RANKING_LIMIT || 2000);
  const [documents, total, broadTotal, summaries, historicalTotal] = await Promise.all([
    Article.find(match)
      .sort(sort)
      .skip(personalized ? 0 : (filters.page - 1) * filters.limit)
      .limit(personalized ? cap : filters.limit)
      .maxTimeMS(2000)
      .lean(),
    Article.countDocuments(match).maxTimeMS(2000),
    filters.search
      ? Article.countDocuments(predicate(filters, { broad: true })).maxTimeMS(2000)
      : Promise.resolve(0),
    Article.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 },
          newest: { $max: '$publishedAt' },
          updated: { $max: '$updatedAt' }
        }
      }
    ]).option({ maxTimeMS: 2000 }),
    filters.search
      ? Article.countDocuments(predicate({ ...filters, dateRange: 'month' })).maxTimeMS(2000)
      : Promise.resolve(0)
  ]);
  const value = {
    items: documents.map((doc) => ({
      ...doc.article,
      tags: [...new Set([...doc.article.tags, ...doc.technologies])]
    })),
    total,
    broadTotal,
    historicalTotal,
    sourceSummary: Object.fromEntries(summaries.map((row) => [row._id, row.count])),
    newestArticleAt: summaries.length
      ? new Date(Math.max(...summaries.map((row) => new Date(row.newest).getTime()))).toISOString()
      : null,
    lastUpdated: summaries.length
      ? new Date(Math.max(...summaries.map((row) => new Date(row.updated).getTime()))).toISOString()
      : null,
    version,
    rankingLimited: personalized && total > cap
  };
  const entry = {
    value,
    until: now + 5000,
    expiresAt: Math.min(
      now + 5000,
      ...documents.map((doc) =>
        Math.min(
          new Date(doc.expiresAt).getTime(),
          new Date(doc.publishedAt).getTime() + retentionMs(doc.source),
          new Date(doc.publishedAt).getTime() +
            ({ today: 1, week: 7, month: 30 }[filters.dateRange] || 7) * 86400000
        )
      )
    )
  };
  while (memory.size >= 128) memory.delete(memory.keys().next().value);
  memory.set(key, entry);
  if (redis)
    await redis
      .set(key, JSON.stringify(entry), { PX: Math.max(1, entry.expiresAt - Date.now()) })
      .catch(() => {});
  return value;
}
async function trends() {
  const result = await Article.aggregate([
    {
      $match: predicate({ dateRange: 'week', source: 'All', category: 'All' })
    },
    { $unwind: '$technologies' },
    { $group: { _id: '$technologies', count: { $sum: 1 }, newest: { $max: '$publishedAt' } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 64 }
  ]).option({ maxTimeMS: 2000 });
  telemetry.coverage.reset();
  result.forEach((row) => telemetry.coverage.set({ topic: row._id }, row.count));
  telemetry.size.set(await Article.countDocuments({ expiresAt: { $gt: new Date() } }).maxTimeMS(2000));
  return result;
}
async function health() {
  return {
    ...metrics,
    size: await Article.countDocuments({ expiresAt: { $gt: new Date() } }).maxTimeMS(2000),
    coverage: await trends()
  };
}
module.exports = {
  prepare,
  ingest,
  predicate,
  query,
  trends,
  health,
  SOURCE_KEYS,
  sourceAllowed,
  retentionMs
};
