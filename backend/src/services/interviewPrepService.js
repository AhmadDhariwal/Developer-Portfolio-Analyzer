const aiService = require('./aiservice');
const logger = require('../utils/logger');
const InterviewPrepSession = require('../models/interviewPrepSession');
const { getInterviewPrepPrompt } = require('../prompts/interviewPrepPrompt');
const {
  getCacheJson,
  getCacheJsonWithMeta,
  setCacheJson,
  setMemoryCacheJson,
  invalidateInterviewPrepCache
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
  findSeedRecordByQuestion,
  findSeedRecordByCanonicalKey
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
const MIN_GENERATE_RESULTS = 5;
const MIN_TOPIC_QUESTION_POOL = 30;
const MIN_APPROVED_CONFIDENCE = 0.72;
const MIN_APPROVED_RELEVANCE = 0.75;
const MIN_STRONG_SEARCH_RELEVANCE = 0.78;

/** Differentiated cache TTLs in seconds. */
const CACHE_TTL_TOP = 12 * 60 * 60;       // Verified top-30 changes rarely.
const CACHE_TTL_ALL = 3 * 60 * 60;         // The full bank can grow through enrichment.
const CACHE_TTL_SEARCH = 1 * 60 * 60;      // Valid search results only.
const CACHE_TTL_CUSTOM = 24 * 60 * 60;    // Valid exact Q&A pairs are deterministic.
const CACHE_TTL_DEFAULT = 1 * 60 * 60;

const LOW_CONFIDENCE_FLAG_THRESHOLD = 0.6;
const AI_DEADLINE_MS = 6500;
const withAiDeadline = async (operation) => {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('AI deadline exceeded.')), AI_DEADLINE_MS);
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
      try { return await operation(); }
      finally { timings[stage] += nowMs() - stageStartedAt; }
    },
    finish(payload) {
      return {
        ...payload,
        performance: {
          ...Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(3))])),
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
const cacheAfterInvalidation = (key, payload, ttl) => {
  const { performance: _performance, metrics: _metrics, ...cacheable } = payload;
  const invalidation = invalidateInterviewPrepCache();
  // invalidateInterviewPrepCache synchronously clears process memory before its
  // first remote await; repopulate this exact key immediately, then repopulate
  // Redis only after remote invalidation completes to avoid a delete/set race.
  setMemoryCacheJson(key, cacheable, ttl);
  invalidation.then(() => setCacheJson(key, cacheable, ttl)).catch(() => {});
};
const buildVerifiedPromptContext = (topicKey, question) => getTopicSeedItems(topicKey)
  .map((item) => ({ item, score: computeJaccardSimilarity(question, item.normalizedQuestion || item.question) }))
  .filter(({ score }) => score > 0)
  .sort((left, right) => right.score - left.score)
  .slice(0, 1)
  .map(({ item }) => `${item.question}: ${item.answerSections?.shortAnswer || String(item.answer || '').slice(0, 320)}`)
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

const makeQuestionsCacheKey = ({ topicKey, page, limit, difficulty = '', tags = '', block = 'top', category = '', source = '' }) => {
  return `interview:questions:bank=v11:block=${block}:topic=${topicKey}:page=${page}:limit=${limit}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:category=${String(category || '').toLowerCase()}:source=${String(source || '').toLowerCase()}`;
};

const makeSearchCacheKey = ({ query, topicKey, page, limit, difficulty = '', category = '', tags = '', lookupOnly = false }) => {
  return `interview:search:v6:mode=${lookupOnly ? 'lookup' : 'answer'}:q=${encodeURIComponent(String(query || '').trim().toLowerCase())}:topic=${topicKey}:difficulty=${String(difficulty || '').toLowerCase()}:category=${String(category || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:page=${page}:limit=${limit}`;
};

const makeCustomQuestionCacheKey = ({ question, topicKey }) => (
  `interview:custom:v4:topic=${topicKey}:question=${questionRepository.toQuestionHash(question)}`
);

const validateRecordForApproval = ({ record, topicInput, expectedDifficulty = '', minimumScore = MIN_APPROVED_RELEVANCE } = {}) => {
  const quality = validateInterviewQuestionQuality({
    ...record,
    topicKey: topicInput?.topicKey || record?.topicKey,
    expectedDifficulty,
    minimumScore
  });
  return {
    ...quality,
    isApproved: quality.isValid
      && Number(record?.confidenceScore || 0) >= MIN_APPROVED_CONFIDENCE
      && isQualityQuestionAnswer({ ...record, topicKey: topicInput?.topicKey || record?.topicKey })
  };
};

