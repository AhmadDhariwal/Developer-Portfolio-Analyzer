// Catalog-only activation evidence: no provider requests, quota changes or article writes.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const root = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const cache = require('../services/redisCacheService');
const catalog = require('../services/newsCatalogService');
const Article = require('../models/newsArticle');
const Pool = require('../models/news');
const phase = process.argv.includes('--before') ? 'before' : 'after';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  await cache.initRedisCache({ silent: true, probeOnly: true });
  const duplicateGroups = await Article.aggregate([
    { $group: { _id: '$canonicalId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'count' }
  ]);
  const pool = await Pool.findOne({ cacheKey: 'news:v3:public:pool' }).lean();
  const result = {
    checkedAt: new Date().toISOString(),
    phase,
    providerRequests: 0,
    articleWrites: 0,
    cacheWrites: 'Ordinary version-keyed public catalog query caches only',
    duplicateCanonicalGroups: duplicateGroups[0]?.count || 0,
    indexes: await Article.collection.indexes(),
    version: await Article.db.collection('newsCatalogVersions').findOne({ _id: 'news:catalog:version' }),
    providers: {}
  };
  for (const source of ['NewsAPI', 'GNews', 'Cloudflare Changelog']) {
    const rows = await Article.find({ source }).limit(1000).lean();
    const invalid = { dates: 0, attribution: 0, indexes: 0, retention: 0, license: 0 };
    for (const row of rows) {
      const prepared = catalog.prepare(row.article, new Date(row.publishedAt).getTime());
      if (!Number.isFinite(new Date(row.publishedAt).getTime())) invalid.dates++;
      if (!row.article.publisher || !/^https?:\/\//.test(row.article.attributionUrl)) invalid.attribution++;
      if (
        !prepared ||
        !Array.isArray(row.article.tags) ||
        prepared.technologies.some((tag) => !row.technologies.includes(tag)) ||
        prepared.searchTerms.some((term) => !row.searchTerms.includes(term))
      )
        invalid.indexes++;
      if (new Date(row.expiresAt) - new Date(row.publishedAt) > catalog.retentionMs(source))
        invalid.retention++;
      if (
        source === 'Cloudflare Changelog' &&
        (row.article.license !== 'CC-BY-4.0' ||
          row.article.licenseUrl !== 'https://creativecommons.org/licenses/by/4.0/')
      )
        invalid.license++;
    }
    const query = await catalog.query({
      mode: 'explore',
      tab: 'latest',
      source,
      category: 'All',
      dateRange: 'month',
      popularity: 'all',
      search: '',
      page: 1,
      limit: 12
    });
    const prefix = 'NEWS_' + catalog.SOURCE_KEYS[source] + '_';
    const fetched = (pool?.allItems || []).filter((item) => item.source === source);
    const ages = fetched.map((item) => (Date.now() - new Date(item.publishedAt)) / 3600000);
    const eligible = fetched.map((item) => catalog.prepare(item)).filter(Boolean);
    const existing = eligible.length
      ? await Article.find({ canonicalId: { $in: eligible.map((item) => item.canonicalId) } })
          .select('source')
          .lean()
      : [];
    result.providers[source] = {
      approved: process.env[prefix + 'CONTENT_APPROVED'],
      daily: Number(process.env[prefix + 'DAILY_BUDGET']),
      monthly: Number(process.env[prefix + 'MONTHLY_BUDGET']),
      intervalMs: Number(process.env[prefix + 'MIN_INTERVAL_MS']),
      retentionHours: catalog.retentionMs(source) / 3600000,
      checkedRows: rows.length,
      invalid,
      queryTotal: query.total,
      queryVersion: query.version,
      taggedRecords: rows.filter((row) => row.technologies.length).length,
      pool: {
        records: fetched.length,
        eligibleNow: eligible.length,
        ageHours: ages.length ? { minimum: Math.min(...ages), maximum: Math.max(...ages) } : null,
        eligibleCatalogOwners: existing.reduce((counts, row) => {
          counts[row.source] = (counts[row.source] || 0) + 1;
          return counts;
        }, {})
      }
    };
  }
  const output = path.join(root, 'verification/tech-news/provider-activation');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `catalog-${phase}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (
    result.duplicateCanonicalGroups ||
    Object.values(result.providers).some((provider) => Object.values(provider.invalid).some(Boolean))
  )
    process.exitCode = 1;
}
main()
  .catch(() => {
    console.error('Activation catalog verification failed; no credentials are logged.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await cache.closeRedisCache();
    await mongoose.disconnect();
  });
