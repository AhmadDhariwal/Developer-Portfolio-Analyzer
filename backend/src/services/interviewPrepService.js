const { normalizeFilters, matchesFilters, generationSourcePolicy } = require('./interviewQuestionFilters');
const { generationFlight } = require('./interviewGenerationFlight');
const logger = require('../utils/logger');
const {
  validateGeneratedQuestion,
  hasValidAnswerSchema,
  hasValidSystemDesign,
  isSystemDesignQuestion
} = require('./interviewAIValidation');
const InterviewPrepSession = require('../models/interviewPrepSession');
const interviewSessions = require('./interviewSessionService');
const { hash: hashRequest } = require('./interviewCoordinationService');
const {
  getCacheJson,
  getCacheJsonWithMeta,
  setCacheJson,
  deleteCacheKey,
  invalidateInterviewPrepCache,
  resolveInterviewCacheKey
} = require('./redisCacheService');
const {
  normalizeTopicInput,
  listImportantTopics,
  detectTopicsInText
} = require('./interviewTopicNormalizer');
const {
  SEED_VERSION,
  buildSeedRecordsForTopic,
  getTopicSeedItems,
  getImportantTopicByKey,
  findSeedRecordByQuestion
} = require('./interviewQuestionSeedCatalog');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  normalizeComparableText,
  normalizeQualityScore,
  sanitizeCategory,
  sanitizeDifficulty,
  sanitizeTags,
  dedupeQuestions,
  isQualityQuestionAnswer,
  validateInterviewQuestionQuality,
  computeJaccardSimilarity,
  buildCanonicalQuestionKey
} = require('./interviewQuestionQualityService');
const questionRepository = require('../repositories/interviewQuestionRepository');
const aiProvider = require('./providers/interviewAIProvider');
const scraperProvider = require('./providers/interviewScraperProvider');
const { createInterviewEnrichmentOrchestrator } = require('./interviewEnrichmentOrchestrator');

const DEFAULT_PAGE_LIMIT = 20;
const assertActiveRequest = (signal) => {
  if (signal?.aborted) throw Object.assign(new Error('Request cancelled.'), { statusCode: 499 });
};
const MIN_GENERATE_RESULTS = 5;
const MIN_TOPIC_QUESTION_POOL = 30;
const MIN_APPROVED_CONFIDENCE = 0.72;
const MIN_APPROVED_RELEVANCE = 0.75;
const MIN_STRONG_SEARCH_RELEVANCE = 0.78;

/** Differentiated cache TTLs in seconds. */
const CACHE_TTL_TOP = 12 * 60 * 60; // Verified top-30 changes rarely.
const CACHE_TTL_ALL = 3 * 60 * 60; // The full bank can grow through enrichment.
const CACHE_TTL_SEARCH = 1 * 60 * 60; // Valid search results only.
const CACHE_TTL_CUSTOM = 24 * 60 * 60; // Valid exact Q&A pairs are deterministic.
const CACHE_TTL_DEFAULT = 1 * 60 * 60;

const AI_DEADLINE_MS = 6500;
const withAiDeadline = async (operation, deadlineMs = AI_DEADLINE_MS) => {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(Object.assign(new Error('AI deadline exceeded.'), { reasonCode: 'provider_timeout' })),
          deadlineMs
        );
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const interviewEngineMetrics = {
  totalRequests: 0,
  cacheHits: 0,
  dbReads: 0,
  enrichmentRuns: 0,
  aiFallbackRuns: 0,
  scrapeFallbackRuns: 0,
  /** AiReuse tracks how many requests found existing AI-generated answers instead of generating new ones. */
  aiReuseHits: 0,
  aiNewGenerations: 0
};

const inflightRequests = new Map();

const runSingleFlight = async (key, taskFn) => {
  if (!key) return taskFn();
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }
  const promise = (async () => {
    try {
      return await taskFn();
    } finally {
      inflightRequests.delete(key);
    }
  })();
  inflightRequests.set(key, promise);
  return promise;
};

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const createPipelineTrace = () => {
  const startedAt = nowMs();
  const timings = {
    memoryCacheMs: 0,
    redisMs: 0,
    mongoExactMs: 0,
    similarityMs: 0,
    seedMs: 0,
    aiMs: 0,
    validationMs: 0,
    persistenceMs: 0
  };
  const counts = { memory: 0, redis: 0, mongo: 0, similarity: 0, seed: 0, ai: 0, persistence: 0 };
  return {
    timings,
    counts,
    applyCache(meta) {
      timings.memoryCacheMs += Number(meta?.memoryMs || 0);
      timings.redisMs += Number(meta?.redisMs || 0);
      if (meta?.layer === 'memory') counts.memory += 1;
      if (meta?.layer === 'redis') counts.redis += 1;
    },
    async time(stage, count, operation) {
      const stageStartedAt = nowMs();
      if (count) counts[count] += 1;
      try {
        return await operation();
      } finally {
        timings[stage] += nowMs() - stageStartedAt;
      }
    },
    finish(payload) {
      return {
        ...payload,
        performance: {
          ...Object.fromEntries(
            Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(3))])
          ),
          totalMs: Number((nowMs() - startedAt).toFixed(3)),
          counts: { ...counts }
        }
      };
    }
  };
};

const cacheWithoutTrace = (key, payload, ttl) => {
  const { performance: _performance, metrics: _metrics, ...cacheable } = payload;
  setCacheJson(key, cacheable, ttl).catch(() => {});
};
const buildVerifiedPromptContext = (topicKey, question) =>
  getTopicSeedItems(topicKey)
    .map((item) => ({
      item,
      score: computeJaccardSimilarity(question, item.normalizedQuestion || item.question)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 1)
    .map(
      ({ item }) =>
        `${item.question}: ${item.answerSections?.shortAnswer || String(item.answer || '').slice(0, 320)}`
    )
    .join('\n')
    .slice(0, 600);
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
      ...item,
      question: normalizeQuestionText(item.question || item.title || `Interview question ${idx + 1}`),
      answer: normalizeAnswerText(
        item.answer ||
          item.sampleAnswer ||
          'Explain the concept and provide one practical implementation example.'
      ),
      topicKey: item.topicKey || item.technology || item.skill || '',
      difficulty: sanitizeDifficulty(item.difficulty),
      tags: sanitizeTags(item.tags)
    }))
    .filter((item) => item.question && item.answer);
};

const normalizePagination = ({ page = 1, limit = DEFAULT_PAGE_LIMIT }) => {
  const parsedPage = Number.isFinite(Number(page)) ? Number(page) : 1;
  const parsedLimit = Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_PAGE_LIMIT;
  return {
    page: Math.min(1000, Math.max(1, Math.floor(parsedPage))),
    limit: Math.min(50, Math.max(1, Math.floor(parsedLimit)))
  };
};

