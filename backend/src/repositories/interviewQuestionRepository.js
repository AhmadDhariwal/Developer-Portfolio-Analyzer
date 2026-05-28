const crypto = require('node:crypto');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const {
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags
} = require('../services/interviewQuestionQualityService');

const DEFAULT_SORT = {
  usageCount: -1,
  confidenceScore: -1,
  popularity: -1,
  lastUsedAt: -1,
  createdAt: -1
};
const TOP_CATEGORY_FILTER = ['conceptual', 'best_practice'];
const VALID_SOURCES = new Set(['prebuilt', 'ai', 'ai_generated', 'scraped', 'user_asked']);
const VALID_CATEGORIES = new Set(['conceptual', 'scenario_based', 'code_output', 'best_practice', 'system_design', 'behavioral']);
const toQuestionHash = (value = '') => crypto
  .createHash('sha256')
  .update(normalizeComparableText(value))
  .digest('hex');

const buildQuestionFilter = ({ topicKey = '', skill = '', topicType = '', difficulty = '', tags = '', query = '', excludeGenericSeeds = false } = {}) => {
  const filter = {
    qualityState: { $ne: 'rejected' }
  };
  const normalizedTopicKey = String(topicKey || '').trim().toLowerCase();
  const normalizedSkill = String(skill || '').trim().toLowerCase();
  const normalizedTopicType = String(topicType || '').trim().toLowerCase();
  const normalizedTags = String(tags || '').trim().toLowerCase();
  const normalizedQuery = String(query || '').trim();

  if (normalizedTopicKey) {
    filter.topicKey = normalizedTopicKey;
  } else if (normalizedSkill) {
    filter.skill = normalizedSkill;
  }

  if (normalizedTopicType) {
    filter.topicType = normalizedTopicType;
  }

  const normalizedDifficulty = String(difficulty || '').trim().toLowerCase();
  if (normalizedDifficulty) {
    filter.difficulty = normalizedDifficulty;
  }

  if (normalizedTags) {
    const tagList = normalizedTags
      .split(',')
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean);

    if (tagList.length > 0) {
      filter.tags = { $in: tagList };
    }
  }

  if (normalizedQuery) {
    filter.$text = { $search: normalizedQuery };
  }

  if (excludeGenericSeeds) {
    filter['sourceMeta.seedVersion'] = { $ne: 'v2' };
  }

  return filter;
};

const findQuestionsPage = async ({ filter = {}, page = 1, limit = 20, includeTextScore = false } = {}) => {
  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);

  const projection = includeTextScore
    ? { score: { $meta: 'textScore' } }
    : undefined;

  const sort = includeTextScore
    ? { score: { $meta: 'textScore' }, usageCount: -1, confidenceScore: -1, popularity: -1, createdAt: -1 }
    : DEFAULT_SORT;

  const [questions, total] = await Promise.all([
    InterviewQuestionBank.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
    InterviewQuestionBank.countDocuments(filter)
  ]);

  return { questions, total };
};

const upsertQuestions = async (records = []) => {
  if (!Array.isArray(records) || records.length === 0) {
    return { insertedCount: 0, upsertedIds: [] };
  }

  const operations = records.map((record) => {
    const topicKey = String(record.topicKey || record.skill || '').trim().toLowerCase();
    const normalizedQuestion = normalizeComparableText(record.normalizedQuestion || record.question);
    const normalizedQuestionHash = String(record.normalizedQuestionHash || toQuestionHash(normalizedQuestion)).trim().toLowerCase();
    const normalizedAnswer = normalizeComparableText(record.normalizedAnswer || record.answer);
    const rawSourceType = String(record.sourceType || record.source || 'prebuilt').trim().toLowerCase();
    const sourceType = VALID_SOURCES.has(rawSourceType) ? rawSourceType : 'ai_generated';
    const category = String(record.category || 'conceptual').trim().toLowerCase();
    const answerSections = record.answerSections && typeof record.answerSections === 'object'
      ? record.answerSections
      : {};
    const hasStructuredAnswer = Object.keys(answerSections).length > 0 || record.answerFormat === 'structured';
    const normalizedSkill = String(record.skill || topicKey || '').trim().toLowerCase();

    return {
      updateOne: {
        filter: {
          topicKey,
          $or: [
            { normalizedQuestionHash },
            { normalizedQuestion }
          ]
        },
        update: {
          $setOnInsert: {
            usageCount: Number(record.usageCount || 0),
            lastUsedAt: record.lastUsedAt || null,
            createdAt: record.createdAt || new Date()
          },
          $set: {
            topicKey,
            topicType: String(record.topicType || '').trim().toLowerCase() || 'technology',
            skill: normalizedSkill,
            question: normalizeQuestionText(record.question),
            answer: normalizeAnswerText(record.answer),
            answerSections,
            normalizedQuestion,
            normalizedQuestionHash,
            normalizedAnswer,
            difficulty: sanitizeDifficulty(record.difficulty),
            tags: sanitizeTags(record.tags || []),
            source: sourceType === 'user_asked' ? 'ai_generated' : sourceType,
            sourceType,
            sourceMeta: record.sourceMeta || {},
            confidenceScore: Number(record.confidenceScore || 0.7),
            category: VALID_CATEGORIES.has(category) ? category : 'conceptual',
            qualityScore: Math.min(5, Math.max(1, Number(record.qualityScore || 3))),
            answerFormat: hasStructuredAnswer ? 'structured' : 'plain',
            isEnriched: Boolean(record.isEnriched || hasStructuredAnswer),
            qualityState: String(record.qualityState || 'approved').trim().toLowerCase(),
            popularity: Number(record.popularity || 0),
            topicDimensions: record.topicDimensions || {}
          }
        },
        upsert: true
      }
    };
  });

  const result = await InterviewQuestionBank.bulkWrite(operations, { ordered: false });
  return {
    insertedCount: Number(result.upsertedCount || 0),
    upsertedIds: Object.values(result.upsertedIds || {})
  };
};

