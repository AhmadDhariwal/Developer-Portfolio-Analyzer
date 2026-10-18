const cron = require('node-cron');
const logger = require('../utils/logger');
const { runInterviewJob } = require('./interviewJobService');
const { invalidateInterviewPrepCache } = require('./redisCacheService');
const { normalizeTopicInput, listImportantTopics } = require('./interviewTopicNormalizer');
const { scrapeQuestionsForTopic } = require('./providers/interviewScraperProvider');
const { upsertQuestions } = require('../repositories/interviewQuestionRepository');
const {
  computeConfidenceScore,
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags,
  isQualityQuestionAnswer,
  validateInterviewQuestionQuality
} = require('./interviewQuestionQualityService');

const INGEST_CRON_EXPR = process.env.INTERVIEW_QUESTION_INGEST_CRON || '0 */6 * * *';

const normalizeTopicRecord = (item = {}, topic = {}) => {
  const question = normalizeQuestionText(item.question || '');
  const answer = normalizeAnswerText(item.answer || '');
  const quality = validateInterviewQuestionQuality({
    ...item,
    question,
    answer,
    topicKey: topic.topicKey,
    sourceType: 'scraped'
  });
  if (!isQualityQuestionAnswer({ question, answer, topicKey: topic.topicKey }) || !quality.isValid) {
    return null;
  }

  return {
    topicKey: topic.topicKey,
    topicType: topic.topicType,
    topicDimensions: topic.topicDimensions,
    skill: topic.skill,
    question,
    answer,
    normalizedQuestion: normalizeComparableText(question),
    normalizedAnswer: normalizeComparableText(answer),
    difficulty: sanitizeDifficulty(item.difficulty),
    tags: sanitizeTags([...(item.tags || []), topic.topicKey, topic.topicType, 'scraped']),
    source: 'scraped',
    sourceType: 'scraped',
    sourceMeta: {
      ...(item.sourceMeta || {}),
      verificationStatus: 'unverified',
      channel: 'scheduled-ingestion',
      ingestedAt: new Date().toISOString()
    },
    confidenceScore: computeConfidenceScore({ sourceType: 'scraped', question, answer }),
    qualityState: 'review',
    qualityStatus: 'pending',
    reviewStatus: 'pending',
    isApproved: false,
    relevanceScore: quality.relevanceScore,
    popularity: 15,
    usageCount: 0,
    lastUsedAt: null
  };
};

const resolveIngestionTopics = () => {
  const envValue = String(process.env.INTERVIEW_QUESTION_INGEST_TOPICS || '').trim();
  if (envValue) {
    return [
      ...new Set(
        envValue
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ].slice(0, 31);
  }

  return listImportantTopics()
    .slice(0, 10)
    .map((topic) => topic.key);
};

const runInterviewQuestionIngestion = async () =>
  runInterviewJob(async ({ shouldContinue }) => {
    let totalInserted = 0;
    const topics = resolveIngestionTopics();

    for (const topicInput of topics) {
      if (!shouldContinue()) break;
      try {
        const topic = normalizeTopicInput({ topic: topicInput });
        const scraped = await scrapeQuestionsForTopic({
          topicKey: topic.topicKey,
          topicType: topic.topicType,
          count: 10
        });

        const records = scraped.map((item) => normalizeTopicRecord(item, topic)).filter(Boolean);

        const result = await upsertQuestions(records);
        totalInserted += Number(result.insertedCount || 0);
      } catch (error) {
        logger.warn('interview-ingestion topic failed', {
          topic: topicInput,
          message: error.message
        });
      }
    }

    if (totalInserted > 0) {
      await invalidateInterviewPrepCache();
    }

    return totalInserted;
  });

const startInterviewQuestionIngestionScheduler = () => {
  cron.schedule(INGEST_CRON_EXPR, async () => {
    try {
      const inserted = await runInterviewQuestionIngestion();
      logger.info('interview-ingestion completed', { inserted });
    } catch (error) {
      logger.error('interview-ingestion cron error', { message: error.message });
    }
  });

  logger.info('interview-ingestion scheduler started', { cron: INGEST_CRON_EXPR });
};

module.exports = {
  runInterviewQuestionIngestion,
  startInterviewQuestionIngestionScheduler
};
