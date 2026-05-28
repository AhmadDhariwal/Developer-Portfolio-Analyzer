const aiService = require('./aiservice');
const logger = require('../utils/logger');
const InterviewPrepSession = require('../models/interviewPrepSession');
const { getInterviewPrepPrompt } = require('../prompts/interviewPrepPrompt');
const {
  CACHE_TTL_SECONDS,
  getCacheJson,
  setCacheJson,
  invalidateInterviewPrepCache
} = require('./redisCacheService');
const {
  normalizeTopicInput,
  listImportantTopics
} = require('./interviewTopicNormalizer');
const {
  SEED_VERSION,
  buildSeedRecordsForTopic,
  getTopicSeedItems,
  getImportantTopicByKey
} = require('./interviewQuestionSeedCatalog');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  normalizeComparableText,
  sanitizeDifficulty,
  sanitizeTags,
  dedupeQuestions,
  isQualityQuestionAnswer,
  computeJaccardSimilarity
} = require('./interviewQuestionQualityService');
const questionRepository = require('../repositories/interviewQuestionRepository');
const aiProvider = require('./providers/interviewAIProvider');
const scraperProvider = require('./providers/interviewScraperProvider');
const { createInterviewEnrichmentOrchestrator } = require('./interviewEnrichmentOrchestrator');

const DEFAULT_PAGE_LIMIT = 20;
const MIN_GENERATE_RESULTS = 10;
const MIN_TOPIC_QUESTION_POOL = 30;

const interviewEngineMetrics = {
  totalRequests: 0,
  cacheHits: 0,
  dbReads: 0,
  enrichmentRuns: 0,
  aiFallbackRuns: 0,
  scrapeFallbackRuns: 0
};

const enrichmentOrchestrator = createInterviewEnrichmentOrchestrator({
  aiProvider,
  scraperProvider,
  questionRepository
});

const sanitizeSkill = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return normalizeTopicInput({ skill: raw }).topicKey;
};

const normalizeQuestions = (questions = []) => {
  const safe = Array.isArray(questions) ? questions : [];
  return safe
    .map((item, idx) => ({
      question: normalizeQuestionText(item.question || item.title || `Interview question ${idx + 1}`),
      answer: normalizeAnswerText(item.answer || item.sampleAnswer || 'Explain the concept and provide one practical implementation example.'),
      difficulty: sanitizeDifficulty(item.difficulty),
      tags: sanitizeTags(item.tags)
    }))
    .filter((item) => item.question && item.answer);
};

const normalizePagination = ({ page = 1, limit = DEFAULT_PAGE_LIMIT }) => {
  const parsedPage = Number.isFinite(Number(page)) ? Number(page) : 1;
  const parsedLimit = Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_PAGE_LIMIT;
  return {
    page: Math.max(1, Math.floor(parsedPage)),
    limit: Math.min(50, Math.max(1, Math.floor(parsedLimit)))
  };
};

const toTagFilter = (tags = '') => {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
      .join(',');
  }
  return String(tags || '').trim().toLowerCase();
};

const makeQuestionsCacheKey = ({ topicKey, page, limit, difficulty = '', tags = '' }) => {
  return `interview:questions:bank=v3:topic=${topicKey}:page=${page}:limit=${limit}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}`;
};

const makeSearchCacheKey = ({ query, topicKey, page, limit, difficulty = '', tags = '', lookupOnly = false }) => {
  return `interview:search:mode=${lookupOnly ? 'lookup' : 'answer'}:q=${encodeURIComponent(String(query || '').trim().toLowerCase())}:topic=${topicKey}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:page=${page}:limit=${limit}`;
};

const makeCustomQuestionCacheKey = ({ question, topicKey }) => (
  `interview:custom:topic=${topicKey}:question=${questionRepository.toQuestionHash(question)}`
);

const metricSnapshot = () => {
  const reads = interviewEngineMetrics.dbReads + interviewEngineMetrics.cacheHits;
  const dbHitRatio = reads > 0 ? Number((interviewEngineMetrics.dbReads / reads).toFixed(3)) : 0;
  const cacheHitRatio = reads > 0 ? Number((interviewEngineMetrics.cacheHits / reads).toFixed(3)) : 0;
  return {
    ...interviewEngineMetrics,
    dbHitRatio,
    cacheHitRatio
  };
};

