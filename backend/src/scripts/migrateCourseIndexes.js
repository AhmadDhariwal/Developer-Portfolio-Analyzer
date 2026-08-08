require('dotenv').config();

/**
 * Idempotent AnalysisCache index migration for Learning Hub lookups.
 * Safe to re-run; does not drop unrelated indexes or rewrite documents.
 */
const INDEXES = [
  {
    name: 'course_pool_lookup',
    keys: {
      userId: 1,
      analysisVersion: 1,
      signalHash: 1,
      updatedAt: -1
    },
    options: {
      partialFilterExpression: { analysisVersion: 'courses_pool_v5' }
    }
  },
  {
    name: 'course_skill_signal_lookup',
    keys: {
      userId: 1,
      careerStack: 1,
      experienceLevel: 1,
      analysisVersion: 1,
      updatedAt: -1
    },
    options: {
      partialFilterExpression: {
        analysisVersion: 'v6-skill-intelligence',
        'analysisData.missingSkills.0': { $exists: true }
      }
    }
  }
];

const sameKey = (left = {}, right = {}) => {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value], index) => (
    rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value
  ));
};

const samePartial = (left = null, right = null) => JSON.stringify(left || null) === JSON.stringify(right || null);

const ensureIndex = async (collection, index) => {
  const existing = await collection.indexes();
  const byName = existing.find((item) => item.name === index.name);
  if (
    byName
    && sameKey(byName.key, index.keys)
    && samePartial(byName.partialFilterExpression, index.options?.partialFilterExpression)
  ) {
    return { name: index.name, action: 'exists' };
  }
  if (byName) {
    await collection.dropIndex(index.name);
  }
  const duplicateKey = existing.find((item) => (
    item.name !== index.name
    && sameKey(item.key, index.keys)
    && samePartial(item.partialFilterExpression, index.options?.partialFilterExpression)
  ));
  if (duplicateKey) {
    return { name: index.name, action: 'covered_by', coveredBy: duplicateKey.name };
  }
  await collection.createIndex(index.keys, {
    name: index.name,
    background: true,
    ...(index.options || {})
  });
  return { name: index.name, action: 'created' };
};

const migrateCourseIndexes = async (AnalysisCache) => {
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
        analysisVersion: 'courses_pool_v5',
        signalHash: 'probe'
      }).sort({ updatedAt: -1 }).limit(1);
      if (typeof cursor.explain === 'function') {
        explain = await cursor.explain('executionStats');
      }
    } catch (_) {
      explain = null;
    }
  }

  return { results, explain };
};

module.exports = {
  INDEXES,
  migrateCourseIndexes
};

if (require.main === module) {
  (async () => {
    const mongoose = require('mongoose');
    const AnalysisCache = require('../models/analysisCache');
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
      console.error('MONGO_URI is required');
      process.exitCode = 1;
      return;
    }
    await mongoose.connect(uri);
    const report = await migrateCourseIndexes(AnalysisCache);
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