const withApprovalFields = ({ record, topicInput, expectedDifficulty = '', minimumScore = MIN_APPROVED_RELEVANCE } = {}) => {
  const approval = validateRecordForApproval({ record, topicInput, expectedDifficulty, minimumScore });
  const sourceType = String(record?.sourceType || record?.source || '').trim().toLowerCase();
  const qualityScore = normalizeQualityScore(record?.qualityScore || (sourceType === 'verified_seed' ? 90 : 80));
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
  'provider_success', 'provider_timeout', 'provider_error', 'invalid_json', 'schema_rejected',
  'semantic_rejected', 'quality_rejected', 'fallback_found', 'fallback_missing'
]);
const logInterviewAiReason = (reasonCode) => {
  if (process.env.NODE_ENV === 'production' || !INTERVIEW_AI_REASON_CODES.has(reasonCode)) return;
  logger.info('interview-prep-ai', { reasonCode });
};
const selectVerifiedFallback = ({ topicInput, question }) => {
  const candidate = findSeedRecordByQuestion(topicInput.topicKey, question)
    || getTopicSeedItems(topicInput.topicKey).find((item) => computeJaccardSimilarity(question, item.normalizedQuestion || item.question) >= MIN_STRONG_SEARCH_RELEVANCE)
    || null;
  if (!candidate) return null;
  const approval = validateRecordForApproval({ record: candidate, topicInput, minimumScore: MIN_STRONG_SEARCH_RELEVANCE });
  if (!approval.isApproved) return null;
  return {
    question: candidate.question, answer: candidate.answer, answerSections: candidate.answerSections || {},
    difficulty: candidate.difficulty, tags: candidate.tags, topicKey: topicInput.topicKey, topicType: topicInput.topicType,
    sourceType: 'verified_seed', sourceLabel: 'Verified Seed', confidenceScore: candidate.confidenceScore,
    relevanceScore: candidate.relevanceScore, category: candidate.category, qualityScore: candidate.qualityScore,
    answerFormat: candidate.answerFormat || 'structured', isEnriched: true, stored: false, duplicate: false, fromCache: false
  };
};
const buildAiFailurePayload = ({ topicInput, question }) => {
  const fallback = selectVerifiedFallback({ topicInput, question });
  if (fallback) { logInterviewAiReason('fallback_found'); return fallback; }
  logInterviewAiReason('fallback_missing');
  return {
    question, answer: 'No verified answer available.', answerSections: {}, topicKey: topicInput.topicKey,
    topicType: topicInput.topicType, sourceType: 'no_verified_answer', sourceLabel: 'No Verified Answer',
    stored: false, duplicate: false, fromCache: false
  };
};

const toStructuredAnswerText = (sections = {}) => aiProvider.toStructuredAnswerText
  ? aiProvider.toStructuredAnswerText(sections)
  : normalizeAnswerText([
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
  ].filter(Boolean).join('\n\n'));

const isStructuredQuestion = (item = {}) => (
  item.isEnriched === true
  && item.answerFormat === 'structured'
  && item.answerSections
  && typeof item.answerSections === 'object'
  && Boolean(item.answerSections.shortAnswer || item.answerSections.summary || item.answerSections.explanation)
);

const enrichQuestionIfNeeded = async (item = {}) => {
  if (!item?._id || isStructuredQuestion(item)) return item;

  const seedRecord = findSeedRecordByQuestion(item.topicKey, item.question);
  if (seedRecord) {
    const updated = await questionRepository.updateQuestionById(item._id, {
      answer: seedRecord.answer,
      answerSections: seedRecord.answerSections,
      answerFormat: 'structured',
      isEnriched: true,
      qualityScore: Math.max(normalizeQualityScore(item.qualityScore || 80), normalizeQualityScore(seedRecord.qualityScore || 90)),
      category: seedRecord.category || sanitizeCategory(item.category || 'core-concepts'),
      confidenceScore: Math.max(Number(item.confidenceScore || 0), Number(seedRecord.confidenceScore || 0.95)),
      source: seedRecord.source,
      sourceType: seedRecord.sourceType,
      sourceMeta: {
        ...(item.sourceMeta || {}),
        upgradedFromSeedVersion: SEED_VERSION
      }
    });

    return updated || {
      ...item,
      answer: seedRecord.answer,
      answerSections: seedRecord.answerSections,
      answerFormat: 'structured',
      isEnriched: true,
      qualityScore: Math.max(normalizeQualityScore(item.qualityScore || 80), normalizeQualityScore(seedRecord.qualityScore || 90)),
      category: seedRecord.category || sanitizeCategory(item.category || 'core-concepts'),
      confidenceScore: Math.max(Number(item.confidenceScore || 0), Number(seedRecord.confidenceScore || 0.95)),
      source: seedRecord.source,
      sourceType: seedRecord.sourceType
    };
  }

  const enrichedAnswer = await aiProvider.enrichAnswerToStructured({
    question: item.question,
    currentAnswer: item.answer
  });
  const answer = toStructuredAnswerText(enrichedAnswer);
  const updated = await questionRepository.updateQuestionById(item._id, {
    answer,
    answerSections: enrichedAnswer,
    answerFormat: 'structured',
    isEnriched: true,
    qualityScore: Math.max(80, normalizeQualityScore(item.qualityScore || 80)),
    category: sanitizeCategory(item.category || 'core-concepts')
  });

  return updated || {
    ...item,
    answer,
    answerSections: enrichedAnswer,
    answerFormat: 'structured',
    isEnriched: true,
    qualityScore: Math.max(80, normalizeQualityScore(item.qualityScore || 80)),
    category: sanitizeCategory(item.category || 'core-concepts')
  };
};

