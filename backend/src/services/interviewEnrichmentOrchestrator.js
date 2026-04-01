const logger = require('../utils/logger');
const {
  dedupeQuestions,
  isQualityQuestionAnswer,
  computeConfidenceScore,
  normalizeAnswerText,
  normalizeComparableText,
  normalizeQuestionText,
  sanitizeDifficulty,
  sanitizeTags
} = require('./interviewQuestionQualityService');

const withTimeout = async (promise, timeoutMs = 5000, fallbackValue = []) => {
  let timeoutHandle;

  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallbackValue), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const toStorableRecord = ({ item, topic, sourceType, sourceMeta = {}, popularity = 10, qualityState = 'approved' }) => {
  const question = normalizeQuestionText(item.question);
  const answer = normalizeAnswerText(item.answer);

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
    tags: sanitizeTags([...(item.tags || []), topic.topicKey, topic.topicType]),
    source: sourceType === 'user_asked' ? 'ai' : sourceType,
    sourceType,
    sourceMeta,
    confidenceScore: computeConfidenceScore({ sourceType, question, answer }),
    qualityState,
    popularity,
    usageCount: 0,
    lastUsedAt: null
  };
};

const createInterviewEnrichmentOrchestrator = ({
  aiProvider,
  scraperProvider,
  questionRepository
}) => {
  const enrichTopicQuestionPool = async ({
    topic,
    query = '',
    existingQuestions = [],
    requestedCount = 20,
    maxScrapeTimeoutMs = 5000,
    initiatedBy = 'runtime'
  }) => {
    const target = Math.max(0, Number(requestedCount || 0));
    if (target === 0) {
      return {
        insertedCount: 0,
        aiAdded: 0,
        scrapedAdded: 0,
        partial: false,
        attempted: false
      };
    }

    const existingComparableQuestions = existingQuestions
      .map((item) => normalizeComparableText(item.question || item.normalizedQuestion || ''))
      .filter(Boolean);

    const missing = Math.max(0, target - existingComparableQuestions.length);
    if (missing === 0) {
      return {
        insertedCount: 0,
        aiAdded: 0,
        scrapedAdded: 0,
        partial: false,
        attempted: false
      };
    }

    let aiCandidates = [];
    let scrapeCandidates = [];

    try {
      aiCandidates = await aiProvider.generateQuestionsFromAI({
        topicKey: topic.topicKey,
        topicType: topic.topicType,
        query,
        count: missing
      });
    } catch (error) {
      logger.warn('interview-prep ai enrichment failed', {
        topicKey: topic.topicKey,
        message: error.message,
        initiatedBy
      });
    }

    const validAi = dedupeQuestions({
      questions: aiCandidates.filter((item) => isQualityQuestionAnswer(item)),
      existingComparableQuestions
    });

    const remainingAfterAi = Math.max(0, missing - validAi.length);

    if (remainingAfterAi > 0) {
      try {
        scrapeCandidates = await withTimeout(
          scraperProvider.scrapeQuestionsForTopic({
            topicKey: topic.topicKey,
            topicType: topic.topicType,
            count: remainingAfterAi
          }),
          maxScrapeTimeoutMs,
          []
        );
      } catch (error) {
        logger.warn('interview-prep scrape enrichment failed', {
          topicKey: topic.topicKey,
          message: error.message,
          initiatedBy
        });
      }
    }

    const dedupedScrape = dedupeQuestions({
      questions: scrapeCandidates.filter((item) => isQualityQuestionAnswer(item)),
      existingComparableQuestions: [
        ...existingComparableQuestions,
        ...validAi.map((item) => normalizeComparableText(item.question))
      ]
    });

    const storable = [
      ...validAi.map((item) => toStorableRecord({
        item,
        topic,
        sourceType: 'ai',
        sourceMeta: { query, initiatedBy },
        popularity: 10
      })),
      ...dedupedScrape.map((item) => toStorableRecord({
        item,
        topic,
        sourceType: 'scraped',
        sourceMeta: { query, initiatedBy },
        popularity: 12
      }))
    ];

    if (storable.length === 0) {
      return {
        insertedCount: 0,
        aiAdded: 0,
        scrapedAdded: 0,
        partial: true,
        attempted: true
      };
    }

    const upsertResult = await questionRepository.upsertQuestions(storable);

    return {
      insertedCount: Number(upsertResult.insertedCount || 0),
      aiAdded: validAi.length,
      scrapedAdded: dedupedScrape.length,
      partial: validAi.length + dedupedScrape.length < missing,
      attempted: true
    };
  };

  return {
    enrichTopicQuestionPool,
    toStorableRecord
  };
};

module.exports = {
  createInterviewEnrichmentOrchestrator
};
