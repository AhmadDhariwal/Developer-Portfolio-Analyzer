const InterviewQuestionBank = require('../models/interviewQuestionBank');
const {
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags
} = require('../services/interviewQuestionQualityService');

const DEFAULT_SORT = { popularity: -1, createdAt: -1 };

const buildQuestionFilter = ({ topicKey = '', skill = '', topicType = '', difficulty = '', tags = '', query = '' } = {}) => {
  const filter = {};
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

  return filter;
};

const findQuestionsPage = async ({ filter = {}, page = 1, limit = 20, includeTextScore = false } = {}) => {
  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);

  const projection = includeTextScore
    ? { score: { $meta: 'textScore' } }
    : undefined;

  const sort = includeTextScore
    ? { score: { $meta: 'textScore' }, popularity: -1, createdAt: -1 }
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
    const normalizedAnswer = normalizeComparableText(record.normalizedAnswer || record.answer);
    const sourceType = String(record.sourceType || record.source || 'prebuilt').trim().toLowerCase();
    const normalizedSkill = String(record.skill || topicKey || '').trim().toLowerCase();

    return {
      updateOne: {
        filter: {
          topicKey,
          normalizedQuestion
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
            normalizedQuestion,
            normalizedAnswer,
            difficulty: sanitizeDifficulty(record.difficulty),
            tags: sanitizeTags(record.tags || []),
            source: sourceType === 'user_asked' ? 'ai' : sourceType,
            sourceType,
            sourceMeta: record.sourceMeta || {},
            confidenceScore: Number(record.confidenceScore || 0.7),
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

module.exports = {
  buildQuestionFilter,
  findQuestionsPage,
  upsertQuestions,
  fetchComparableQuestionsByTopic,
  getSourceMixByTopic,
  incrementUsageStats,
  countQuestionsByTopic
};