const findTopQuestions = async ({ topicKey = '', limit = 30, difficulty = '', tags = '' } = {}) => {
  const filter = buildQuestionFilter({
    topicKey,
    difficulty,
    tags,
    excludeGenericSeeds: true
  });
  filter.category = { $in: TOP_CATEGORY_FILTER };
  filter.qualityScore = { $gte: 4 };

  const rows = await InterviewQuestionBank.find(filter)
    .sort({ usageCount: -1, qualityScore: -1, confidenceScore: -1, popularity: -1, lastUsedAt: -1, createdAt: -1 })
    .limit(Math.min(60, Math.max(1, Number(limit || 30))))
    .lean();

  return rows;
};

const findAllQuestionsPage = async ({ topicKey = '', page = 1, limit = 10, difficulty = '', tags = '', category = '', source = '' } = {}) => {
  const filter = buildQuestionFilter({ topicKey, difficulty, tags, excludeGenericSeeds: true });
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const normalizedSource = String(source || '').trim().toLowerCase();
  if (normalizedCategory) filter.category = normalizedCategory;
  if (normalizedSource) {
    if (normalizedSource === 'ai') filter.sourceType = { $in: ['ai', 'ai_generated', 'user_asked'] };
    else if (normalizedSource === 'seed') filter.sourceType = 'prebuilt';
    else if (normalizedSource === 'database') filter.sourceType = { $nin: ['ai', 'ai_generated', 'scraped', 'prebuilt'] };
    else filter.sourceType = normalizedSource;
  }

  const skip = (Math.max(1, Number(page || 1)) - 1) * Math.max(1, Number(limit || 10));
  const [questions, total] = await Promise.all([
    InterviewQuestionBank.find(filter)
      .sort({ qualityScore: -1, usageCount: -1, confidenceScore: -1, popularity: -1, createdAt: -1 })
      .skip(skip)
      .limit(Math.max(1, Number(limit || 10)))
      .lean(),
    InterviewQuestionBank.countDocuments(filter)
  ]);

  return { questions, total };
};

const findSearchTextMatches = async ({ topicKey = '', query = '', limit = 5, difficulty = '', tags = '' } = {}) => {
  const filter = buildQuestionFilter({
    topicKey,
    difficulty,
    tags,
    query,
    excludeGenericSeeds: true
  });

  return InterviewQuestionBank.find(filter, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, qualityScore: -1, usageCount: -1, confidenceScore: -1 })
    .limit(Math.max(1, Number(limit || 5)))
    .lean();
};

const findAiGeneratedByTopic = async ({ topicKey = '', topic = '', limit = 10 } = {}) => {
  const normalizedTopicKey = String(topicKey || '').trim().toLowerCase();
  const normalizedTopic = String(topic || '').trim().toLowerCase();
  const filter = {
    topicKey: normalizedTopicKey,
    sourceType: { $in: ['ai', 'ai_generated', 'user_asked'] },
    qualityState: { $ne: 'rejected' }
  };
  if (normalizedTopic) {
    filter.$or = [
      { tags: normalizedTopic },
      { question: new RegExp(normalizedTopic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { 'sourceMeta.topic': normalizedTopic }
    ];
  }

  return InterviewQuestionBank.find(filter)
    .sort({ qualityScore: -1, usageCount: -1, confidenceScore: -1, createdAt: -1 })
    .limit(Math.max(1, Number(limit || 10)))
    .lean();
};

const countAiGeneratedByTopic = async ({ topicKey = '', topic = '' } = {}) => {
  const normalizedTopicKey = String(topicKey || '').trim().toLowerCase();
  const normalizedTopic = String(topic || '').trim().toLowerCase();
  const filter = {
    topicKey: normalizedTopicKey,
    sourceType: { $in: ['ai', 'ai_generated', 'user_asked'] },
    qualityState: { $ne: 'rejected' }
  };
  if (normalizedTopic) {
    filter.$or = [
      { tags: normalizedTopic },
      { 'sourceMeta.topic': normalizedTopic },
      { 'sourceMeta.query': normalizedTopic }
    ];
  }
  return InterviewQuestionBank.countDocuments(filter);
};

const findNeedsEnrichment = async ({ limit = 50 } = {}) => (
  InterviewQuestionBank.find({
    $or: [
      { category: { $exists: false } },
      { isEnriched: false },
      { answerFormat: { $ne: 'structured' } }
    ]
  })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, Number(limit || 50)))
);