/** Max number of legacy/plain records to enrich in background per request. */
const MAX_BACKGROUND_ENRICHMENT_BATCH = 5;
/** Track in-flight enrichment IDs to prevent duplicate background jobs. */
const enrichmentInflight = new Set();

const enrichQuestionListOnce = async (questions = []) => {
  const enriched = [];
  for (const item of questions) {
    if (isStructuredQuestion(item)) {
      enriched.push(item);
      continue;
    }
    // Return un-enriched items immediately with their existing data
    enriched.push(item);
  }
  return enriched;
};

/**
 * Fire-and-forget background enrichment for unenriched questions.
 * Bounded to MAX_BACKGROUND_ENRICHMENT_BATCH. Prevents duplicate jobs.
 * AI enrichment failure does not affect the caller.
 */
const scheduleBackgroundEnrichment = (questions = []) => {
  const unenriched = (Array.isArray(questions) ? questions : [])
    .filter((item) => item?._id && !isStructuredQuestion(item) && !enrichmentInflight.has(String(item._id)));
  const batch = unenriched.slice(0, MAX_BACKGROUND_ENRICHMENT_BATCH);
  if (batch.length === 0) return;

  for (const item of batch) {
    enrichmentInflight.add(String(item._id));
  }

  // Fire-and-forget work never blocks the response.
  (async () => {
    for (const item of batch) {
      try {
        await enrichQuestionIfNeeded(item);
      } catch (error) {
        logger.warn('interview-prep background enrichment failed', {
          id: item?._id,
          topicKey: item?.topicKey,
          message: error.message
        });
      } finally {
        enrichmentInflight.delete(String(item._id));
      }
    }
  })();
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
  const totalPages = Math.max(1, Math.ceil(Number(total || 0) / Math.max(1, Number(limit || DEFAULT_PAGE_LIMIT))));
  return {
    questions,
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

const formatSourceLabel = ({ prebuiltGeneratedCount = 0, aiGeneratedCount = 0, scrapedGeneratedCount = 0 }) => {
  const labels = ['db'];
  if (prebuiltGeneratedCount > 0) labels.push('verified_seed');
  if (aiGeneratedCount > 0) labels.push('ai');
  if (scrapedGeneratedCount > 0) labels.push('scrape');
  return labels.join('+');
};

const ensurePrebuiltTopicBaseline = async ({ topicKey, minimumCount = MIN_TOPIC_QUESTION_POOL, forceSync = false }) => {
  const importantTopic = getImportantTopicByKey(topicKey);
  if (!importantTopic) {
    return { attempted: false, insertedCount: 0 };
  }

  const seedRecords = buildSeedRecordsForTopic(importantTopic)
    .map((record) => withApprovalFields({
      record,
      topicInput: normalizeTopicInput({ topic: importantTopic.key }),
      minimumScore: 0.78
    }))
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
      initiatedBy,
      allowScraper: false,
      difficulty: difficulty ? sanitizeDifficulty(difficulty) : ''
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
  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const normalizedTags = toTagFilter(tags);
  const normalizedBlock = String(block || 'top').trim().toLowerCase();
  const cacheKey = makeQuestionsCacheKey({
    topicKey: topicInput.topicKey,
    page: normalizedPage,
    limit: normalizedLimit,
    difficulty,
    tags: normalizedTags,
    block: normalizedBlock,
    category,
    source
  });

  return runSingleFlight(cacheKey, async () => {
    interviewEngineMetrics.totalRequests += 1;
    const cached = await getCacheJson(cacheKey);
    if (cached) {
      interviewEngineMetrics.cacheHits += 1;
      return { ...cached, fromCache: true, metrics: metricSnapshot() };
    }

    interviewEngineMetrics.dbReads += 1;
    await ensurePrebuiltTopicBaseline({
      topicKey: topicInput.topicKey,
      minimumCount: MIN_TOPIC_QUESTION_POOL
    });

    if (normalizedBlock === 'all') {
      let pageResult = await questionRepository.findAllQuestionsPage({
        topicKey: topicInput.topicKey,
        page: normalizedPage,
        limit: normalizedLimit,
        difficulty,
        tags: normalizedTags,
        category,
        source
      });

      const topicSeedCount = getTopicSeedItems(topicInput.topicKey).length;
      if (!category && !source && !normalizedTags && pageResult.total < topicSeedCount) {
        const baselineResult = await ensurePrebuiltTopicBaseline({
          topicKey: topicInput.topicKey,
          minimumCount: topicSeedCount,
          forceSync: true
        });
        if (baselineResult.insertedCount > 0 || baselineResult.attempted) {
          await invalidateInterviewPrepCache();
          pageResult = await questionRepository.findAllQuestionsPage({
            topicKey: topicInput.topicKey,
            page: normalizedPage,
            limit: normalizedLimit,
            difficulty,
            tags: normalizedTags,
            category,
            source
          });
        }
      }

      const questions = await enrichQuestionListOnce(pageResult.questions || []);
      scheduleBackgroundEnrichment(pageResult.questions || []);
      const payload = makeQuestionPayload({
        questions,
        total: pageResult.total,
        page: normalizedPage,
        limit: normalizedLimit,
        source: 'db',
        topicInput,
        sourceMix: await questionRepository.getSourceMixByTopic(topicInput.topicKey)
      });
      await setCacheJson(cacheKey, payload, CACHE_TTL_ALL);
      return payload;
    }

    let rows = await questionRepository.findTopQuestions({
      topicKey: topicInput.topicKey,
      limit: Math.min(30, Number(limit || 30)),
      difficulty,
      tags: normalizedTags
    });

    const topicSeedCount = getTopicSeedItems(topicInput.topicKey).length;
    if (!normalizedTags && rows.length < Math.min(30, topicSeedCount || 30)) {
      const baselineResult = await ensurePrebuiltTopicBaseline({
        topicKey: topicInput.topicKey,
        minimumCount: Math.max(MIN_TOPIC_QUESTION_POOL, topicSeedCount),
        forceSync: true
      });
      if (baselineResult.insertedCount > 0 || baselineResult.attempted) {
        await invalidateInterviewPrepCache();
        rows = await questionRepository.findTopQuestions({
          topicKey: topicInput.topicKey,
          limit: Math.min(30, Number(limit || 30)),
          difficulty,
          tags: normalizedTags
        });
      }
    }

    if (!difficulty && !normalizedTags && rows.length < 30) {
      const importantTopic = getImportantTopicByKey(topicInput.topicKey);
      const verifiedTopSeeds = importantTopic
        ? buildSeedRecordsForTopic(importantTopic).filter((record) => record.isTopQuestion)
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

    const questions = (await enrichQuestionListOnce(rows))
      .sort((left, right) => Number(left.rank || 999) - Number(right.rank || 999))
      .slice(0, 30);
    scheduleBackgroundEnrichment(rows);
    const payload = makeQuestionPayload({
      questions,
      total: questions.length,
      page: 1,
      limit: 30,
      source: 'db',
      topicInput,
      sourceMix: await questionRepository.getSourceMixByTopic(topicInput.topicKey)
    });
    await setCacheJson(cacheKey, payload, CACHE_TTL_TOP);
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
  tags = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  allowEnrichment = true
} = {}) => {
  const query = String(q || '').trim();
  if (!query) {
    return getQuestionBank({ skill, topic, stack, technology, language, framework, difficulty, category, tags, page, limit, block: 'all' });
  }

  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const identity = questionRepository.buildQuestionIdentity({ question: query, topicKey: topicInput.topicKey });
  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const normalizedTags = toTagFilter(tags);
  const normalizedCategory = category ? sanitizeCategory(category) : '';
  const expectedDifficulty = difficulty ? sanitizeDifficulty(difficulty) : '';
  const cacheKey = makeSearchCacheKey({
    query: identity.normalizedQuestion,
    topicKey: topicInput.topicKey,
    page: normalizedPage,
    limit: normalizedLimit,
    difficulty: expectedDifficulty,
    category: normalizedCategory,
    tags: normalizedTags,
    lookupOnly: !allowEnrichment
  });

  return runSingleFlight(cacheKey, async () => {
    const trace = createPipelineTrace();
    interviewEngineMetrics.totalRequests += 1;
    const cacheResult = await getCacheJsonWithMeta(cacheKey);
    trace.applyCache(cacheResult);
    if (cacheResult.value) {
      interviewEngineMetrics.cacheHits += 1;
      return trace.finish({ ...cacheResult.value, fromCache: true, cacheLayer: cacheResult.layer, metrics: metricSnapshot() });
    }

    interviewEngineMetrics.dbReads += 1;
    let reusable = await trace.time('mongoExactMs', 'mongo', () => questionRepository.findExactReusableQuestion({
      topicKey: topicInput.topicKey,
      question: query,
      identity,
      difficulty: expectedDifficulty,
      category: normalizedCategory,
      minConfidence: 0.75
    }));

    if (reusable) {
      const approval = await trace.time('validationMs', null, () => Promise.resolve(validateRecordForApproval({
        record: reusable,
        topicInput,
        expectedDifficulty,
        minimumScore: MIN_STRONG_SEARCH_RELEVANCE
      })));
      if (!approval.isApproved) reusable = null;
    }

    if (!reusable) {
      const candidates = await trace.time('similarityMs', 'similarity', () => questionRepository.findSearchCandidates({
        topicKey: topicInput.topicKey,
        difficulty: expectedDifficulty,
        category: normalizedCategory,
        tags: normalizedTags,
        searchableTokens: identity.searchableTokens,
        limit: 60,
        minConfidence: 0.75
      }));
      const match = candidates.find((candidate) => (
        computeJaccardSimilarity(query, candidate.normalizedQuestion || candidate.question) >= MIN_STRONG_SEARCH_RELEVANCE
      ));
      if (match) {
        reusable = await trace.time('similarityMs', null, () => questionRepository.findQuestionById(match._id));
        const approval = reusable
          ? await trace.time('validationMs', null, () => Promise.resolve(validateRecordForApproval({
            record: reusable,
            topicInput,
            expectedDifficulty,
            minimumScore: MIN_STRONG_SEARCH_RELEVANCE
          })))
          : { isApproved: false };
        if (!approval.isApproved) reusable = null;
      }
    }

    if (reusable) {
      questionRepository.incrementQuestionUsage(reusable._id).catch(() => {});
      const payload = makeQuestionPayload({ questions: [reusable], total: 1, page: 1, limit: normalizedLimit, source: 'db', topicInput });
      cacheWithoutTrace(cacheKey, payload, CACHE_TTL_SEARCH);
      return trace.finish(payload);
    }

    const seedMatch = await trace.time('seedMs', 'seed', () => Promise.resolve(
      findSeedRecordByQuestion(topicInput.topicKey, query)
      || getTopicSeedItems(topicInput.topicKey).find((candidate) => (
        (!expectedDifficulty || sanitizeDifficulty(candidate.difficulty) === expectedDifficulty)
        && (!normalizedCategory || sanitizeCategory(candidate.category) === normalizedCategory)
        && computeJaccardSimilarity(query, candidate.normalizedQuestion || candidate.question) >= MIN_STRONG_SEARCH_RELEVANCE
      ))
      || null
    ));
    if (seedMatch) {
      const approval = await trace.time('validationMs', null, () => Promise.resolve(validateRecordForApproval({
        record: seedMatch,
        topicInput,
        expectedDifficulty,
        minimumScore: MIN_STRONG_SEARCH_RELEVANCE
      })));
      if (approval.isApproved) {
        const payload = makeQuestionPayload({ questions: [seedMatch], total: 1, page: 1, limit: normalizedLimit, source: 'seed', topicInput });
        cacheWithoutTrace(cacheKey, payload, CACHE_TTL_SEARCH);
        return trace.finish(payload);
      }
    }

    if (!allowEnrichment) {
      const payload = makeQuestionPayload({ questions: [], total: 0, page: 1, limit: normalizedLimit, source: 'db', topicInput });
      cacheWithoutTrace(cacheKey, payload, CACHE_TTL_SEARCH);
      return trace.finish(payload);
    }

    try {
      const generated = await trace.time('aiMs', 'ai', () => withAiDeadline(() => aiProvider.answerSearchFallback({
        skill: topicInput.skill,
        topicKey: topicInput.topicKey,
        question: query,
        verifiedContext: buildVerifiedPromptContext(topicInput.topicKey, query)
      })));
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
      const approvedRecord = await trace.time('validationMs', null, () => Promise.resolve(withApprovalFields({
        record,
        topicInput,
        expectedDifficulty,
        minimumScore: MIN_STRONG_SEARCH_RELEVANCE
      })));
      if (!approvedRecord.isApproved || normalizeQualityScore(approvedRecord.qualityScore || 0) < 80) {
        return trace.finish(makeQuestionPayload({ questions: [], total: 0, page: 1, limit: normalizedLimit, source: 'db', topicInput }));
      }

      const result = await trace.time('persistenceMs', 'persistence', () => questionRepository.upsertQuestions([approvedRecord]));
      const payloadQuestion = { ...approvedRecord, _id: result.upsertedIds?.[0] || null, stored: true, sourceLabel: 'AI Generated' };
      const payload = makeQuestionPayload({ questions: [payloadQuestion], total: 1, page: 1, limit: normalizedLimit, source: 'ai_generated', topicInput, aiGeneratedCount: 1, enrichedCount: 1 });
      cacheAfterInvalidation(cacheKey, payload, CACHE_TTL_SEARCH);
      return trace.finish(payload);
    } catch (error) {
      logger.warn('interview-prep search AI answer failed', { topicKey: topicInput.topicKey, reason: 'provider_unavailable' });
      return trace.finish(makeQuestionPayload({ questions: [], total: 0, page: 1, limit: normalizedLimit, source: 'db', topicInput }));
    }
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

  const sourceType = questionRepository.normalizeSourceType(
    ['verified_seed', 'prebuilt', 'ai', 'ai_generated', 'scraped', 'user_asked'].includes(source) ? source : 'ai_generated'
  );
  const records = deduped.map((item) => withApprovalFields({
    record: enrichmentOrchestrator.toStorableRecord({
      item,
      topic,
      sourceType,
      sourceMeta: { mode: 'saveUniqueQuestions' },
      popularity
    }),
    topicInput: topic
  })).filter((record) => record.isApproved);

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

const fallbackToQuestionBankForGeneration = async ({
  topicInput,
  skill = '',
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = '',
  difficulty = '',
  page = 1,
  limit = DEFAULT_PAGE_LIMIT,
  reason = 'unknown',
  error = null
} = {}) => {
  const normalizedLimit = Math.max(MIN_GENERATE_RESULTS, normalizePagination({ page, limit }).limit);
  const targetTopicKey = topicInput?.topicKey || sanitizeSkill(skill || topic || language || framework || technology || stack) || 'javascript';

  console.warn(`AI generation fallback engaged for topic: ${targetTopicKey}. Reason: ${reason}`);
  logger.warn('interview-prep generate fallback to bank', {
    topicKey: targetTopicKey,
    reason,
    message: error?.message || ''
  });

  try {
    const topPayload = await getQuestionBank({
      skill: targetTopicKey,
      difficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      page: 1,
      limit: normalizedLimit,
      block: 'top'
    });

    if (Array.isArray(topPayload?.questions) && topPayload.questions.length > 0) {
      return topPayload;
    }

    const allPayload = await getQuestionBank({
      skill: targetTopicKey,
      difficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      page: 1,
      limit: normalizedLimit,
      block: 'all'
    });

    if (Array.isArray(allPayload?.questions) && allPayload.questions.length > 0) {
      return allPayload;
    }
  } catch (fallbackError) {
    console.error('Fallback question bank lookup failed:', fallbackError);
    logger.warn('interview-prep fallback bank lookup failed', {
      topicKey: targetTopicKey,
      message: fallbackError.message
    });
  }

  const memoryFallbackTopic = getImportantTopicByKey(targetTopicKey);
  const memoryFallbackQuestions = memoryFallbackTopic
    ? buildSeedRecordsForTopic(memoryFallbackTopic).filter((record) => record.isTopQuestion).slice(0, normalizedLimit)
    : [];

  if (memoryFallbackQuestions.length > 0) {
    console.warn(`Using in-memory verified seed fallback for topic: ${memoryFallbackTopic.key}`);
    return makeQuestionPayload({
      questions: memoryFallbackQuestions,
      total: memoryFallbackQuestions.length,
      page: 1,
      limit: normalizedLimit,
      source: 'db',
      topicInput: normalizeTopicInput({ topic: memoryFallbackTopic.key }),
      aiGeneratedCount: 0,
      scrapedGeneratedCount: 0,
      enrichedCount: 0,
      sourceMix: { verified_seed: memoryFallbackQuestions.length },
      partial: false
    });
  }

  const unavailableError = new Error(`Unable to provide requested interview questions for topic '${targetTopicKey}' from the verified bank.`);
  unavailableError.statusCode = 503;
  throw unavailableError;
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
  const normalizedLimit = normalizePagination({ page, limit }).limit;
  const targetCount = Math.max(1, normalizedLimit);
  const focusQuery = String(query || topic || topicInput.topicKey || '').replace(/\s+/g, ' ').trim();
  const focusTopic = focusQuery.toLowerCase();
  const fallbackToBank = async (reason, error = null) => {
    const payload = await fallbackToQuestionBankForGeneration({
      topicInput,
      skill: normalizedSkill || skill,
      topic,
      stack,
      technology,
      language,
      framework,
      difficulty,
      page,
      limit: targetCount,
      reason,
      error
    });

    if (Array.isArray(payload?.questions) && payload.questions.length > 0) {
      return payload;
    }

    console.warn(`Fallback question bank returned empty for topic: ${topicInput.topicKey || normalizedSkill || 'javascript'}`);
    return {
      ...payload,
      questions: [],
      total: 0,
      totalAvailable: 0,
      page: 1,
      limit: targetCount,
      totalPages: 1,
      fromCache: false,
      source: 'db',
      aiGeneratedCount: 0,
      scrapedGeneratedCount: 0,
      enrichedCount: 0,
      sourceMix: payload?.sourceMix || {},
      partial: false,
      topicKey: payload?.topicKey || topicInput.topicKey,
      topicType: payload?.topicType || topicInput.topicType,
      metrics: metricSnapshot()
    };
  };

  if (!normalizedSkill) {
    return fallbackToBank('missing_skill');
  }

  console.log('Generating AI questions for topic:', topicInput.topicKey);
  const existing = await questionRepository.findAiGeneratedByTopic({
    topicKey: topicInput.topicKey,
    topic: focusTopic,
    limit: targetCount
  });

  if (existing.length >= targetCount) {
    interviewEngineMetrics.aiReuseHits += targetCount;
    const questions = await enrichQuestionListOnce(existing.slice(0, targetCount));
    console.log('Existing AI question reuse count:', existing.length);
    console.log('After enrichment reuse count:', questions.length);
    if (!questions || questions.length === 0) {
      return fallbackToBank('existing_ai_reuse_empty');
    }
    return makeQuestionPayload({
      questions,
      total: questions.length,
      page: 1,
      limit: targetCount,
      source: 'db',
      topicInput,
      aiGeneratedCount: 0,
      enrichedCount: 0
    });
  }

  const gap = Math.max(0, targetCount - existing.length);
  try {
    const generated = await aiProvider.generateStructuredQuestionSet({
      skill: normalizedSkill,
      topic: focusQuery,
      difficulty,
      count: gap
    });
    console.log('AI returned:', Array.isArray(generated) ? generated.length : 0);
    const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(topicInput.topicKey, 600);
    const normalized = normalizeQuestions(generated)
      .map((item, index) => ({
        ...item,
        answerSections: generated[index]?.answerSections || item.answerSections,
        category: generated[index]?.category || item.category || 'core-concepts',
        qualityScore: generated[index]?.qualityScore || 80,
        confidenceScore: generated[index]?.confidenceScore,
        answerFormat: 'structured',
        isEnriched: true,
        tags: sanitizeTags([
          ...(item.tags || []),
          topicInput.topicKey,
          focusTopic,
          ...focusTopic.split(/\s+/).filter(Boolean),
          'ai_generated'
        ])
      }))
      .filter((item) => isQualityQuestionAnswer({ ...item, topicKey: topicInput.topicKey }));
    console.log('After validation:', normalized.length);
    console.log('Validation rejected:', Math.max(0, (Array.isArray(generated) ? generated.length : 0) - normalized.length));
    const deduped = dedupeQuestions({ questions: normalized, existingComparableQuestions });
    console.log('After deduplication:', deduped.length);
    const records = deduped.map((item) => withApprovalFields({
      record: enrichmentOrchestrator.toStorableRecord({
        item,
        topic: topicInput,
        sourceType: 'ai_generated',
        sourceMeta: {
          topic: focusTopic,
          query: focusQuery,
          mode: 'practice-set',
          generatedAt: new Date().toISOString(),
          expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : ''
        },
        popularity: 14
      }),
      topicInput,
      expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      minimumScore: 0.78
    })).filter((record) => record.isApproved);
    console.log('After approval filter:', records.length);

    if (!records || records.length === 0) {
      console.warn('AI generation failed validation, using fallback questions');
      return fallbackToBank('validated_questions_empty');
    }

    if (records.length > 0) {
      await questionRepository.upsertQuestions(records);
      await invalidateInterviewPrepCache();
    }

    const fullSet = await questionRepository.findAiGeneratedByTopic({
      topicKey: topicInput.topicKey,
      topic: focusTopic,
      limit: targetCount
    });
    const questions = await enrichQuestionListOnce(fullSet.slice(0, targetCount));
    if (questions.length >= targetCount) {
      return {
        questions: questions.slice(0, targetCount),
        total: targetCount,
        totalAvailable: targetCount,
        page: 1,
        limit: targetCount,
        totalPages: 1,
        fromCache: false,
        source: records.length ? 'ai_generated' : 'db',
        aiGeneratedCount: records.length,
        scrapedGeneratedCount: 0,
        enrichedCount: records.length,
        sourceMix: {},
        partial: false,
        topicKey: topicInput.topicKey,
        topicType: topicInput.topicType,
        metrics: metricSnapshot()
      };
    }

    console.warn(`Generated ${questions.length} of ${targetCount} requested questions; completing from the verified bank`);
    const fallbackPayload = await fallbackToBank('generated_set_incomplete');
    const completedQuestions = dedupeQuestions({
      questions: [...questions, ...(fallbackPayload.questions || [])]
    }).slice(0, targetCount);

    if (completedQuestions.length >= targetCount) {
      return {
        ...fallbackPayload,
        questions: completedQuestions,
        total: targetCount,
        totalAvailable: targetCount,
        limit: targetCount,
        source: records.length ? 'ai_generated+verified_seed' : fallbackPayload.source,
        aiGeneratedCount: records.length,
        enrichedCount: records.length,
        partial: false,
        topicKey: topicInput.topicKey,
        topicType: topicInput.topicType,
        metrics: metricSnapshot()
      };
    }

    const error = new Error(`Unable to generate the requested ${targetCount} distinct interview questions.`);
    error.statusCode = 503;
    throw error;
  } catch (error) {
    console.error('Generate fresh interview questions error:', error);
    logger.warn('interview-prep explicit generation failed; using saved bank', {
      topicKey: topicInput.topicKey,
      message: error.message
    });
    return fallbackToBank('generation_exception', error);
  }
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
  if (!normalizedQuestion || normalizedQuestion.length < 12 || normalizedQuestion.length > 500) {
    const error = new Error('Question must be between 12 and 500 characters long.');
    error.statusCode = 400;
    throw error;
  }

  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const detectedTopics = detectTopicsInText(normalizedQuestion);
  if (detectedTopics.length > 0 && !detectedTopics.some((item) => item.topicKey === topicInput.topicKey)) {
    const error = new Error(`This question does not match the selected skill. It looks closer to ${detectedTopics[0].topicLabel}.`);
    error.statusCode = 400;
    throw error;
  }

  const identity = questionRepository.buildQuestionIdentity({ question: normalizedQuestion, topicKey: topicInput.topicKey });
  const cacheKey = makeCustomQuestionCacheKey({ question: identity.normalizedQuestion, topicKey: topicInput.topicKey });
  return runSingleFlight(cacheKey, async () => {
    const trace = createPipelineTrace();
    const cacheResult = await getCacheJsonWithMeta(cacheKey);
    trace.applyCache(cacheResult);
    if (cacheResult.value) {
      interviewEngineMetrics.cacheHits += 1;
      if (cacheResult.value._id) questionRepository.incrementQuestionUsage(cacheResult.value._id).catch(() => {});
      return trace.finish({ ...cacheResult.value, sourceLabel: `Cache / ${cacheResult.value.sourceLabel || 'DB'}`, fromCache: true, cacheLayer: cacheResult.layer });
    }

    interviewEngineMetrics.dbReads += 1;
    let reusable = await trace.time('mongoExactMs', 'mongo', () => questionRepository.findExactReusableQuestion({
      topicKey: topicInput.topicKey,
      question: normalizedQuestion,
      identity,
      minConfidence: 0.75
    }));
    if (reusable) {
      const approval = await trace.time('validationMs', null, () => Promise.resolve(validateRecordForApproval({ record: reusable, topicInput, minimumScore: MIN_STRONG_SEARCH_RELEVANCE })));
      if (!approval.isApproved) reusable = null;
    }

    if (!reusable) {
      const candidates = await trace.time('similarityMs', 'similarity', () => questionRepository.findSearchCandidates({
        topicKey: topicInput.topicKey,
        searchableTokens: identity.searchableTokens,
        limit: 60,
        minConfidence: 0.75
      }));
      const match = candidates.find((candidate) => computeJaccardSimilarity(normalizedQuestion, candidate.normalizedQuestion || candidate.question) >= MIN_STRONG_SEARCH_RELEVANCE);
      if (match) {
        reusable = await trace.time('similarityMs', null, () => questionRepository.findQuestionById(match._id));
        const approval = reusable
          ? await trace.time('validationMs', null, () => Promise.resolve(validateRecordForApproval({ record: reusable, topicInput, minimumScore: MIN_STRONG_SEARCH_RELEVANCE })))
          : { isApproved: false };
        if (!approval.isApproved) reusable = null;
      }
    }

    if (reusable) {
      questionRepository.incrementQuestionUsage(reusable._id).catch(() => {});
      const payload = {
        ...reusable,
        sourceType: 'db',
        sourceLabel: ['verified_seed', 'prebuilt'].includes(reusable.sourceType) ? 'Verified Seed' : 'DB',
        stored: true,
        duplicate: true,
        fromCache: false
      };
      cacheWithoutTrace(cacheKey, payload, CACHE_TTL_CUSTOM);
      return trace.finish(payload);
    }

    const seedMatch = await trace.time('seedMs', 'seed', () => Promise.resolve(
      findSeedRecordByQuestion(topicInput.topicKey, normalizedQuestion)
      || getTopicSeedItems(topicInput.topicKey).find((candidate) => computeJaccardSimilarity(normalizedQuestion, candidate.normalizedQuestion || candidate.question) >= MIN_STRONG_SEARCH_RELEVANCE)
      || null
    ));
    if (seedMatch) {
      const approval = await trace.time('validationMs', null, () => Promise.resolve(validateRecordForApproval({ record: seedMatch, topicInput, minimumScore: MIN_STRONG_SEARCH_RELEVANCE })));
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

    let generated;
    try {
      generated = await trace.time('aiMs', 'ai', () => withAiDeadline(() => aiProvider.answerSearchFallback({
        skill: topicInput.skill,
        topicKey: topicInput.topicKey,
        question: normalizedQuestion,
        verifiedContext: buildVerifiedPromptContext(topicInput.topicKey, normalizedQuestion)
      })));
      interviewEngineMetrics.aiFallbackRuns += 1;
      logInterviewAiReason('provider_success');
    } catch (error) {
      logInterviewAiReason(INTERVIEW_AI_REASON_CODES.has(error?.reasonCode) ? error.reasonCode : 'provider_error');
      return trace.finish(buildAiFailurePayload({ topicInput, question: normalizedQuestion }));
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
      sourceMeta: { userId: String(userId || ''), askedAt: new Date().toISOString(), mode: 'custom-question' },
      popularity: 18
    });
    const approvedRecord = await trace.time('validationMs', null, () => Promise.resolve(withApprovalFields({
      record,
      topicInput,
      expectedDifficulty: generated.difficulty || '',
      minimumScore: MIN_STRONG_SEARCH_RELEVANCE
    })));
    if (!approvedRecord.isApproved) {
      const semanticReasons = /topic|concept|comparison|contradiction|generic|placeholder|directly_address/.test(approvedRecord.rejectedReason || '');
      logInterviewAiReason(semanticReasons ? 'semantic_rejected' : 'quality_rejected');
      return trace.finish(buildAiFailurePayload({ topicInput, question: normalizedQuestion }));
    }

    const result = await trace.time('persistenceMs', 'persistence', () => questionRepository.upsertQuestions([approvedRecord]));
    const payload = {
      question: approvedRecord.question,
      answer: approvedRecord.answer,
      answerSections: approvedRecord.answerSections || {},
      difficulty: approvedRecord.difficulty,
      tags: approvedRecord.tags,
      topicKey: topicInput.topicKey,
      topicType: topicInput.topicType,
      sourceType: 'ai_generated',
      sourceLabel: 'AI Generated',
      confidenceScore: approvedRecord.confidenceScore,
      relevanceScore: approvedRecord.relevanceScore,
      category: approvedRecord.category,
      qualityScore: approvedRecord.qualityScore,
      answerFormat: approvedRecord.answerFormat,
      isEnriched: approvedRecord.isEnriched,
      _id: result.upsertedIds?.[0] || null,
      stored: Number(result.insertedCount || 0) > 0,
      duplicate: false,
      fromCache: false
    };
    cacheAfterInvalidation(cacheKey, payload, CACHE_TTL_CUSTOM);
    return trace.finish(payload);
  });
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
      initiatedBy: 'maintenance',
      allowScraper: false
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
  selectVerifiedFallback,
  buildAiFailurePayload,
  invalidateInterviewPrepCache
};