const toTagFilter = (tags = '') =>
  [
    ...new Set(
      (Array.isArray(tags) ? tags : String(tags || '').split(','))
        .map((tag) =>
          String(tag || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ]
    .sort()
    .join(',');
const cachePart = (value) =>
  encodeURIComponent(
    String(value || '')
      .trim()
      .toLowerCase()
  );

const makeQuestionsCacheKey = ({
  topicKey,
  page,
  limit,
  difficulty = '',
  tags = '',
  block = 'top',
  category = '',
  source = ''
}) => {
  return `interview:questions:bank=v14:block=${cachePart(block)}:topic=${topicKey}:page=${page}:limit=${limit}:difficulty=${cachePart(difficulty)}:tags=${cachePart(tags)}:category=${cachePart(category)}:source=${cachePart(source)}`;
};

const makeSearchCacheKey = ({
  query,
  topicKey,
  page,
  limit,
  difficulty = '',
  category = '',
  source = '',
  tags = '',
  lookupOnly = false
}) => {
  return `interview:search:filters=v3:v8:mode=${lookupOnly ? 'lookup' : 'answer'}:q=${encodeURIComponent(
    String(query || '')
      .trim()
      .toLowerCase()
  )}:topic=${topicKey}:difficulty=${cachePart(difficulty)}:category=${cachePart(category)}:source=${cachePart(source)}:tags=${cachePart(tags)}:page=${page}:limit=${limit}`;
};

const makeCustomQuestionCacheKey = ({ question, topicKey, userId }) =>
  `interview:custom:v6:topic=${topicKey}:user=${questionRepository.toQuestionHash(String(userId || ''))}:question=${questionRepository.toQuestionHash(question)}`;

const validateRecordForApproval = ({
  record,
  topicInput,
  expectedDifficulty = '',
  minimumScore = MIN_APPROVED_RELEVANCE
} = {}) => {
  const quality = validateInterviewQuestionQuality({
    ...record,
    topicKey: topicInput?.topicKey || record?.topicKey,
    expectedDifficulty,
    minimumScore
  });
  return {
    ...quality,
    isApproved:
      quality.isValid &&
      Number(record?.confidenceScore || 0) >= MIN_APPROVED_CONFIDENCE &&
      isQualityQuestionAnswer({ ...record, topicKey: topicInput?.topicKey || record?.topicKey })
  };
};

const withApprovalFields = ({
  record,
  topicInput,
  expectedDifficulty = '',
  minimumScore = MIN_APPROVED_RELEVANCE
} = {}) => {
  const approval = validateRecordForApproval({ record, topicInput, expectedDifficulty, minimumScore });
  const sourceType = String(record?.sourceType || record?.source || '')
    .trim()
    .toLowerCase();
  const qualityScore = normalizeQualityScore(
    record?.qualityScore || (sourceType === 'verified_seed' ? 90 : 80)
  );
  return {
    ...record,
    category: sanitizeCategory(record?.category || 'core-concepts'),
    qualityScore,
    relevanceScore: approval.relevanceScore,
    qualityState: approval.isApproved ? 'approved' : 'rejected',
    qualityStatus: approval.isApproved ? 'approved' : 'rejected',
    isApproved: approval.isApproved,
    rejectedReason: approval.isApproved ? '' : approval.reasons.join(', ')
  };
};

const INTERVIEW_AI_REASON_CODES = new Set([
  'provider_success',
  'provider_timeout',
  'provider_error',
  'invalid_json',
  'schema_rejected',
  'semantic_rejected',
  'quality_rejected',
  'fallback_found',
  'fallback_missing'
]);
const logInterviewAiReason = (reasonCode) => {
  if (process.env.NODE_ENV === 'production' || !INTERVIEW_AI_REASON_CODES.has(reasonCode)) return;
  logger.info('interview-prep-ai', { reasonCode });
};
const selectVerifiedFallback = ({ topicInput, question }) => {
  const candidate =
    findSeedRecordByQuestion(topicInput.topicKey, question) ||
    getTopicSeedItems(topicInput.topicKey).find(
      (item) =>
        computeJaccardSimilarity(question, item.normalizedQuestion || item.question) >=
        MIN_STRONG_SEARCH_RELEVANCE
    ) ||
    null;
  if (!candidate) return null;
  const approval = validateRecordForApproval({
    record: candidate,
    topicInput,
    minimumScore: MIN_STRONG_SEARCH_RELEVANCE
  });
  if (!approval.isApproved) return null;
  return {
    question: candidate.question,
    answer: candidate.answer,
    answerSections: candidate.answerSections || {},
    difficulty: candidate.difficulty,
    tags: candidate.tags,
    topicKey: topicInput.topicKey,
    topicType: topicInput.topicType,
    sourceType: 'verified_seed',
    sourceLabel: 'Verified Seed',
    confidenceScore: candidate.confidenceScore,
    relevanceScore: candidate.relevanceScore,
    category: candidate.category,
    qualityScore: candidate.qualityScore,
    answerFormat: candidate.answerFormat || 'structured',
    isEnriched: true,
    stored: false,
    duplicate: false,
    fromCache: false
  };
};
const buildAiFailurePayload = ({ reasonCode = 'provider_unavailable' } = {}) => {
  if (reasonCode === 'no_answer')
    return Object.assign(
      new Error('No reliable answer could be produced. Add technical context or rephrase the question.'),
      { statusCode: 422, code: 'no_answer', generationStatus: 'no_answer', retryable: false }
    );
  const invalid = ['schema_rejected', 'semantic_rejected', 'quality_rejected', 'invalid_json'].includes(
    reasonCode
  );
  return Object.assign(
    new Error(
      invalid
        ? 'AI returned an incomplete or invalid answer. Please retry.'
        : 'AI providers are temporarily unavailable. Please retry.'
    ),
    {
      statusCode: 503,
      code: invalid ? 'invalid_ai_answer' : 'ai_unavailable',
      generationStatus: invalid ? 'invalid_response' : 'provider_unavailable',
      retryable: true
    }
  );
};

const toStructuredAnswerText = (sections = {}) =>
  aiProvider.toStructuredAnswerText
    ? aiProvider.toStructuredAnswerText(sections)
    : normalizeAnswerText(
        [
          sections.shortAnswer ? `Short answer: ${sections.shortAnswer}` : '',
          Array.isArray(sections.keyPoints) && sections.keyPoints.length
            ? `Key points:\n${sections.keyPoints.map((point) => `- ${point}`).join('\n')}`
            : '',
          sections.explanation ? `Explanation: ${sections.explanation}` : '',
          sections.example ? `Example:\n${sections.example}` : '',
          sections.realWorldUseCase ? `Real-world use case: ${sections.realWorldUseCase}` : '',
          Array.isArray(sections.commonMistakes) && sections.commonMistakes.length
            ? `Common mistakes:\n${sections.commonMistakes.map((point) => `- ${point}`).join('\n')}`
            : '',
          sections.interviewTip ? `Interview tip: ${sections.interviewTip}` : ''
        ]
          .filter(Boolean)
          .join('\n\n')
      );

const isStructuredQuestion = (item = {}) =>
  item.isEnriched === true &&
  item.answerFormat === 'structured' &&
  item.answerSections &&
  typeof item.answerSections === 'object' &&
  Boolean(item.answerSections.shortAnswer || item.answerSections.summary || item.answerSections.explanation);

const enrichQuestionIfNeeded = async (item = {}) => {
  if (!item?._id || isStructuredQuestion(item)) return item;
  if (['verified_seed', 'prebuilt'].includes(item.sourceType || item.source)) return item;

  const seedRecord = findSeedRecordByQuestion(item.topicKey, item.question);
  if (seedRecord) {
    const updated = await questionRepository.updateQuestionById(item._id, {
      answer: seedRecord.answer,
      answerSections: seedRecord.answerSections,
      answerFormat: 'structured',
      isEnriched: true,
      qualityScore: Math.max(
        normalizeQualityScore(item.qualityScore || 80),
        normalizeQualityScore(seedRecord.qualityScore || 90)
      ),
      category: seedRecord.category || sanitizeCategory(item.category || 'core-concepts'),
      confidenceScore: Math.max(
        Number(item.confidenceScore || 0),
        Number(seedRecord.confidenceScore || 0.95)
      ),
      source: seedRecord.source,
      sourceType: seedRecord.sourceType,
      sourceMeta: {
        ...(item.sourceMeta || {}),
        upgradedFromSeedVersion: SEED_VERSION
      }
    });

    return (
      updated || {
        ...item,
        answer: seedRecord.answer,
        answerSections: seedRecord.answerSections,
        answerFormat: 'structured',
        isEnriched: true,
        qualityScore: Math.max(
          normalizeQualityScore(item.qualityScore || 80),
          normalizeQualityScore(seedRecord.qualityScore || 90)
        ),
        category: seedRecord.category || sanitizeCategory(item.category || 'core-concepts'),
        confidenceScore: Math.max(
          Number(item.confidenceScore || 0),
          Number(seedRecord.confidenceScore || 0.95)
        ),
        source: seedRecord.source,
        sourceType: seedRecord.sourceType
      }
    );
  }

  const enrichedAnswer = await withAiDeadline(() =>
    aiProvider.enrichAnswerToStructured({
      question: item.question,
      topicKey: item.topicKey,
      currentAnswer: item.answer
    })
  );
  const answer = toStructuredAnswerText(enrichedAnswer);
  const candidate = withApprovalFields({
    record: { ...item, answer, answerSections: enrichedAnswer, sourceType: 'ai_generated' },
    topicInput: normalizeTopicInput({ topic: item.topicKey })
  });
  if (!candidate.isApproved) return item;
  const updated = await questionRepository.updateQuestionById(item._id, {
    answer,
    answerSections: enrichedAnswer,
    answerFormat: 'structured',
    isEnriched: true,
    qualityScore: Math.max(80, normalizeQualityScore(item.qualityScore || 80)),
    category: sanitizeCategory(item.category || 'core-concepts'),
    source: 'ai_generated',
    sourceType: 'ai_generated',
    sourceMeta: {
      ...(item.sourceMeta || {}),
      originalSourceType: item.sourceType || item.source,
      verificationStatus: 'unverified',
      mode: 'structured-enrichment'
    },
    version: questionRepository.toQuestionHash(JSON.stringify([item.question, answer, enrichedAnswer]))
  });

  return (
    updated || {
      ...item,
      answer,
      answerSections: enrichedAnswer,
      answerFormat: 'structured',
      isEnriched: true,
      qualityScore: Math.max(80, normalizeQualityScore(item.qualityScore || 80)),
      category: sanitizeCategory(item.category || 'core-concepts')
    }
  );
};

const makeQuestionPayload = ({
  questions = [],
  total = 0,
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  source = 'db',
  topicInput,
  fromCache = false,
  aiGeneratedCount = 0,
  scrapedGeneratedCount = 0,
  enrichedCount = 0,
  sourceMix = {},
  partial = false
}) => {
  const totalPages = Math.max(
    1,
    Math.ceil(Number(total || 0) / Math.max(1, Number(limit || DEFAULT_PAGE_LIMIT)))
  );
  return {
    questions: questions.map((item) => ({
      ...item,
      questionId:
        item.seedId ||
        `${item.topicKey || topicInput?.topicKey}:${questionRepository.toQuestionHash(item.question)}`,
      contentVersion:
        item.version ||
        questionRepository.toQuestionHash(
          JSON.stringify([item.question, item.answer, item.answerSections || {}])
        ),
      verificationStatus:
        ['verified_seed', 'prebuilt'].includes(item.sourceType || item.source) ||
        item.sourceMeta?.verificationStatus === 'verified'
          ? 'verified'
          : 'unverified'
    })),
    total: Number(total || questions.length),
    totalAvailable: Number(total || questions.length),
    page: Number(page || 1),
    limit: Number(limit || DEFAULT_PAGE_LIMIT),
    totalPages,
    fromCache,
    source,
    aiGeneratedCount,
    scrapedGeneratedCount,
    enrichedCount,
    sourceMix,
    partial,
    topicKey: topicInput?.topicKey,
    topicType: topicInput?.topicType,
    metrics: metricSnapshot()
  };
};

const metricSnapshot = () => {
  const reads = interviewEngineMetrics.dbReads + interviewEngineMetrics.cacheHits;
  const dbHitRatio = reads > 0 ? Number((interviewEngineMetrics.dbReads / reads).toFixed(3)) : 0;
  const cacheHitRatio = reads > 0 ? Number((interviewEngineMetrics.cacheHits / reads).toFixed(3)) : 0;
  const aiTotal = interviewEngineMetrics.aiReuseHits + interviewEngineMetrics.aiNewGenerations;
  const aiReuseRate = aiTotal > 0 ? Number((interviewEngineMetrics.aiReuseHits / aiTotal).toFixed(3)) : 0;
  return {
    ...interviewEngineMetrics,
    dbHitRatio,
    cacheHitRatio,
    aiReuseRate
  };
};

const getCachedSourceMix = async (topicKey) => {
  const key = await resolveInterviewCacheKey(`interview:questions:mix:v1:topic=${topicKey}:`, topicKey);
  return runSingleFlight(key, async () => {
    const cached = await getCacheJson(key);
    if (cached) return cached;
    const mix = await questionRepository.getSourceMixByTopic(topicKey);
    await setCacheJson(key, mix, CACHE_TTL_ALL);
    return mix;
  });
};

const formatSourceLabel = ({
  prebuiltGeneratedCount = 0,
  aiGeneratedCount = 0,
  scrapedGeneratedCount = 0
}) => {
  const labels = ['db'];
  if (prebuiltGeneratedCount > 0) labels.push('verified_seed');
  if (aiGeneratedCount > 0) labels.push('ai');
  if (scrapedGeneratedCount > 0) labels.push('scrape');
  return labels.join('+');
};

const ensurePrebuiltTopicBaseline = async ({
  topicKey,
  minimumCount = MIN_TOPIC_QUESTION_POOL,
  forceSync = false
}) => {
  const importantTopic = getImportantTopicByKey(topicKey);
  if (!importantTopic) {
    return { attempted: false, insertedCount: 0 };
  }

  const seedRecords = buildSeedRecordsForTopic(importantTopic)
    .map((record) =>
      withApprovalFields({
        record,
        topicInput: normalizeTopicInput({ topic: importantTopic.key }),
        minimumScore: 0.78
      })
    )
    .filter((record) => record.isApproved);
  const existingTopicSpecificSeedCount = await questionRepository.countQuestionsByTopicAndSeedVersion(
    importantTopic.key,
    SEED_VERSION
  );
  const expectedSeedCount = getTopicSeedItems(importantTopic.key).length;

  if (!forceSync && (expectedSeedCount === 0 || existingTopicSpecificSeedCount >= expectedSeedCount)) {
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
      await invalidateInterviewPrepCache(topicInput.topicKey);
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
      initiatedBy,
      allowScraper: false,
      difficulty: difficulty ? sanitizeDifficulty(difficulty) : ''
    });

    if (enrichment.aiAdded > 0) interviewEngineMetrics.aiFallbackRuns += 1;
    if (enrichment.scrapedAdded > 0) interviewEngineMetrics.scrapeFallbackRuns += 1;

    if (enrichment.insertedCount > 0) {
      await invalidateInterviewPrepCache(topicInput.topicKey);
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
    if (normalizedQuery) {
      questionRepository.incrementUsageStats(questions.map((item) => item._id)).catch(() => {});
    }
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

  await setCacheJson(cacheKey, payload, CACHE_TTL_DEFAULT);

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
  tags = '',
  block = 'top',
  category = '',
  source = ''
} = {}) => {
  ({ difficulty, category, source } = normalizeFilters({
    skill,
    topic,
    stack,
    technology,
    language,
    framework,
    difficulty,
    category,
    source,
    tags
  }));
  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const normalizedTags = toTagFilter(tags);
  const normalizedBlock = String(block || 'top')
    .trim()
    .toLowerCase();
  const cacheKey = await resolveInterviewCacheKey(
    makeQuestionsCacheKey({
      topicKey: topicInput.topicKey,
      page: normalizedPage,
      limit: normalizedLimit,
      difficulty,
      tags: normalizedTags,
      block: normalizedBlock,
      category,
      source
    }),
    topicInput.topicKey
  );

  return runSingleFlight(cacheKey, async () => {
    interviewEngineMetrics.totalRequests += 1;
    const cached = await getCacheJson(cacheKey);
    if (
      cached &&
      Array.isArray(cached.questions) &&
      cached.questions.every((item) =>
        matchesFilters(
          item,
          normalizeFilters({ skill: topicInput.topicKey, difficulty, category, source, tags })
        )
      )
    ) {
      interviewEngineMetrics.cacheHits += 1;
      return { ...cached, fromCache: true, metrics: metricSnapshot() };
    }

    if (cached) await deleteCacheKey(cacheKey);
    interviewEngineMetrics.dbReads += 1;
    if (normalizedBlock === 'all') {
      let unavailable = false;
      let pageResult = await questionRepository
        .findAllQuestionsPage({
          topicKey: topicInput.topicKey,
          page: normalizedPage,
          limit: normalizedLimit,
          difficulty,
          tags: normalizedTags,
          category,
          source
        })
        .catch(() => {
          unavailable = true;
          return { questions: [], total: 0 };
        });
      if (!pageResult.total) {
        const seedTopic = getImportantTopicByKey(topicInput.topicKey);
        const seeds = (seedTopic ? buildSeedRecordsForTopic(seedTopic) : []).filter(
          (item) =>
            (!difficulty || item.difficulty === difficulty) &&
            (!category || item.category === category) &&
            matchesFilters(item, normalizeFilters({ skill: topicInput.topicKey, source })) &&
            (!normalizedTags || normalizedTags.split(',').some((tag) => item.tags?.includes(tag)))
        );
        pageResult = {
          questions: seeds.slice((normalizedPage - 1) * normalizedLimit, normalizedPage * normalizedLimit),
          total: seeds.length
        };
      }

      const questions = (pageResult.questions || []).filter((item) =>
        matchesFilters(
          item,
          normalizeFilters({ skill: topicInput.topicKey, difficulty, category, source, tags })
        )
      );
      const payload = makeQuestionPayload({
        questions,
        total: pageResult.total,
        page: normalizedPage,
        limit: normalizedLimit,
        source: 'db',
        topicInput,
        sourceMix: unavailable ? {} : await getCachedSourceMix(topicInput.topicKey)
      });
      await setCacheJson(cacheKey, payload, unavailable ? 30 : CACHE_TTL_ALL);
      return payload;
    }

    let unavailable = false;
    let rows = await questionRepository
      .findTopQuestions({
        topicKey: topicInput.topicKey,
        limit: Math.min(30, Number(limit || 30)),
        difficulty,
        tags: normalizedTags,
        category,
        source
      })
      .catch(() => {
        unavailable = true;
        return [];
      });

    if (rows.length < 30) {
      const importantTopic = getImportantTopicByKey(topicInput.topicKey);
      const verifiedTopSeeds = importantTopic
        ? buildSeedRecordsForTopic(importantTopic).filter(
            (record) =>
              record.isTopQuestion &&
              (!category || record.category === category) &&
              matchesFilters(record, normalizeFilters({ skill: topicInput.topicKey, source })) &&
              (!difficulty || record.difficulty === difficulty) &&
              (!normalizedTags || normalizedTags.split(',').some((tag) => record.tags?.includes(tag)))
          )
        : [];
      const merged = new Map();
      for (const record of [...verifiedTopSeeds, ...rows]) {
        const key = normalizeComparableText(record.question);
        if (key) merged.set(key, record);
      }
      rows = [...merged.values()]
        .sort((left, right) => Number(left.rank || 999) - Number(right.rank || 999))
        .slice(0, 30);
    }

    const questions = rows
      .filter((item) =>
        matchesFilters(
          item,
          normalizeFilters({ skill: topicInput.topicKey, difficulty, category, source, tags })
        )
      )
      .sort((left, right) => Number(left.rank || 999) - Number(right.rank || 999))
      .slice(0, 30);
    const payload = makeQuestionPayload({
      questions,
      total: questions.length,
      page: 1,
      limit: 30,
      source: 'db',
      topicInput,
      sourceMix: unavailable
        ? { verified_seed: questions.length }
        : await getCachedSourceMix(topicInput.topicKey)
    });
    await setCacheJson(cacheKey, payload, unavailable ? 30 : CACHE_TTL_TOP);
    return payload;
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
  category = '',
  source = '',
  tags = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  allowEnrichment = true
} = {}) => {
  const query = String(q || '').trim();
  if (!query) {
    return getQuestionBank({
      skill,
      topic,
      stack,
      technology,
      language,
      framework,
      difficulty,
      category,
      source,
      tags,
      page,
      limit,
      block: 'all'
    });
  }

  ({ difficulty, category, source } = normalizeFilters({
    skill,
    topic,
    stack,
    technology,
    language,
    framework,
    difficulty,
    category,
    source,
    tags,
    q
  }));
  if (allowEnrichment && (difficulty || category || source || toTagFilter(tags))) {
    return searchQuestionBank({
      q,
      skill,
      topic,
      stack,
      technology,
      language,
      framework,
      difficulty,
      category,
      source,
      tags,
      page,
      limit,
      allowEnrichment: false
    });
  }
  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const identity = questionRepository.buildQuestionIdentity({
    question: query,
    topicKey: topicInput.topicKey
  });
  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const normalizedTags = toTagFilter(tags);
  const normalizedCategory = category ? sanitizeCategory(category) : '';
  const expectedDifficulty = difficulty ? sanitizeDifficulty(difficulty) : '';
  const trace = createPipelineTrace();
  const cacheKey = await trace.time('redisMs', null, () =>
    resolveInterviewCacheKey(
      makeSearchCacheKey({
        query: identity.normalizedQuestion,
        topicKey: topicInput.topicKey,
        page: normalizedPage,
        limit: normalizedLimit,
        difficulty: expectedDifficulty,
        category: normalizedCategory,
        source,
        tags: normalizedTags,
        lookupOnly: !allowEnrichment
      }),
      topicInput.topicKey
    )
  );

  return runSingleFlight(cacheKey, async () => {
    interviewEngineMetrics.totalRequests += 1;
    const cacheResult = await getCacheJsonWithMeta(cacheKey);
    trace.applyCache(cacheResult);
    if (
      cacheResult.value &&
      Array.isArray(cacheResult.value.questions) &&
      cacheResult.value.questions.every((item) =>
        matchesFilters(
          item,
          normalizeFilters({ skill: topicInput.topicKey, difficulty, category, source, tags, query })
        )
      )
    ) {
      interviewEngineMetrics.cacheHits += 1;
      return trace.finish({
        ...cacheResult.value,
        fromCache: true,
        cacheLayer: cacheResult.layer,
        metrics: metricSnapshot()
      });
    }

    if (cacheResult.value) await deleteCacheKey(cacheKey);
    interviewEngineMetrics.dbReads += 1;
    if (!allowEnrichment) {
      const filter = questionRepository.buildQuestionFilter({
        topicKey: topicInput.topicKey,
        difficulty: expectedDifficulty,
        tags: normalizedTags,
        query,
        source,
        excludeGenericSeeds: true
      });
      if (normalizedCategory) filter.category = normalizedCategory;
      let unavailable = false;
      let result = await trace
        .time('mongoExactMs', 'mongo', () =>
          questionRepository.findQuestionsPage({
            filter,
            page: normalizedPage,
            limit: normalizedLimit,
            includeTextScore: true
          })
        )
        .catch(() => {
          unavailable = true;
          return { questions: [], total: 0 };
        });
      if (!result.total) {
        const seedTopic = getImportantTopicByKey(topicInput.topicKey);
        const seeds = (seedTopic ? buildSeedRecordsForTopic(seedTopic) : []).filter(
          (item) =>
            (!expectedDifficulty || item.difficulty === expectedDifficulty) &&
            (!normalizedCategory || item.category === normalizedCategory) &&
            matchesFilters(item, normalizeFilters({ skill: topicInput.topicKey, source })) &&
            (!normalizedTags || normalizedTags.split(',').some((tag) => item.tags?.includes(tag))) &&
            identity.searchableTokens.some((token) =>
              `${item.question} ${item.answer}`.toLowerCase().includes(token)
            )
        );
        result = {
          total: seeds.length,
          questions: seeds.slice((normalizedPage - 1) * normalizedLimit, normalizedPage * normalizedLimit)
        };
      }
      const payload = makeQuestionPayload({
        questions: result.questions,
        total: result.total,
        page: normalizedPage,
        limit: normalizedLimit,
        source: unavailable ? 'seed' : 'db',
        topicInput
      });
      cacheWithoutTrace(cacheKey, payload, unavailable ? 30 : CACHE_TTL_SEARCH);
      return trace.finish(payload);
    }
    let reusable = await trace.time('mongoExactMs', 'mongo', () =>
      questionRepository.findExactReusableQuestion({
        topicKey: topicInput.topicKey,
        question: query,
        identity,
        difficulty: expectedDifficulty,
        category: normalizedCategory,
        minConfidence: 0.75,
        source: 'seed'
      })
    );

    if (reusable && !['verified_seed', 'prebuilt'].includes(reusable.sourceType)) reusable = null;
    if (reusable) {
      const approval = await trace.time('validationMs', null, () =>
        Promise.resolve(
          validateRecordForApproval({
            record: reusable,
            topicInput,
            expectedDifficulty,
            minimumScore: MIN_STRONG_SEARCH_RELEVANCE
          })
        )
      );
      if (!approval.isApproved) reusable = null;
    }

    if (!reusable) {
      const candidates = await trace.time('similarityMs', 'similarity', () =>
        questionRepository.findSearchCandidates({
          topicKey: topicInput.topicKey,
          difficulty: expectedDifficulty,
          category: normalizedCategory,
          tags: normalizedTags,
          searchableTokens: identity.searchableTokens,
          limit: 60,
          minConfidence: 0.75,
          source: 'seed'
        })
      );
      const match = candidates.find(
        (candidate) =>
          computeJaccardSimilarity(query, candidate.normalizedQuestion || candidate.question) >=
          MIN_STRONG_SEARCH_RELEVANCE
      );
      if (match) {
        reusable = await trace.time('similarityMs', null, () =>
          questionRepository.findQuestionById(match._id)
        );
        const approval = reusable
          ? await trace.time('validationMs', null, () =>
              Promise.resolve(
                validateRecordForApproval({
                  record: reusable,
                  topicInput,
                  expectedDifficulty,
                  minimumScore: MIN_STRONG_SEARCH_RELEVANCE
                })
              )
            )
          : { isApproved: false };
        if (!approval.isApproved) reusable = null;
      }
    }

    if (reusable) {
      questionRepository.incrementQuestionUsage(reusable._id).catch(() => {});
      const payload = makeQuestionPayload({
        questions: [reusable],
        total: 1,
        page: 1,
        limit: normalizedLimit,
        source: 'db',
        topicInput
      });
      cacheWithoutTrace(cacheKey, payload, CACHE_TTL_SEARCH);
      return trace.finish(payload);
    }

    const seedMatch = await trace.time('seedMs', 'seed', () =>
      Promise.resolve(
        findSeedRecordByQuestion(topicInput.topicKey, query) ||
          getTopicSeedItems(topicInput.topicKey).find(
            (candidate) =>
              (!expectedDifficulty || sanitizeDifficulty(candidate.difficulty) === expectedDifficulty) &&
              (!normalizedCategory || sanitizeCategory(candidate.category) === normalizedCategory) &&
              computeJaccardSimilarity(query, candidate.normalizedQuestion || candidate.question) >=
                MIN_STRONG_SEARCH_RELEVANCE
          ) ||
          null
      )
    );
    if (seedMatch) {
      const approval = await trace.time('validationMs', null, () =>
        Promise.resolve(
          validateRecordForApproval({
            record: seedMatch,
            topicInput,
            expectedDifficulty,
            minimumScore: MIN_STRONG_SEARCH_RELEVANCE
          })
        )
      );
      if (approval.isApproved) {
        const payload = makeQuestionPayload({
          questions: [seedMatch],
          total: 1,
          page: 1,
          limit: normalizedLimit,
          source: 'seed',
          topicInput
        });
        cacheWithoutTrace(cacheKey, payload, CACHE_TTL_SEARCH);
        return trace.finish(payload);
      }
    }

    if (!allowEnrichment) {
      const payload = makeQuestionPayload({
        questions: [],
        total: 0,
        page: 1,
        limit: normalizedLimit,
        source: 'db',
        topicInput
      });
      cacheWithoutTrace(cacheKey, payload, CACHE_TTL_SEARCH);
      return trace.finish(payload);
    }

    try {
      const generated = await trace.time('aiMs', 'ai', () =>
        withAiDeadline(() =>
          aiProvider.answerSearchFallback({
            skill: topicInput.skill,
            topicKey: topicInput.topicKey,
            question: query,
            verifiedContext: buildVerifiedPromptContext(topicInput.topicKey, query)
          })
        )
      );
      interviewEngineMetrics.aiFallbackRuns += 1;
      const record = enrichmentOrchestrator.toStorableRecord({
        item: {
          ...generated,
          question: query,
          tags: sanitizeTags([...(generated.tags || []), topicInput.topicKey, 'ai_generated']),
          answerFormat: 'structured',
          isEnriched: true
        },
        topic: topicInput,
        sourceType: 'ai_generated',
        sourceMeta: { query, mode: 'search-fallback', generatedAt: new Date().toISOString() },
        popularity: 18
      });
      const approvedRecord = await trace.time('validationMs', null, () =>
        Promise.resolve(
          withApprovalFields({
            record,
            topicInput,
            expectedDifficulty,
            minimumScore: MIN_STRONG_SEARCH_RELEVANCE
          })
        )
      );
      if (!approvedRecord.isApproved || normalizeQualityScore(approvedRecord.qualityScore || 0) < 80) {
        return trace.finish(
          makeQuestionPayload({
            questions: [],
            total: 0,
            page: 1,
            limit: normalizedLimit,
            source: 'db',
            topicInput
          })
        );
      }

      const result = await trace.time('persistenceMs', 'persistence', () =>
        questionRepository.upsertQuestions([approvedRecord])
      );
      const payloadQuestion = {
        ...approvedRecord,
        _id: result.upsertedIds?.[0] || null,
        stored: true,
        sourceLabel: 'AI Generated'
      };
      const payload = makeQuestionPayload({
        questions: [payloadQuestion],
        total: 1,
        page: 1,
        limit: normalizedLimit,
        source: 'ai_generated',
        topicInput,
        aiGeneratedCount: 1,
        enrichedCount: 1
      });
      await invalidateInterviewPrepCache(topicInput.topicKey);
      return trace.finish(payload);
    } catch (error) {
      logger.warn('interview-prep search AI answer failed', {
        topicKey: topicInput.topicKey,
        reason: 'provider_unavailable'
      });
      return trace.finish(
        makeQuestionPayload({
          questions: [],
          total: 0,
          page: 1,
          limit: normalizedLimit,
          source: 'db',
          topicInput
        })
      );
    }
  });
};

const generateQuestionsFromAI = async ({
  skill,
  query = '',
  difficulty = '',
  count = MIN_GENERATE_RESULTS
}) => {
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
  const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(
    topic.topicKey,
    500
  );

  const normalized = normalizeQuestions(questions).filter((item) =>
    isQualityQuestionAnswer({ ...item, topicKey: topic.topicKey })
  );
  const deduped = dedupeQuestions({ questions: normalized, existingComparableQuestions });

  const sourceType = questionRepository.normalizeSourceType(
    ['verified_seed', 'prebuilt', 'ai', 'ai_generated', 'scraped', 'user_asked'].includes(source)
      ? source
      : 'ai_generated'
  );
  const records = deduped
    .map((item) =>
      withApprovalFields({
        record: enrichmentOrchestrator.toStorableRecord({
          item,
          topic,
          sourceType,
          sourceMeta: { mode: 'saveUniqueQuestions' },
          popularity
        }),
        topicInput: topic
      })
    )
    .filter((record) => record.isApproved);

  if (records.length === 0) {
    return [];
  }

  const result = await questionRepository.upsertQuestions(records);
  if (result.insertedCount > 0) {
    await invalidateInterviewPrepCache(topicInput.topicKey);
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

  if (!query && (payload.questions || []).length < MIN_GENERATE_RESULTS) {
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

const generateFreshInterviewQuestions = async (input = {}) => {
  const filters = normalizeFilters(input);
  const topicInput = normalizeTopicInput(input);
  const targetCount = normalizePagination({ limit: input.target || input.limit }).limit;
  const accept = (rows) => rows.filter((item) => matchesFilters(item, filters));
  const policy = generationSourcePolicy(filters.source);
  const permitsAI = policy.generateAI;
  const requestKey = `generate:v2:${JSON.stringify([filters, targetCount, input.reuseAI !== false, input.coverageRunId || ''])}`;
  return generationFlight(
    requestKey,
    async (signal) => {
      assertActiveRequest(signal);
      let questions = [];
      let generatedCount = 0;
      let failureReason = 'insufficient_results';
      if (policy.verified) {
        const bankInput = {
          skill: filters.topicKey,
          difficulty: filters.difficulty,
          category: filters.category,
          tags: filters.tags,
          source: policy.verifiedSource,
          page: 1,
          limit: targetCount,
          block: 'all'
        };
        const bank = filters.query
          ? await searchQuestionBank({ ...bankInput, q: filters.query, allowEnrichment: false })
          : await getQuestionBank(bankInput);
        assertActiveRequest(signal);
        questions = dedupeQuestions({
          questions: (bank.questions || []).filter((item) =>
            matchesFilters(item, { ...filters, source: policy.verifiedSource })
          )
        }).slice(0, targetCount);
        // The shipped curated catalog is also an authoritative source when Mongo
        // contains only a partial seed import. Apply every filter before limiting.
        if (questions.length < targetCount) {
          const seedTopic = getImportantTopicByKey(filters.topicKey);
          const seeds = (seedTopic ? buildSeedRecordsForTopic(seedTopic) : []).filter((item) =>
            matchesFilters(item, { ...filters, source: policy.verifiedSource })
          );
          questions = dedupeQuestions({ questions: [...questions, ...seeds] }).slice(0, targetCount);
        }
      }
      if (permitsAI && input.reuseAI !== false && questions.length < targetCount) {
        const reusable = await questionRepository.findAiGeneratedByTopic({
          topicKey: filters.topicKey,
          topic: filters.query,
          difficulty: filters.difficulty,
          category: filters.category,
          tags: filters.tags,
          source: ['ai', 'ai_generated'].includes(filters.source) ? filters.source : 'ai',
          limit: targetCount
        });
        questions = dedupeQuestions({
          questions: [
            ...questions,
            ...accept(reusable.filter((item) => validateGeneratedQuestion(item, filters)))
          ]
        }).slice(0, targetCount);
      }
      assertActiveRequest(signal);
      if (permitsAI && questions.length < targetCount) {
        try {
          const comparable = await questionRepository.fetchComparableQuestionsByTopic(filters.topicKey, 600);
          assertActiveRequest(signal);
          const generated = await withAiDeadline(
            () =>
              aiProvider.generateStructuredQuestionSet({
                skill: filters.topicKey,
                topic: filters.query,
                difficulty: filters.difficulty,
                category: filters.category,
                tags: filters.tags,
                count: targetCount - questions.length,
                signal,
                excludeQuestions: questions.map((item) => item.question).concat(comparable.slice(0, 50))
              }),
            (aiProvider.generationTimeoutMs?.() || 30000) + 500
          );
          assertActiveRequest(signal);
          const valid = (Array.isArray(generated) ? generated : []).filter(
            (item) =>
              validateGeneratedQuestion(item, filters) &&
              matchesFilters({ ...item, sourceType: 'ai_generated' }, filters)
          );
          const unique = dedupeQuestions({
            questions: valid,
            existingComparableQuestions: [
              ...comparable,
              ...questions.map((item) => normalizeComparableText(item.question))
            ]
          }).slice(0, targetCount - questions.length);
          const records = unique
            .map((item) =>
              withApprovalFields({
                record: enrichmentOrchestrator.toStorableRecord({
                  item: { ...item, answerFormat: 'structured', isEnriched: true },
                  topic: topicInput,
                  sourceType: 'ai_generated',
                  sourceMeta: {
                    mode: 'practice-set',
                    topic: filters.query,
                    query: filters.query,
                    expectedDifficulty: filters.difficulty,
                    verificationStatus: 'unverified',
                    generatedAt: item.generationMeta?.generatedAt || new Date().toISOString(),
                    provider: item.generationMeta?.provider,
                    model: item.generationMeta?.model,
                    ...(input.coverageRunId ? { coverageRunId: input.coverageRunId } : {})
                  }
                }),
                topicInput,
                expectedDifficulty: filters.difficulty
              })
            )
            .filter((item) => item.isApproved);
          assertActiveRequest(signal);
          if (records.length) {
            await questionRepository.upsertQuestions(records);
            await invalidateInterviewPrepCache(filters.topicKey);
            generatedCount = records.length;
            questions = dedupeQuestions({ questions: [...questions, ...records] }).slice(0, targetCount);
          }
          failureReason = 'invalid_or_insufficient_ai_results';
        } catch (error) {
          assertActiveRequest(signal);
          failureReason = error.reasonCode || 'provider_unavailable';
          logger.warn('interview-prep generation unavailable', {
            topicKey: filters.topicKey,
            reasonCode: failureReason
          });
        }
      }
      assertActiveRequest(signal);
      if (questions.length !== targetCount) {
        const invalid = ['schema_rejected', 'invalid_json', 'invalid_or_insufficient_ai_results'].includes(
          failureReason
        );
        const unavailable = permitsAI && !invalid;
        throw Object.assign(
          new Error(
            `Insufficient matching questions: ${questions.length} of ${targetCount} available. ${unavailable ? 'AI providers are temporarily unavailable. Retry generation.' : invalid ? 'AI returned invalid or duplicate questions and could not complete this set. Retry generation.' : 'This source excludes AI fallback. Adjust the filters or choose all sources.'}`
          ),
          {
            statusCode: 503,
            code: unavailable ? 'ai_unavailable' : invalid ? 'invalid_ai_response' : 'insufficient_results',
            generationStatus: unavailable
              ? 'provider_unavailable'
              : invalid
                ? 'invalid_response'
                : 'insufficient_results',
            retryable: permitsAI,
            reasonCode: failureReason,
            requestedCount: targetCount,
            availableCount: questions.length
          }
        );
      }
      const sourceMix = questions.reduce((counts, item) => {
        const source = item.sourceType || item.source;
        counts[source] = (counts[source] || 0) + 1;
        return counts;
      }, {});
      return makeQuestionPayload({
        questions,
        total: targetCount,
        limit: targetCount,
        topicInput,
        source: generatedCount ? 'ai_generated' : 'db',
        aiGeneratedCount: generatedCount,
        sourceMix
      });
    },
    input.signal
  );
};

const answerCustomInterviewQuestion = async ({
  userId,
  signal,
  question,
  skill = '',
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = ''
} = {}) => {
  const normalizedQuestion = normalizeQuestionText(String(question || ''));
  if (!normalizedQuestion || normalizedQuestion.length < 12 || normalizedQuestion.length > 500) {
    const error = new Error('Question must be between 12 and 500 characters long.');
    error.statusCode = 400;
    throw error;
  }

  if (!userId) throw Object.assign(new Error('Authentication required.'), { statusCode: 401 });

  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const detectedTopics = detectTopicsInText(normalizedQuestion);
  if (detectedTopics.length > 0 && !detectedTopics.some((item) => item.topicKey === topicInput.topicKey)) {
    const error = new Error(
      `This question does not match the selected skill. It looks closer to ${detectedTopics[0].topicLabel}.`
    );
    error.statusCode = 400;
    throw error;
  }

  const identity = questionRepository.buildQuestionIdentity({
    question: normalizedQuestion,
    topicKey: topicInput.topicKey
  });
  const trace = createPipelineTrace();
  const cacheKey = await trace.time('redisMs', null, () =>
    resolveInterviewCacheKey(
      makeCustomQuestionCacheKey({
        question: identity.normalizedQuestion,
        topicKey: topicInput.topicKey,
        userId
      }),
      topicInput.topicKey
    )
  );
  return generationFlight(
    cacheKey,
    async (signal) => {
      assertActiveRequest(signal);
      const cacheResult = await getCacheJsonWithMeta(cacheKey);
      trace.applyCache(cacheResult);
      if (cacheResult.value) {
        interviewEngineMetrics.cacheHits += 1;
        if (cacheResult.value._id)
          questionRepository.incrementQuestionUsage(cacheResult.value._id).catch(() => {});
        return trace.finish({
          ...cacheResult.value,
          sourceLabel: `Cache / ${cacheResult.value.sourceLabel || 'DB'}`,
          fromCache: true,
          cacheLayer: cacheResult.layer
        });
      }

      interviewEngineMetrics.dbReads += 1;
      let reusable = await trace.time('mongoExactMs', 'mongo', () =>
        questionRepository.findExactReusableQuestion({
          topicKey: topicInput.topicKey,
          question: normalizedQuestion,
          identity,
          minConfidence: 0.75,
          source: 'seed'
        })
      );
      if (reusable && !['verified_seed', 'prebuilt'].includes(reusable.sourceType)) reusable = null;
      if (reusable) {
        const approval = await trace.time('validationMs', null, () =>
          Promise.resolve(
            validateRecordForApproval({
              record: reusable,
              topicInput,
              minimumScore: MIN_STRONG_SEARCH_RELEVANCE
            })
          )
        );
        if (!approval.isApproved) reusable = null;
      }

      if (!reusable) {
        const candidates = await trace.time('similarityMs', 'similarity', () =>
          questionRepository.findSearchCandidates({
            topicKey: topicInput.topicKey,
            searchableTokens: identity.searchableTokens,
            limit: 60,
            minConfidence: 0.75,
            source: 'seed'
          })
        );
        const match = candidates.find(
          (candidate) =>
            computeJaccardSimilarity(
              normalizedQuestion,
              candidate.normalizedQuestion || candidate.question
            ) >= MIN_STRONG_SEARCH_RELEVANCE
        );
        if (match) {
          reusable = await trace.time('similarityMs', null, () =>
            questionRepository.findQuestionById(match._id)
          );
          const approval = reusable
            ? await trace.time('validationMs', null, () =>
                Promise.resolve(
                  validateRecordForApproval({
                    record: reusable,
                    topicInput,
                    minimumScore: MIN_STRONG_SEARCH_RELEVANCE
                  })
                )
              )
            : { isApproved: false };
          if (!approval.isApproved) reusable = null;
        }
      }

      if (reusable) {
        questionRepository.incrementQuestionUsage(reusable._id).catch(() => {});
        const payload = {
          ...reusable,
          sourceType: 'db',
          originalSourceType: reusable.sourceType,
          verificationStatus: ['verified_seed', 'prebuilt'].includes(reusable.sourceType)
            ? 'verified'
            : 'unverified',
          sourceLabel: ['verified_seed', 'prebuilt'].includes(reusable.sourceType) ? 'Verified Seed' : 'DB',
          stored: true,
          duplicate: true,
          fromCache: false
        };
        cacheWithoutTrace(cacheKey, payload, CACHE_TTL_CUSTOM);
        return trace.finish(payload);
      }

      const seedMatch = await trace.time('seedMs', 'seed', () =>
        Promise.resolve(
          findSeedRecordByQuestion(topicInput.topicKey, normalizedQuestion) ||
            getTopicSeedItems(topicInput.topicKey).find(
              (candidate) =>
                computeJaccardSimilarity(
                  normalizedQuestion,
                  candidate.normalizedQuestion || candidate.question
                ) >= MIN_STRONG_SEARCH_RELEVANCE
            ) ||
            null
        )
      );
      if (seedMatch) {
        const approval = await trace.time('validationMs', null, () =>
          Promise.resolve(
            validateRecordForApproval({
              record: seedMatch,
              topicInput,
              minimumScore: MIN_STRONG_SEARCH_RELEVANCE
            })
          )
        );
        if (approval.isApproved) {
          const payload = {
            question: seedMatch.question,
            answer: seedMatch.answer,
            answerSections: seedMatch.answerSections || {},
            difficulty: seedMatch.difficulty,
            tags: seedMatch.tags,
            topicKey: topicInput.topicKey,
            topicType: topicInput.topicType,
            sourceType: 'verified_seed',
            sourceLabel: 'Verified Seed',
            verificationStatus: 'verified',
            confidenceScore: seedMatch.confidenceScore,
            relevanceScore: seedMatch.relevanceScore,
            category: seedMatch.category,
            qualityScore: seedMatch.qualityScore,
            answerFormat: seedMatch.answerFormat || 'structured',
            isEnriched: true,
            stored: false,
            duplicate: false,
            fromCache: false
          };
          cacheWithoutTrace(cacheKey, payload, CACHE_TTL_CUSTOM);
          return trace.finish(payload);
        }
      }

      const prior = await InterviewPrepSession.findOne({
        userId,
        kind: 'custom',
        topicKey: topicInput.topicKey,
        'questions.normalizedQuestionHash': identity.normalizedQuestionHash
      })
        .sort({ createdAt: -1, _id: -1 })
        .lean()
        .catch(() => null);
      const ownedAnswer = prior?.questions?.find(
        (item) => item.normalizedQuestionHash === identity.normalizedQuestionHash
      );
      if (
        ownedAnswer &&
        validateRecordForApproval({
          record: { ...ownedAnswer, topicKey: topicInput.topicKey },
          topicInput,
          minimumScore: MIN_STRONG_SEARCH_RELEVANCE
        }).isApproved
      ) {
        const payload = {
          ...ownedAnswer,
          topicKey: topicInput.topicKey,
          topicType: topicInput.topicType,
          sourceLabel: 'AI-generated answer · Unverified',
          generationStatus: 'reused',
          verificationStatus: 'unverified',
          stored: true,
          duplicate: true,
          fromCache: false,
          sessionId: prior._id
        };
        cacheWithoutTrace(cacheKey, payload, CACHE_TTL_CUSTOM);
        return trace.finish(payload);
      }

      let generated;
      try {
        generated = await trace.time('aiMs', 'ai', () =>
          withAiDeadline(
            () =>
              aiProvider.answerSearchFallback({
                skill: topicInput.skill,
                topicKey: topicInput.topicKey,
                question: normalizedQuestion,
                userId,
                signal,
                verifiedContext: buildVerifiedPromptContext(topicInput.topicKey, normalizedQuestion)
              }),
            aiProvider.customAnswerTimeoutMs(topicInput.topicKey, normalizedQuestion) + 300
          )
        );
        interviewEngineMetrics.aiFallbackRuns += 1;
        logInterviewAiReason('provider_success');
      } catch (error) {
        assertActiveRequest(signal);
        logInterviewAiReason(
          INTERVIEW_AI_REASON_CODES.has(error?.reasonCode) ? error.reasonCode : 'provider_error'
        );
        throw buildAiFailurePayload({ reasonCode: error.reasonCode });
      }

      if (
        !hasValidAnswerSchema(generated) ||
        (isSystemDesignQuestion(normalizedQuestion, topicInput.topicKey) &&
          !hasValidSystemDesign(generated.answerSections))
      ) {
        throw buildAiFailurePayload({ reasonCode: 'schema_rejected' });
      }

      const record = enrichmentOrchestrator.toStorableRecord({
        item: {
          question: normalizedQuestion,
          answer: generated.answer,
          answerSections: generated.answerSections,
          category: generated.category,
          qualityScore: generated.qualityScore,
          answerFormat: 'structured',
          isEnriched: true,
          difficulty: generated.difficulty,
          tags: sanitizeTags([...(generated.tags || []), topicInput.topicKey, 'user_asked'])
        },
        topic: topicInput,
        sourceType: 'ai_generated',
        sourceMeta: {
          mode: 'custom-question',
          verificationStatus: 'unverified',
          generatedAt: generated.generationMeta?.generatedAt || new Date().toISOString(),
          provider: generated.generationMeta?.provider,
          model: generated.generationMeta?.model
        },
        popularity: 18
      });
      const approvedRecord = await trace.time('validationMs', null, () =>
        Promise.resolve(
          withApprovalFields({
            record,
            topicInput,
            expectedDifficulty: generated.difficulty || '',
            minimumScore: MIN_STRONG_SEARCH_RELEVANCE
          })
        )
      );
      if (!approvedRecord.isApproved) {
        const semanticReasons =
          /topic|concept|comparison|contradiction|generic|placeholder|directly_address/.test(
            approvedRecord.rejectedReason || ''
          );
        logInterviewAiReason(semanticReasons ? 'semantic_rejected' : 'quality_rejected');
        throw buildAiFailurePayload({
          reasonCode: semanticReasons ? 'semantic_rejected' : 'quality_rejected'
        });
      }

      assertActiveRequest(signal);
      const session = await trace.time('persistenceMs', 'persistence', () =>
        interviewSessions.create({
          userId,
          careerStack: '',
          experienceLevel: '',
          kind: 'custom',
          // A rejected legacy answer must not make a newly validated answer point
          // at the old immutable snapshot through the unique request-key index.
          requestKey: `custom:${topicInput.topicKey}:${identity.normalizedQuestionHash}:${hashRequest(JSON.stringify([approvedRecord.answer, approvedRecord.answerSections]))}`,
          topicKey: topicInput.topicKey,
          questions: interviewSessions.snapshotQuestions(
            [
              {
                ...approvedRecord,
                normalizedQuestionHash: identity.normalizedQuestionHash,
                verificationStatus: 'unverified'
              }
            ],
            topicInput.topicKey
          )
        })
      );
      const payload = {
        question: approvedRecord.question,
        answer: approvedRecord.answer,
        answerSections: approvedRecord.answerSections || {},
        sourceMeta: approvedRecord.sourceMeta,
        difficulty: approvedRecord.difficulty,
        tags: approvedRecord.tags,
        topicKey: topicInput.topicKey,
        topicType: topicInput.topicType,
        sourceType: 'ai_generated',
        sourceLabel: 'AI-generated answer · Unverified',
        generationStatus: 'generated',
        generatedAt: approvedRecord.sourceMeta.generatedAt,
        confidenceScore: approvedRecord.confidenceScore,
        relevanceScore: approvedRecord.relevanceScore,
        category: approvedRecord.category,
        qualityScore: approvedRecord.qualityScore,
        answerFormat: approvedRecord.answerFormat,
        isEnriched: approvedRecord.isEnriched,
        _id: null,
        sessionId: session._id,
        stored: true,
        verificationStatus: 'unverified',
        duplicate: false,
        fromCache: false
      };
      cacheWithoutTrace(cacheKey, payload, CACHE_TTL_CUSTOM);
      return trace.finish(payload);
    },
    signal
  );
};

const generateInterviewPrep = async ({ userId, careerStack, experienceLevel, skillGaps = [] }) => {
  // Preserve the legacy service entry point while using the same governed,
  // validated snapshot path as the HTTP endpoint.
  const stack = String(careerStack || '').toLowerCase();
  const skill =
    sanitizeSkill(skillGaps[0]) ||
    (stack.includes('frontend') ? 'react' : stack.includes('backend') ? 'nodejs' : 'mern');
  const generated = await generateInterviewPrepSessionFromBank({
    userId,
    skill,
    careerStack,
    experienceLevel,
    skillGaps
  });
  return InterviewPrepSession.findOne({ _id: generated.sessionId, userId });
};

const generateInterviewPrepSessionFromBank = async ({
  userId,
  skill,
  query = '',
  difficulty = '',
  category = '',
  tags = '',
  source = '',
  limit = DEFAULT_PAGE_LIMIT,
  careerStack = '',
  experienceLevel = '',
  skillGaps = [],
  personalization = {},
  signal,
  idempotencyKey = ''
}) => {
  const filters = normalizeFilters({ skill, query, difficulty, category, tags, source });
  skill = filters.topicKey;
  const requestKey = idempotencyKey ? `practice:${idempotencyKey}` : undefined;
  const requestFingerprint = hashRequest(
    JSON.stringify([filters, limit, careerStack, experienceLevel, skillGaps])
  );
  const prior = await interviewSessions.findRequest(userId, requestKey, requestFingerprint);
  if (
    prior &&
    (prior.questions.length !== normalizePagination({ limit }).limit ||
      prior.questions.some((item) => !matchesFilters(item, filters)))
  )
    throw Object.assign(
      new Error(
        'Saved request snapshot does not match these filters. Use a new request key or reopen the original session.'
      ),
      { statusCode: 409, code: 'stored_request_mismatch' }
    );
  if (prior)
    return {
      questions: prior.questions,
      total: prior.questions.length,
      page: 1,
      limit: prior.questions.length,
      totalPages: 1,
      personalization: prior.personalization,
      session: prior,
      sessionId: prior._id
    };
  const generated = await generateFreshInterviewQuestions({
    skill,
    query,
    difficulty,
    category,
    tags,
    source,
    page: 1,
    limit
  });

  assertActiveRequest(signal);
  const session = await interviewSessions.create({
    userId,
    requestKey,
    requestFingerprint,
    careerStack,
    experienceLevel,
    skillGaps,
    topicKey: skill,
    personalization,
    questions: interviewSessions.snapshotQuestions(generated.questions, skill)
  });

  return {
    ...generated,
    questions: session.questions,
    session,
    personalization,
    sessionId: session._id
  };
};

const listInterviewPrepHistory = async (userId, limit = 5) => {
  const boundedLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 5)));
  return InterviewPrepSession.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(boundedLimit).lean();
};

const deleteInterviewPrepSession = async (userId, id) => {
  const session = await interviewSessions.getOwned(userId, id);
  // Evict the exact owner's custom cache before deleting its retained snapshot.
  if (session.kind === 'custom') {
    for (const question of session.questions) {
      const key = await resolveInterviewCacheKey(
        makeCustomQuestionCacheKey({
          userId,
          topicKey: session.topicKey,
          question: question.question
        }),
        session.topicKey
      );
      await deleteCacheKey(key);
    }
  }
  await InterviewPrepSession.deleteOne({ _id: id, userId });
  return { deleted: true };
};

const maintainInterviewQuestionPools = async ({
  minimumPerTopic = MIN_TOPIC_QUESTION_POOL,
  shouldContinue = () => true,
  allowAI = false
} = {}) => {
  minimumPerTopic = Math.min(100, Math.max(30, Number(minimumPerTopic) || MIN_TOPIC_QUESTION_POOL));
  let insertedTotal = 0;
  let prebuiltTotal = 0;
  let aiTotal = 0;
  let scrapeTotal = 0;

  const topics = listImportantTopics();

  for (const topic of topics) {
    if (!shouldContinue()) break;
    let count = await questionRepository.countQuestionsByTopic(topic.key);
    if (count >= minimumPerTopic) {
      continue;
    }

    const prebuiltResult = await ensurePrebuiltTopicBaseline({
      topicKey: topic.key,
      minimumCount: minimumPerTopic
    });

    if (prebuiltResult.insertedCount > 0) {
      await invalidateInterviewPrepCache(topic.key);
      prebuiltTotal += Number(prebuiltResult.insertedCount || 0);
      insertedTotal += Number(prebuiltResult.insertedCount || 0);
      count = await questionRepository.countQuestionsByTopic(topic.key);
    }

    if (count >= minimumPerTopic || !allowAI) {
      continue;
    }

    const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(
      topic.key,
      600
    );
    const result = await enrichmentOrchestrator.enrichTopicQuestionPool({
      topic: normalizeTopicInput({ topic: topic.key }),
      query: '',
      existingQuestions: existingComparableQuestions.map((normalizedQuestion) => ({ normalizedQuestion })),
      requestedCount: minimumPerTopic,
      initiatedBy: 'maintenance',
      allowScraper: false
    });

    await invalidateInterviewPrepCache(topic.key);
    insertedTotal += Number(result.insertedCount || 0);
    aiTotal += Number(result.aiAdded || 0);
    scrapeTotal += Number(result.scrapedAdded || 0);
  }

  if (shouldContinue() && allowAI) {
    const legacy = await questionRepository.findNeedsEnrichment({ limit: 5 });
    for (const item of legacy) {
      if (!shouldContinue()) break;
      try {
        await enrichQuestionIfNeeded(item.toObject ? item.toObject() : item);
        await invalidateInterviewPrepCache(item.topicKey);
      } catch (error) {
        logger.warn('interview-prep scheduled answer enrichment failed', {
          id: item._id,
          message: error.message
        });
      }
    }
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
  deleteInterviewPrepSession,
  maintainInterviewQuestionPools: (options = {}) =>
    require('./interviewJobService').runInterviewJob(({ shouldContinue }) =>
      maintainInterviewQuestionPools({ ...options, shouldContinue })
    ),
  getInterviewPrepEngineMetrics,
  selectVerifiedFallback,
  buildAiFailurePayload,
  invalidateInterviewPrepCache
};
