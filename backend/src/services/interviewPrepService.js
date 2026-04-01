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
  buildSeedRecordsForTopic,
  getImportantTopicByKey
} = require('./interviewQuestionSeedCatalog');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  normalizeComparableText,
  sanitizeDifficulty,
  sanitizeTags,
  dedupeQuestions,
  isQualityQuestionAnswer
} = require('./interviewQuestionQualityService');
const questionRepository = require('../repositories/interviewQuestionRepository');
const aiProvider = require('./providers/interviewAIProvider');
const scraperProvider = require('./providers/interviewScraperProvider');
const { createInterviewEnrichmentOrchestrator } = require('./interviewEnrichmentOrchestrator');

const DEFAULT_PAGE_LIMIT = 20;
const MIN_GENERATE_RESULTS = 10;
const MIN_TOPIC_QUESTION_POOL = 20;

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
  return `interview:questions:topic=${topicKey}:page=${page}:limit=${limit}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}`;
};

const makeSearchCacheKey = ({ query, topicKey, page, limit, difficulty = '', tags = '' }) => {
  return `interview:search:q=${encodeURIComponent(String(query || '').trim().toLowerCase())}:topic=${topicKey}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:page=${page}:limit=${limit}`;
};

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

  const existingCount = await questionRepository.countQuestionsByTopic(importantTopic.key);
  if (existingCount >= minimumCount) {
    return { attempted: false, insertedCount: 0 };
  }

  const seedRecords = buildSeedRecordsForTopic(importantTopic);
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
      tags: normalizedTags
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
    query: normalizedQuery
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

  if (pageResult.total < MIN_TOPIC_QUESTION_POOL) {
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

  if (allowEnrichment && pageResult.total < targetPoolSize) {
    interviewEngineMetrics.enrichmentRuns += 1;

    const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(
      topicInput.topicKey,
      Math.max(500, targetPoolSize + 50)
    );

    enrichment = await enrichmentOrchestrator.enrichTopicQuestionPool({
      topic: topicInput,
      query: normalizedQuery,
      existingQuestions: existingComparableQuestions.map((normalizedQuestion) => ({ normalizedQuestion })),
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
  limit = DEFAULT_PAGE_LIMIT
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
    allowEnrichment: true,
    targetMinimum: MIN_TOPIC_QUESTION_POOL
  });
};

const generateQuestionsFromAI = async ({ skill, query = '', count = MIN_GENERATE_RESULTS }) => {
  const topic = normalizeTopicInput({ skill });
  return aiProvider.generateQuestionsFromAI({
    topicKey: topic.topicKey,
    topicType: topic.topicType,
    query,
    count
  });
};

const saveUniqueQuestions = async ({ skill, questions, source = 'ai', popularity = 10 }) => {
  const topic = normalizeTopicInput({ skill });
  const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(topic.topicKey, 500);

  const normalized = normalizeQuestions(questions).filter((item) => isQualityQuestionAnswer(item));
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
  const normalizedQuestion = normalizeQuestionText(question || '');
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

  const aiResponse = await aiProvider.answerCustomQuestionFromAI({
    topicKey: topicInput.topicKey,
    topicType: topicInput.topicType,
    question: normalizedQuestion
  });

  const record = enrichmentOrchestrator.toStorableRecord({
    item: {
      question: aiResponse.question || normalizedQuestion,
      answer: aiResponse.answer,
      difficulty: aiResponse.difficulty,
      tags: sanitizeTags([...(aiResponse.tags || []), 'ai_generated', 'user_asked'])
    },
    topic: topicInput,
    sourceType: 'user_asked',
    sourceMeta: {
      userId: String(userId || ''),
      askedAt: new Date().toISOString()
    },
    popularity: 18
  });

  const existingComparable = await questionRepository.fetchComparableQuestionsByTopic(topicInput.topicKey, 500);
  const isDuplicate = dedupeQuestions({
    questions: [{ question: record.question, answer: record.answer, difficulty: record.difficulty, tags: record.tags }],
    existingComparableQuestions: existingComparable
  }).length === 0;

  let stored = false;
  if (!isDuplicate && isQualityQuestionAnswer(record)) {
    const result = await questionRepository.upsertQuestions([record]);
    stored = Number(result.insertedCount || 0) > 0;
    if (stored) {
      await invalidateInterviewPrepCache();
    }
  }

  return {
    question: record.question,
    answer: record.answer,
    difficulty: record.difficulty,
    tags: record.tags,
    topicKey: topicInput.topicKey,
    topicType: topicInput.topicType,
    sourceType: 'user_asked',
    stored,
    duplicate: isDuplicate
  };
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
  answerCustomInterviewQuestion,
  generateInterviewPrepSessionFromBank,
  generateInterviewPrep,
  listInterviewPrepHistory,
  maintainInterviewQuestionPools,
  getInterviewPrepEngineMetrics,
  invalidateInterviewPrepCache
};