const formatSourceLabel = ({ prebuiltGeneratedCount = 0, aiGeneratedCount = 0, scrapedGeneratedCount = 0 }) => {
  const labels = ['db'];
  if (prebuiltGeneratedCount > 0) labels.push('prebuilt');
  if (aiGeneratedCount > 0) labels.push('ai');
  if (scrapedGeneratedCount > 0) labels.push('scrape');
  return labels.join('+');
};

const ensurePrebuiltTopicBaseline = async ({ topicKey, minimumCount = MIN_TOPIC_QUESTION_POOL }) => {
  const importantTopic = getImportantTopicByKey(topicKey);
  if (!importantTopic) {
    return { attempted: false, insertedCount: 0 };
  }

  const seedRecords = buildSeedRecordsForTopic(importantTopic);
  const existingTopicSpecificSeedCount = await questionRepository.countQuestionsByTopicAndSeedVersion(
    importantTopic.key,
    SEED_VERSION
  );
  const expectedSeedCount = getTopicSeedItems(importantTopic.key).length;

  if (expectedSeedCount === 0 || existingTopicSpecificSeedCount >= expectedSeedCount) {
    const existingCount = await questionRepository.countQuestionsByTopic(importantTopic.key);
    if (existingCount >= minimumCount) {
      return { attempted: false, insertedCount: 0 };
    }
  }

  if (seedRecords.length === 0) {
    return { attempted: false, insertedCount: 0 };
  }

  const result = await questionRepository.upsertQuestions(seedRecords);
  return {
    attempted: true,
    insertedCount: Number(result.insertedCount || 0)
  };
};

const loadQuestionBankWithEnrichment = async ({
  query = '',
  skill = '',
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  difficulty = '',
  tags = '',
  targetMinimum = MIN_TOPIC_QUESTION_POOL,
  initiatedBy = 'runtime',
  allowEnrichment = true
} = {}) => {
  interviewEngineMetrics.totalRequests += 1;

  const topicInput = normalizeTopicInput({
    skill,
    topic,
    stack,
    technology,
    language,
    framework
  });

  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const normalizedTags = toTagFilter(tags);
  const normalizedQuery = String(query || '').trim();
  const cacheKey = normalizedQuery
    ? makeSearchCacheKey({
      query: normalizedQuery,
      topicKey: topicInput.topicKey,
      page: normalizedPage,
      limit: normalizedLimit,
      difficulty,
      tags: normalizedTags,
      lookupOnly: !allowEnrichment
    })
    : makeQuestionsCacheKey({
      topicKey: topicInput.topicKey,
      page: normalizedPage,
      limit: normalizedLimit,
      difficulty,
      tags: normalizedTags
    });

  const cached = await getCacheJson(cacheKey);
  if (cached) {
    interviewEngineMetrics.cacheHits += 1;
    const cachedIds = Array.isArray(cached.questions)
      ? cached.questions.map((item) => item?._id).filter(Boolean)
      : [];
    if (cachedIds.length) {
      questionRepository.incrementUsageStats(cachedIds).catch(() => {});
    }
    return {
      ...cached,
      fromCache: true,
      metrics: metricSnapshot()
    };
  }

  interviewEngineMetrics.dbReads += 1;

  const filter = questionRepository.buildQuestionFilter({
    topicKey: topicInput.topicKey,
    skill: topicInput.skill,
    difficulty,
    tags: normalizedTags,
    query: normalizedQuery,
    excludeGenericSeeds: !normalizedQuery
  });

  let pageResult = await questionRepository.findQuestionsPage({
    filter,
    page: normalizedPage,
    limit: normalizedLimit,
    includeTextScore: Boolean(normalizedQuery)
  });

  let enrichment = {
    attempted: false,
    aiAdded: 0,
    scrapedAdded: 0,
    insertedCount: 0,
    partial: false
  };
  let prebuiltAdded = 0;

  const requiredForPage = normalizedPage * normalizedLimit;
  const targetPoolSize = Math.max(targetMinimum, requiredForPage);

  if ((!normalizedQuery || allowEnrichment) && pageResult.total < MIN_TOPIC_QUESTION_POOL) {
    const baselineResult = await ensurePrebuiltTopicBaseline({
      topicKey: topicInput.topicKey,
      minimumCount: MIN_TOPIC_QUESTION_POOL
    });

    if (baselineResult.insertedCount > 0) {
      prebuiltAdded = baselineResult.insertedCount;
      await invalidateInterviewPrepCache();
      pageResult = await questionRepository.findQuestionsPage({
        filter,
        page: normalizedPage,
        limit: normalizedLimit,
        includeTextScore: Boolean(normalizedQuery)
      });
    }
  }

  const needsQueryAnswer = Boolean(normalizedQuery) && pageResult.total === 0;
  if (allowEnrichment && (pageResult.total < targetPoolSize || needsQueryAnswer)) {
    interviewEngineMetrics.enrichmentRuns += 1;

    const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(
      topicInput.topicKey,
      Math.max(500, targetPoolSize + 50)
    );

    enrichment = await enrichmentOrchestrator.enrichTopicQuestionPool({
      topic: topicInput,
      query: normalizedQuery,
      existingQuestions: needsQueryAnswer
        ? []
        : existingComparableQuestions.map((normalizedQuestion) => ({ normalizedQuestion })),
      requestedCount: targetPoolSize,
      initiatedBy
    });

    if (enrichment.aiAdded > 0) interviewEngineMetrics.aiFallbackRuns += 1;
    if (enrichment.scrapedAdded > 0) interviewEngineMetrics.scrapeFallbackRuns += 1;

    if (enrichment.insertedCount > 0) {
      await invalidateInterviewPrepCache();
      pageResult = await questionRepository.findQuestionsPage({
        filter,
        page: normalizedPage,
        limit: normalizedLimit,
        includeTextScore: Boolean(normalizedQuery)
      });
    }
  }

  const total = Number(pageResult.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
  const sourceMix = await questionRepository.getSourceMixByTopic(topicInput.topicKey);
  const questions = Array.isArray(pageResult.questions) ? pageResult.questions : [];

  if (questions.length > 0) {
    questionRepository.incrementUsageStats(questions.map((item) => item._id)).catch(() => {});
  }

  const payload = {
    questions,
    total,
    totalAvailable: total,
    page: normalizedPage,
    limit: normalizedLimit,
    totalPages,
    fromCache: false,
    source: formatSourceLabel({
      prebuiltGeneratedCount: prebuiltAdded,
      aiGeneratedCount: enrichment.aiAdded,
      scrapedGeneratedCount: enrichment.scrapedAdded
    }),
    prebuiltGeneratedCount: prebuiltAdded,
    aiGeneratedCount: enrichment.aiAdded,
    scrapedGeneratedCount: enrichment.scrapedAdded,
    enrichedCount: prebuiltAdded + enrichment.aiAdded + enrichment.scrapedAdded,
    sourceMix,
    partial: Boolean(enrichment.partial),
    topicKey: topicInput.topicKey,
    topicType: topicInput.topicType,
    metrics: metricSnapshot()
  };

  await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);

  logger.info('interview-prep query served', {
    topicKey: topicInput.topicKey,
    query: Boolean(normalizedQuery),
    page: normalizedPage,
    limit: normalizedLimit,
    enrichedCount: payload.enrichedCount,
    partial: payload.partial,
    dbHitRatio: payload.metrics.dbHitRatio,
    aiFallbackRuns: payload.metrics.aiFallbackRuns,
    scrapeFallbackRuns: payload.metrics.scrapeFallbackRuns
  });

  return payload;
};

