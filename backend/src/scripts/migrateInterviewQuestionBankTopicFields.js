require('dotenv').config();
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { normalizeTopicInput } = require('../services/interviewTopicNormalizer');
const {
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags
} = require('../services/interviewQuestionQualityService');

const BATCH_SIZE = 200;

const buildDimensions = (topicType, topicKey) => ({
  stack: topicType === 'stack' ? [topicKey] : [],
  technology: topicType === 'technology' ? [topicKey] : [],
  language: topicType === 'language' ? [topicKey] : [],
  framework: topicType === 'framework' ? [topicKey] : []
});

const migrateRecords = async () => {
  const cursor = InterviewQuestionBank.find({}, {
    skill: 1,
    topicKey: 1,
    topicType: 1,
    topicDimensions: 1,
    question: 1,
    answer: 1,
    difficulty: 1,
    tags: 1,
    source: 1,
    sourceType: 1,
    sourceMeta: 1,
    confidenceScore: 1,
    qualityState: 1,
    popularity: 1,
    usageCount: 1,
    lastUsedAt: 1,
    createdAt: 1
  }).cursor();

  let processed = 0;
  let updated = 0;
  let bulk = [];

  for await (const item of cursor) {
    processed += 1;
    const topic = normalizeTopicInput({
      skill: item.topicKey || item.skill || item.tags?.[0] || ''
    });

    const normalizedQuestion = normalizeComparableText(item.normalizedQuestion || item.question);
    const normalizedAnswer = normalizeComparableText(item.normalizedAnswer || item.answer);

    const update = {
      skill: String(item.skill || topic.skill || topic.topicKey || '').trim().toLowerCase(),
      topicKey: topic.topicKey,
      topicType: topic.topicType,
      topicDimensions: item.topicDimensions || buildDimensions(topic.topicType, topic.topicKey),
      question: normalizeQuestionText(item.question || ''),
      answer: normalizeAnswerText(item.answer || ''),
      normalizedQuestion,
      normalizedAnswer,
      difficulty: sanitizeDifficulty(item.difficulty),
      tags: sanitizeTags(item.tags || []),
      source: String(item.source || item.sourceType || 'prebuilt').trim().toLowerCase(),
      sourceType: String(item.sourceType || item.source || 'prebuilt').trim().toLowerCase(),
      sourceMeta: item.sourceMeta || {},
      confidenceScore: Number(item.confidenceScore || 0.7),
      qualityState: String(item.qualityState || 'approved').trim().toLowerCase(),
      popularity: Number(item.popularity || 0),
      usageCount: Number(item.usageCount || 0),
      lastUsedAt: item.lastUsedAt || null,
      createdAt: item.createdAt || new Date()
    };

    bulk.push({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: update }
      }
    });

    if (bulk.length >= BATCH_SIZE) {
      const result = await InterviewQuestionBank.bulkWrite(bulk, { ordered: false });
      updated += Number(result.modifiedCount || 0);
      bulk = [];
    }
  }

  if (bulk.length > 0) {
    const result = await InterviewQuestionBank.bulkWrite(bulk, { ordered: false });
    updated += Number(result.modifiedCount || 0);
  }

  return { processed, updated };
};

const removeDuplicates = async () => {
  const rows = await InterviewQuestionBank.find({}, {
    _id: 1,
    topicKey: 1,
    normalizedQuestion: 1,
    createdAt: 1
  })
    .sort({ createdAt: 1 })
    .lean();

  const seen = new Map();
  const duplicates = [];

  for (const row of rows) {
    const topicKey = String(row.topicKey || '').trim().toLowerCase();
    const normalizedQuestion = String(row.normalizedQuestion || '').trim().toLowerCase();
    if (!topicKey || !normalizedQuestion) continue;

    const key = `${topicKey}::${normalizedQuestion}`;
    if (seen.has(key)) {
      duplicates.push(row._id);
      continue;
    }

    seen.set(key, row._id);
  }

  if (duplicates.length === 0) {
    return 0;
  }

  const result = await InterviewQuestionBank.deleteMany({ _id: { $in: duplicates } });
  return Number(result.deletedCount || 0);
};

const ensureIndexes = async () => {
  await InterviewQuestionBank.collection.createIndex({ topicKey: 1, normalizedQuestion: 1 }, { unique: true, sparse: true });
  await InterviewQuestionBank.collection.createIndex({ topicKey: 1, popularity: -1, createdAt: -1 });
  await InterviewQuestionBank.collection.createIndex({ topicKey: 1, sourceType: 1 });
};

const run = async () => {
  await connectDB();

  const migration = await migrateRecords();
  const deletedDuplicates = await removeDuplicates();
  await ensureIndexes();

  console.log(`[migrate-interview-question-bank] processed=${migration.processed} updated=${migration.updated} duplicatesRemoved=${deletedDuplicates}`);
  process.exit(0);
};

run().catch((error) => {
  console.error('[migrate-interview-question-bank] failed:', error.message);
  process.exit(1);
});