const updateQuestionById = async (id, update = {}) => {
  if (!id) return null;
  return InterviewQuestionBank.findByIdAndUpdate(id, update, { new: true }).lean();
};

const findExactReusableQuestion = async ({ topicKey = '', question = '', minConfidence = 0.55 } = {}) => {
  const normalizedQuestion = normalizeComparableText(question);
  if (!normalizedQuestion) return null;

  return InterviewQuestionBank.findOne({
    topicKey: String(topicKey || '').trim().toLowerCase(),
    qualityState: { $ne: 'rejected' },
    confidenceScore: { $gte: minConfidence },
    $or: [
      { normalizedQuestionHash: toQuestionHash(normalizedQuestion) },
      { normalizedQuestion }
    ]
  }).lean();
};

const findSemanticCandidates = async ({ topicKey = '', tags = [], limit = 40, minConfidence = 0.6 } = {}) => {
  const filter = {
    topicKey: String(topicKey || '').trim().toLowerCase(),
    qualityState: { $ne: 'rejected' },
    confidenceScore: { $gte: minConfidence }
  };
  const safeTags = sanitizeTags(tags);
  if (safeTags.length) filter.tags = { $in: safeTags };

  return InterviewQuestionBank.find(filter)
    .sort({ usageCount: -1, popularity: -1, createdAt: -1 })
    .limit(limit)
    .lean();
};

const incrementQuestionUsage = async (id) => {
  if (!id) return;
  await InterviewQuestionBank.updateOne(
    { _id: id },
    { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
  );
};

const fetchComparableQuestionsByTopic = async (topicKey = '', limit = 500) => {
  if (!topicKey) return [];
  const rows = await InterviewQuestionBank.find({ topicKey: String(topicKey).toLowerCase() })
    .select('normalizedQuestion question')
    .limit(limit)
    .lean();

  return rows
    .map((item) => item.normalizedQuestion || normalizeComparableText(item.question))
    .filter(Boolean);
};

const getSourceMixByTopic = async (topicKey = '') => {
  if (!topicKey) return {};

  const rows = await InterviewQuestionBank.aggregate([
    {
      $match: {
        topicKey: String(topicKey || '').trim().toLowerCase()
      }
    },
    {
      $group: {
        _id: { $ifNull: ['$sourceType', '$source'] },
        count: { $sum: 1 }
      }
    }
  ]);

  return rows.reduce((acc, row) => {
    acc[String(row._id || 'unknown')] = Number(row.count || 0);
    return acc;
  }, {});
};

const incrementUsageStats = async (ids = []) => {
  const normalizedIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (normalizedIds.length === 0) return;

  await InterviewQuestionBank.updateMany(
    { _id: { $in: normalizedIds } },
    {
      $inc: { usageCount: 1 },
      $set: { lastUsedAt: new Date() }
    }
  );
};

const countQuestionsByTopic = async (topicKey = '') => {
  if (!topicKey) return 0;
  return InterviewQuestionBank.countDocuments({ topicKey: String(topicKey || '').trim().toLowerCase() });
};

const countQuestionsByTopicAndSeedVersion = async (topicKey = '', seedVersion = '') => {
  if (!topicKey || !seedVersion) return 0;
  return InterviewQuestionBank.countDocuments({
    topicKey: String(topicKey || '').trim().toLowerCase(),
    'sourceMeta.seedVersion': seedVersion
  });
};

module.exports = {
  buildQuestionFilter,
  findQuestionsPage,
  findTopQuestions,
  findAllQuestionsPage,
  findSearchTextMatches,
  findAiGeneratedByTopic,
  countAiGeneratedByTopic,
  findNeedsEnrichment,
  updateQuestionById,
  upsertQuestions,
  findExactReusableQuestion,
  findSemanticCandidates,
  fetchComparableQuestionsByTopic,
  getSourceMixByTopic,
  incrementUsageStats,
  incrementQuestionUsage,
  toQuestionHash,
  countQuestionsByTopic,
  countQuestionsByTopicAndSeedVersion
};