const getQuestionBank = async ({
  skill,
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  difficulty = '',
  tags = ''
} = {}) => {
  return loadQuestionBankWithEnrichment({
    skill,
    topic,
    stack,
    technology,
    language,
    framework,
    page,
    limit,
    difficulty,
    tags,
    initiatedBy: 'questions-endpoint',
    allowEnrichment: true,
    targetMinimum: MIN_TOPIC_QUESTION_POOL
  });
};

const searchQuestionBank = async ({
  q,
  skill = '',
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = '',
  difficulty = '',
  tags = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  allowEnrichment = true
} = {}) => {
  const query = String(q || '').trim();
  if (!query) {
    return {
      questions: [],
      total: 0,
      totalAvailable: 0,
      page: 1,
      limit,
      totalPages: 1,
      fromCache: false,
      source: 'db',
      aiGeneratedCount: 0,
      scrapedGeneratedCount: 0,
      enrichedCount: 0,
      sourceMix: {},
      partial: false,
      metrics: metricSnapshot()
    };
  }

  return loadQuestionBankWithEnrichment({
    query,
    skill,
    topic,
    stack,
    technology,
    language,
    framework,
    page,
    limit,
    difficulty,
    tags,
    initiatedBy: 'search-endpoint',
    allowEnrichment,
    targetMinimum: MIN_TOPIC_QUESTION_POOL
  });
};

