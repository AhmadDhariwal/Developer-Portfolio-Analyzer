require('dotenv').config();

/**
 * Idempotent AnalysisCache index migration for recommendation (and shared) lookups.
 * Safe to re-run; does not drop unrelated indexes or rewrite documents.
 */
const INDEXES = [
  {
    name: 'recommendation_exact_lookup_v5',
    keys: {
      userId: 1,
      githubUsername: 1,
      careerStack: 1,
      experienceLevel: 1,
      analysisVersion: 1,
      resumeHash: 1,
      resumeAnalysisId: 1,
      signalHash: 1
    }
  },
  {
    name: 'recommendation_version_recency_v5',
    keys: {
      userId: 1,
      analysisVersion: 1,
      updatedAt: -1
    }
  }
];

const sameKey = (left = {}, right = {}) => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value);
};

const ensureIndex = async (collection, index) => {
  const existing = await collection.indexes();
  const byName = existing.find((item) => item.name === index.name);
  if (byName && sameKey(byName.key, index.keys)) {
    return { name: index.name, action: 'exists' };
  }
  if (byName && !sameKey(byName.key, index.keys)) {
    await collection.dropIndex(index.name);
  }
  const duplicateKey = existing.find((item) => item.name !== index.name && sameKey(item.key, index.keys));
  if (duplicateKey) {
    return { name: index.name, action: 'covered_by', coveredBy: duplicateKey.name };
  }
  await collection.createIndex(index.keys, { name: index.name, background: true });
  return { name: index.name, action: 'created' };
};

const migrateRecommendationIndexes = async (AnalysisCache) => {
  const collection = AnalysisCache.collection;
  const results = [];
  for (const index of INDEXES) {
    results.push(await ensureIndex(collection, index));
  }

  let explain = null;
  if (typeof collection.find === 'function') {
    try {
      const cursor = collection.find({
        userId: '000000000000000000000000',
        githubUsername: 'index-probe',
        careerStack: 'Backend',
        experienceLevel: 'Intern',
        analysisVersion: 'v5-career-advisor-data-quality',
        resumeHash: 'a'.repeat(64),
        resumeAnalysisId: 'default',
        signalHash: 'probe'
      }).limit(1);
      if (typeof cursor.explain === 'function') {
        explain = await cursor.explain('executionStats');
      }
    } catch (_) {
      explain = null;
    }
  }

  return { indexes: results, explain };
};

if (require.main === module) {
  const mongoose = require('mongoose');
  const AnalysisCache = require('../models/analysisCache');
  (async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const result = await migrateRecommendationIndexes(AnalysisCache);
    console.log(JSON.stringify(result, null, 2));
    await mongoose.disconnect();
  })().catch(async (error) => {
    console.error(error);
    try { await require('mongoose').disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
}

module.exports = { migrateRecommendationIndexes, INDEXES };
