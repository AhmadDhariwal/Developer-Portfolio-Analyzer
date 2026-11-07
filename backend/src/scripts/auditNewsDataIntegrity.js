// Read-only MongoDB Data Integrity & Duplicate Audit for Tech News
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
  quiet: true,
});

const Article = require("../models/newsArticle");
const SavedItem = require("../models/newsSavedItem");
const TopicCache = require("../models/newsTopicCache");
const Pool = require("../models/news");
const catalog = require("../services/newsCatalogService");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false,
    serverSelectionTimeoutMS: 5000,
  });
  const now = new Date();

  // 1. Total articles & per-provider counts
  const total = await Article.countDocuments();
  const perSource = await Article.aggregate([
    {
      $group: {
        _id: "$source",
        total: { $sum: 1 },
        unexpired: { $sum: { $cond: [{ $gt: ["$expiresAt", now] }, 1, 0] } },
        expired: { $sum: { $cond: [{ $lte: ["$expiresAt", now] }, 1, 0] } },
        minPublished: { $min: "$publishedAt" },
        maxPublished: { $max: "$publishedAt" },
        minExpires: { $min: "$expiresAt" },
        maxExpires: { $max: "$expiresAt" },
      },
    },
    { $sort: { total: -1 } },
  ]);

  // 2. Duplicate canonicalId check
  const duplicateCanonical = await Article.aggregate([
    { $group: { _id: "$canonicalId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  // 3. Duplicate raw URL check
  const duplicateUrl = await Article.aggregate([
    { $group: { _id: "$article.url", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  // 4. Duplicate or similar titles with different URLs check
  const sameTitleDifferentUrl = await Article.aggregate([
    {
      $group: {
        _id: { $toLower: "$article.title" },
        urls: { $addToSet: "$article.url" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  // 5. Field completeness / malformed metadata check
  const malformed = {
    missingCanonicalId: await Article.countDocuments({
      canonicalId: { $in: [null, ""] },
    }),
    missingTitle: await Article.countDocuments({
      "article.title": { $in: [null, ""] },
    }),
    missingUrl: await Article.countDocuments({
      "article.url": { $in: [null, ""] },
    }),
    missingSource: await Article.countDocuments({
      source: { $in: [null, ""] },
    }),
    missingPublisher: await Article.countDocuments({
      "article.publisher": { $in: [null, ""] },
    }),
    missingPublishedAt: await Article.countDocuments({ publishedAt: null }),
    missingExpiresAt: await Article.countDocuments({ expiresAt: null }),
    missingAttributionUrl: await Article.countDocuments({
      "article.attributionUrl": { $in: [null, ""] },
    }),
    missingCategory: await Article.countDocuments({
      category: { $in: [null, ""] },
    }),
    emptyTechnologies: await Article.countDocuments({
      technologies: { $size: 0 },
    }),
    emptySearchTerms: await Article.countDocuments({
      searchTerms: { $size: 0 },
    }),
  };

  // 6. Retention bounds check (max retention 35 days = 840 hours)
  const maxRetentionMs = 35 * 24 * 60 * 60 * 1000;
  const articlesExceeding35Days = await Article.countDocuments({
    $expr: {
      $gt: [
        { $subtract: ["$expiresAt", "$publishedAt"] },
        maxRetentionMs + 60000,
      ], // +1 min grace for clock drift
    },
  });

  // 7. Check expired articles returned by catalog.query
  const expiredDocsCount = await Article.countDocuments({
    expiresAt: { $lte: now },
  });

  // 8. Indexes check
  const indexes = await Article.collection.indexes();

  // 9. Explain query plans for common search/filter combinations
  const baseFilter = {
    source: "All",
    category: "All",
    popularity: "all",
    dateRange: "month",
  };
  const queryPlans = {};

  // Plan A: Category filter
  queryPlans.categoryFilter = await Article.find(
    catalog.predicate({ ...baseFilter, category: "Backend" }),
  )
    .sort({ publishedAt: -1, canonicalId: 1 })
    .limit(20)
    .explain("executionStats");

  // Plan B: Technology multikey filter
  queryPlans.technologyFilter = await Article.find(
    catalog.predicate({ ...baseFilter, search: "kubernetes" }),
  )
    .sort({ publishedAt: -1, canonicalId: 1 })
    .limit(20)
    .explain("executionStats");

  // Plan C: Free-text search terms filter
  queryPlans.searchTermFilter = await Article.find(
    catalog.predicate({ ...baseFilter, search: "performance" }),
  )
    .sort({ publishedAt: -1, canonicalId: 1 })
    .limit(20)
    .explain("executionStats");

  // Plan D: Source filter
  queryPlans.sourceFilter = await Article.find(
    catalog.predicate({ ...baseFilter, source: "Dev.to" }),
  )
    .sort({ publishedAt: -1, canonicalId: 1 })
    .limit(20)
    .explain("executionStats");

  // 10. Saved items and reading history audit
  const savedItemTotal = await SavedItem.countDocuments();
  const savedByUser = await SavedItem.aggregate([
    {
      $group: {
        _id: "$userId",
        count: { $sum: 1 },
        types: { $addToSet: "$type" },
      },
    },
  ]);
  const duplicateSaves = await SavedItem.aggregate([
    {
      $group: {
        _id: { userId: "$userId", url: "$url", type: "$type" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);
  const savedIndexes = await SavedItem.collection.indexes();

  // 11. Legacy pool / topic caches check
  const legacyPool = await Pool.findOne({
    cacheKey: "news:v3:public:pool",
  }).lean();
  const topicCacheCount = await TopicCache.countDocuments();

  const extractPlanInfo = (exp) => {
    const st = exp.executionStats?.executionStages || {};
    const input = st.inputStage || {};
    const deepInput = input.inputStage || {};
    return {
      stage: st.stage,
      inputStage: input.stage,
      indexUsed:
        deepInput.indexName || input.indexName || st.indexName || "none",
      totalKeysExamined: exp.executionStats?.totalKeysExamined,
      totalDocsExamined: exp.executionStats?.totalDocsExamined,
      nReturned: exp.executionStats?.nReturned,
    };
  };

  const report = {
    timestamp: now.toISOString(),
    totalArticles: total,
    perSource,
    duplicateCanonicalCount: duplicateCanonical.length,
    duplicateUrlCount: duplicateUrl.length,
    sameTitleDifferentUrlCount: sameTitleDifferentUrl.length,
    sameTitleDifferentUrlExamples: sameTitleDifferentUrl.slice(0, 3),
    malformed,
    articlesExceeding35Days,
    expiredDocsCount,
    indexes: indexes.map((idx) => ({
      name: idx.name,
      key: idx.key,
      unique: idx.unique,
      expireAfterSeconds: idx.expireAfterSeconds,
    })),
    queryPlanSummary: {
      categoryFilter: extractPlanInfo(queryPlans.categoryFilter),
      technologyFilter: extractPlanInfo(queryPlans.technologyFilter),
      searchTermFilter: extractPlanInfo(queryPlans.searchTermFilter),
      sourceFilter: extractPlanInfo(queryPlans.sourceFilter),
    },
    savedItems: {
      total: savedItemTotal,
      usersCount: savedByUser.length,
      duplicateSavesCount: duplicateSaves.length,
      indexes: savedIndexes.map((idx) => ({
        name: idx.name,
        key: idx.key,
        unique: idx.unique,
      })),
    },
    legacyCaches: {
      poolPresent: Boolean(legacyPool),
      poolItemsCount: legacyPool?.allItems?.length || 0,
      topicCacheCount,
    },
  };

  const outDir = path.resolve(
    __dirname,
    "../../verification/tech-news/runtime-audit",
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "database-integrity-audit.json"),
    JSON.stringify(report, null, 2),
  );

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("Error running database audit:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