const generateQuestionsFromAI = async ({ skill, query = '', difficulty = '', count = MIN_GENERATE_RESULTS }) => {
  const topic = normalizeTopicInput({ skill });
  return aiProvider.generateQuestionsFromAI({
    topicKey: topic.topicKey,
    topicType: topic.topicType,
    query,
    difficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
    count
  });
};

const saveUniqueQuestions = async ({ skill, questions, source = 'ai', popularity = 10 }) => {
  const topic = normalizeTopicInput({ skill });
  const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(topic.topicKey, 500);

  const normalized = normalizeQuestions(questions).filter((item) => isQualityQuestionAnswer({ ...item, topicKey: topic.topicKey }));
  const deduped = dedupeQuestions({ questions: normalized, existingComparableQuestions });

  const sourceType = ['prebuilt', 'ai', 'scraped', 'user_asked'].includes(source) ? source : 'ai';
  const records = deduped.map((item) => enrichmentOrchestrator.toStorableRecord({
    item,
    topic,
    sourceType,
    sourceMeta: { mode: 'saveUniqueQuestions' },
    popularity
  }));

  if (records.length === 0) {
    return [];
  }

  const result = await questionRepository.upsertQuestions(records);
  if (result.insertedCount > 0) {
    await invalidateInterviewPrepCache();
  }

  return records.slice(0, Number(result.insertedCount || 0));
};

const generateHybridInterviewQuestions = async ({
  skill,
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = '',
  query = '',
  difficulty = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT
} = {}) => {
  const normalizedSkill = sanitizeSkill(skill || topic || language || framework || technology || stack);
  if (!normalizedSkill) {
    throw new Error('Skill is required.');
  }

  const payload = query
    ? await searchQuestionBank({
      q: query,
      skill: normalizedSkill,
      topic,
      stack,
      technology,
      language,
      framework,
      difficulty,
      page,
      limit
    })
    : await getQuestionBank({
      skill: normalizedSkill,
      topic,
      stack,
      technology,
      language,
      framework,
      difficulty,
      page,
      limit
    });

  if ((payload.questions || []).length < MIN_GENERATE_RESULTS) {
    const strengthened = await loadQuestionBankWithEnrichment({
      query,
      skill: normalizedSkill,
      topic,
      stack,
      technology,
      language,
      framework,
      difficulty,
      page,
      limit,
      targetMinimum: Math.max(MIN_TOPIC_QUESTION_POOL, MIN_GENERATE_RESULTS, Number(limit || 0)),
      initiatedBy: 'generate-endpoint',
      allowEnrichment: true
    });

    return {
      ...strengthened,
      source: formatSourceLabel({
        aiGeneratedCount: strengthened.aiGeneratedCount,
        scrapedGeneratedCount: strengthened.scrapedGeneratedCount
      })
    };
  }

  return {
    ...payload,
    source: formatSourceLabel({
      aiGeneratedCount: payload.aiGeneratedCount,
      scrapedGeneratedCount: payload.scrapedGeneratedCount
    })
  };
};

const generateFreshInterviewQuestions = async ({
  skill,
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = '',
  query = '',
  difficulty = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT
} = {}) => {
  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const normalizedSkill = sanitizeSkill(topicInput.topicKey);
  if (!normalizedSkill) {
    throw new Error('Skill is required.');
  }

  const normalizedLimit = normalizePagination({ page, limit }).limit;
  try {
    const generated = await generateQuestionsFromAI({
      skill: normalizedSkill,
      query: String(query || '').trim(),
      difficulty,
      count: normalizedLimit
    });
    const saved = await saveUniqueQuestions({
      skill: normalizedSkill,
      questions: generated,
      source: 'ai',
      popularity: 14
    });

    if (saved.length > 0) {
      return {
        questions: saved,
        total: saved.length,
        totalAvailable: saved.length,
        page: 1,
        limit: normalizedLimit,
        totalPages: 1,
        fromCache: false,
        source: 'ai',
        aiGeneratedCount: saved.length,
        scrapedGeneratedCount: 0,
        enrichedCount: saved.length,
        sourceMix: {},
        partial: false,
        topicKey: topicInput.topicKey,
        topicType: topicInput.topicType,
        metrics: metricSnapshot()
      };
    }
  } catch (error) {
    logger.warn('interview-prep explicit generation failed; using saved bank', {
      topicKey: topicInput.topicKey,
      message: error.message
    });
  }

  return generateHybridInterviewQuestions({
    skill: normalizedSkill,
    topic,
    stack,
    technology,
    language,
    framework,
    query,
    difficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
    page,
    limit
  });
};

const answerCustomInterviewQuestion = async ({
  userId,
  question,
  skill = '',
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = ''
} = {}) => {
  const normalizedQuestion = normalizeQuestionText(String(question || '').slice(0, 500));
  if (!normalizedQuestion) {
    throw new Error('Question is required.');
  }

  const topicInput = normalizeTopicInput({
    skill,
    topic,
    stack,
    technology,
    language,
    framework
  });

  const cacheKey = makeCustomQuestionCacheKey({ question: normalizedQuestion, topicKey: topicInput.topicKey });
  const cached = await getCacheJson(cacheKey);
  if (cached) {
    interviewEngineMetrics.cacheHits += 1;
    if (cached._id) {
      questionRepository.incrementQuestionUsage(cached._id).catch(() => {});
    }
    return { ...cached, sourceLabel: `Cache / ${cached.sourceLabel || 'DB'}`, fromCache: true };
  }

  interviewEngineMetrics.dbReads += 1;
  let reusable = await questionRepository.findExactReusableQuestion({
    topicKey: topicInput.topicKey,
    question: normalizedQuestion
  });

  if (!reusable) {
    const semanticCandidates = await questionRepository.findSemanticCandidates({
      topicKey: topicInput.topicKey,
      minConfidence: 0.65
    });
    reusable = semanticCandidates.find((candidate) => (
      computeJaccardSimilarity(normalizedQuestion, candidate.normalizedQuestion || candidate.question) >= 0.7
    )) || null;
  }

  if (reusable) {
    questionRepository.incrementQuestionUsage(reusable._id).catch(() => {});
    const reusedPayload = {
      ...reusable,
      sourceType: 'db',
      sourceLabel: reusable.sourceType === 'prebuilt' ? 'Seed' : 'DB',
      stored: true,
      duplicate: true,
      fromCache: false
    };
    await setCacheJson(cacheKey, reusedPayload, CACHE_TTL_SECONDS);
    return reusedPayload;
  }

  let generated = null;
  let generatedSourceType = 'ai';
  try {
    generated = await aiProvider.answerCustomQuestionFromAI({
      topicKey: topicInput.topicKey,
      topicType: topicInput.topicType,
      question: normalizedQuestion
    });
    interviewEngineMetrics.aiFallbackRuns += 1;
  } catch (error) {
    logger.warn('interview-prep custom AI answer failed', {
      topicKey: topicInput.topicKey,
      message: error.message
    });

    const scraped = await scraperProvider.scrapeQuestionsForTopic({
      topicKey: topicInput.topicKey,
      topicType: topicInput.topicType,
      count: 5
    }).catch(() => []);
    generated = scraped.find((item) => isQualityQuestionAnswer(item)) || null;
    generatedSourceType = 'scraped';
    if (generated) interviewEngineMetrics.scrapeFallbackRuns += 1;
  }

  if (!generated) {
    const error = new Error('A reliable answer could not be generated right now. Please try again.');
    error.statusCode = 503;
    throw error;
  }

  const record = enrichmentOrchestrator.toStorableRecord({
    item: {
      question: normalizedQuestion,
      answer: generated.answer,
      difficulty: generated.difficulty,
      tags: sanitizeTags([...(generated.tags || []), topicInput.topicKey, generatedSourceType])
    },
    topic: topicInput,
    sourceType: generatedSourceType,
    sourceMeta: { userId: String(userId || ''), askedAt: new Date().toISOString(), mode: 'custom-question' },
    popularity: 18
  });

  const approved = isQualityQuestionAnswer({ ...record, topicKey: topicInput.topicKey }) && Number(record.confidenceScore || 0) >= 0.6;
  let stored = false;
  let storedId = null;
  if (approved) {
    const result = await questionRepository.upsertQuestions([record]);
    stored = Number(result.insertedCount || 0) > 0;
    storedId = result.upsertedIds?.[0] || null;
    await invalidateInterviewPrepCache();
  }

  const payload = {
    question: record.question,
    answer: record.answer,
    answerSections: record.answerSections || {},
    difficulty: record.difficulty,
    tags: record.tags,
    topicKey: topicInput.topicKey,
    topicType: topicInput.topicType,
    sourceType: generatedSourceType,
    sourceLabel: generatedSourceType === 'scraped' ? 'Scraped' : 'AI',
    confidenceScore: record.confidenceScore,
    _id: storedId,
    stored,
    duplicate: false,
    fromCache: false
  };

  if (approved) {
    await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
  }
  return payload;
};

const generateInterviewPrep = async ({ userId, careerStack, experienceLevel, skillGaps = [] }) => {
  const prompt = getInterviewPrepPrompt({ careerStack, experienceLevel, skillGaps });
  const fallback = {
    questions: [
      {
        question: 'Describe a time you debugged a complex issue in your codebase.',
        answer: 'Highlight the context, root cause analysis, the final fix, and what you changed to prevent recurrence.',
        difficulty: 'medium',
        tags: ['behavioral']
      },
      {
        question: 'How would you design a scalable API for a high-traffic application?',
        answer: 'Cover API design, caching strategy, database indexing, rate limiting, and observability choices with tradeoffs.',
        difficulty: 'hard',
        tags: ['system-design']
      }
    ]
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  const questions = normalizeQuestions(result.questions);

  const session = await InterviewPrepSession.create({
    userId,
    careerStack,
    experienceLevel,
    skillGaps,
    questions
  });

  return session;
};

const generateInterviewPrepSessionFromBank = async ({ userId, skill, query = '', careerStack = '', experienceLevel = '' }) => {
  const generated = await generateHybridInterviewQuestions({ skill, query, page: 1, limit: DEFAULT_PAGE_LIMIT });

  const session = await InterviewPrepSession.create({
    userId,
    careerStack,
    experienceLevel,
    skillGaps: [skill],
    questions: generated.questions.map((item) => ({
      question: item.question,
      answer: item.answer,
      difficulty: item.difficulty,
      tags: item.tags
    }))
  });

  return {
    ...generated,
    sessionId: session._id
  };
};

const listInterviewPrepHistory = async (userId, limit = 5) => {
  return InterviewPrepSession.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
};

const maintainInterviewQuestionPools = async ({ minimumPerTopic = MIN_TOPIC_QUESTION_POOL } = {}) => {
  let insertedTotal = 0;
  let prebuiltTotal = 0;
  let aiTotal = 0;
  let scrapeTotal = 0;

  const topics = listImportantTopics();

  for (const topic of topics) {
    let count = await questionRepository.countQuestionsByTopic(topic.key);
    if (count >= minimumPerTopic) {
      continue;
    }

    const prebuiltResult = await ensurePrebuiltTopicBaseline({
      topicKey: topic.key,
      minimumCount: minimumPerTopic
    });

    if (prebuiltResult.insertedCount > 0) {
      prebuiltTotal += Number(prebuiltResult.insertedCount || 0);
      insertedTotal += Number(prebuiltResult.insertedCount || 0);
      count = await questionRepository.countQuestionsByTopic(topic.key);
    }

    if (count >= minimumPerTopic) {
      continue;
    }

    const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(topic.key, 600);
    const result = await enrichmentOrchestrator.enrichTopicQuestionPool({
      topic: normalizeTopicInput({ topic: topic.key }),
      query: '',
      existingQuestions: existingComparableQuestions.map((normalizedQuestion) => ({ normalizedQuestion })),
      requestedCount: minimumPerTopic,
      initiatedBy: 'maintenance'
    });

    insertedTotal += Number(result.insertedCount || 0);
    aiTotal += Number(result.aiAdded || 0);
    scrapeTotal += Number(result.scrapedAdded || 0);
  }

  if (insertedTotal > 0) {
    await invalidateInterviewPrepCache();
  }

  logger.info('interview-prep maintenance completed', {
    minimumPerTopic,
    insertedTotal,
    prebuiltTotal,
    aiTotal,
    scrapeTotal
  });

  return {
    minimumPerTopic,
    insertedTotal,
    prebuiltTotal,
    aiTotal,
    scrapeTotal,
    metrics: metricSnapshot()
  };
};

const getInterviewPrepEngineMetrics = () => metricSnapshot();

module.exports = {
  DEFAULT_PAGE_LIMIT,
  MIN_GENERATE_RESULTS,
  MIN_TOPIC_QUESTION_POOL,
  sanitizeSkill,
  normalizeQuestions,
  getQuestionBank,
  searchQuestionBank,
  saveUniqueQuestions,
  generateQuestionsFromAI,
  generateHybridInterviewQuestions,
  generateFreshInterviewQuestions,
  answerCustomInterviewQuestion,
  generateInterviewPrepSessionFromBank,
  generateInterviewPrep,
  listInterviewPrepHistory,
  maintainInterviewQuestionPools,
  getInterviewPrepEngineMetrics,
  invalidateInterviewPrepCache
};
