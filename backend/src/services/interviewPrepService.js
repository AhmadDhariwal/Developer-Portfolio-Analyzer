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
  getImportantTopicByKey,
  findSeedRecordByQuestion
} = require('./interviewQuestionSeedCatalog');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  normalizeComparableText,
  sanitizeDifficulty,
  sanitizeTags,
  dedupeQuestions,
  isQualityQuestionAnswer,
  validateInterviewQuestionQuality,
  computeJaccardSimilarity
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

const makeQuestionsCacheKey = ({ topicKey, page, limit, difficulty = '', tags = '', block = 'top', category = '', source = '' }) => {
  return `interview:questions:bank=v9:block=${block}:topic=${topicKey}:page=${page}:limit=${limit}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:category=${String(category || '').toLowerCase()}:source=${String(source || '').toLowerCase()}`;
};

const makeSearchCacheKey = ({ query, topicKey, page, limit, difficulty = '', tags = '', lookupOnly = false }) => {
  return `interview:search:v3:mode=${lookupOnly ? 'lookup' : 'answer'}:q=${encodeURIComponent(String(query || '').trim().toLowerCase())}:topic=${topicKey}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:page=${page}:limit=${limit}`;
};

const makeCustomQuestionCacheKey = ({ question, topicKey }) => (
  `interview:custom:v3:topic=${topicKey}:question=${questionRepository.toQuestionHash(question)}`
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
  return {
    ...record,
    relevanceScore: approval.relevanceScore,
    qualityState: approval.isApproved ? 'approved' : 'rejected',
    qualityStatus: approval.isApproved ? 'approved' : 'rejected',
    isApproved: approval.isApproved,
    rejectedReason: approval.isApproved ? '' : approval.reasons.join(', ')
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
      qualityScore: Math.max(5, Number(item.qualityScore || 4)),
      category: item.category || seedRecord.category || 'conceptual',
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
      qualityScore: Math.max(5, Number(item.qualityScore || 4)),
      category: item.category || seedRecord.category || 'conceptual',
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
    qualityScore: Math.max(4, Number(item.qualityScore || 4)),
    category: item.category || 'conceptual'
  });

  return updated || {
    ...item,
    answer,
    answerSections: enrichedAnswer,
    answerFormat: 'structured',
    isEnriched: true,
    qualityScore: Math.max(4, Number(item.qualityScore || 4)),
    category: item.category || 'conceptual'
  };
};

const enrichQuestionListOnce = async (questions = []) => {
  const enriched = [];
  for (const item of questions) {
    try {
      const upgraded = await enrichQuestionIfNeeded(item);
      if (upgraded?.answer && isStructuredQuestion(upgraded)) {
        enriched.push(upgraded);
      }
    } catch (error) {
      logger.warn('interview-prep answer enrichment failed', {
        id: item?._id,
        topicKey: item?.topicKey,
        message: error.message
      });
    }
  }
  return enriched;
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
  return {
    ...interviewEngineMetrics,
    dbHitRatio,
    cacheHitRatio
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
  tags = '',
  block = 'top',
  category = '',
  source = ''
} = {}) => {
  interviewEngineMetrics.totalRequests += 1;
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
    const payload = makeQuestionPayload({
      questions,
      total: pageResult.total,
      page: normalizedPage,
      limit: normalizedLimit,
      source: 'db',
      topicInput,
      sourceMix: await questionRepository.getSourceMixByTopic(topicInput.topicKey)
    });
    await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
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

  const questions = (await enrichQuestionListOnce(rows)).slice(0, 30);
  const payload = makeQuestionPayload({
    questions,
    total: questions.length,
    page: 1,
    limit: 30,
    source: 'db',
    topicInput,
    sourceMix: await questionRepository.getSourceMixByTopic(topicInput.topicKey)
  });
  await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
  return payload;
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
    return getQuestionBank({ skill, topic, stack, technology, language, framework, difficulty, tags, page, limit, block: 'all' });
  }

  interviewEngineMetrics.totalRequests += 1;
  const topicInput = normalizeTopicInput({ skill, topic, stack, technology, language, framework });
  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const normalizedTags = toTagFilter(tags);
  const cacheKey = makeSearchCacheKey({
    query,
    topicKey: topicInput.topicKey,
    page: normalizedPage,
    limit: normalizedLimit,
    difficulty,
    tags: normalizedTags,
    lookupOnly: !allowEnrichment
  });

  const cached = await getCacheJson(cacheKey);
  if (cached) {
    interviewEngineMetrics.cacheHits += 1;
    return { ...cached, fromCache: true, metrics: metricSnapshot() };
  }

  interviewEngineMetrics.dbReads += 1;
  await ensurePrebuiltTopicBaseline({ topicKey: topicInput.topicKey, minimumCount: 1 });

  let reusable = await questionRepository.findExactReusableQuestion({
    topicKey: topicInput.topicKey,
    question: query,
    minConfidence: 0.75
  });

  if (reusable) {
    reusable = await enrichQuestionIfNeeded(reusable);
    const approval = validateRecordForApproval({
      record: reusable,
      topicInput,
      expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      minimumScore: MIN_STRONG_SEARCH_RELEVANCE
    });
    if (!approval.isApproved) {
      reusable = null;
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
    await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  const textMatches = await questionRepository.findSearchTextMatches({
    topicKey: topicInput.topicKey,
    query,
    limit: Math.max(10, normalizedLimit),
    difficulty,
    tags: normalizedTags
  });

  const strongTextMatches = textMatches.filter((candidate) => {
    const similarity = computeJaccardSimilarity(query, candidate.normalizedQuestion || candidate.question);
    const includesExact = normalizeComparableText(candidate.question).includes(normalizeComparableText(query))
      || normalizeComparableText(query).includes(normalizeComparableText(candidate.question));
    const approval = validateRecordForApproval({
      record: candidate,
      topicInput,
      expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      minimumScore: MIN_STRONG_SEARCH_RELEVANCE
    });
    return approval.isApproved && (similarity >= 0.55 || includesExact);
  }).slice(0, 1);

  if (strongTextMatches.length > 0) {
    const questions = await enrichQuestionListOnce(strongTextMatches);
    questionRepository.incrementQuestionUsage(questions[0]._id).catch(() => {});
    const payload = makeQuestionPayload({
      questions,
      total: questions.length,
      page: 1,
      limit: normalizedLimit,
      source: 'db',
      topicInput
    });
    await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  const semanticCandidates = await questionRepository.findSemanticCandidates({
    topicKey: topicInput.topicKey,
    tags: sanitizeTags([topicInput.topicKey, ...String(query).split(/\s+/)]),
    minConfidence: 0.75
  });
  const semanticMatch = semanticCandidates.find((candidate) => (
    computeJaccardSimilarity(query, candidate.normalizedQuestion || candidate.question) >= 0.78
    && validateRecordForApproval({
      record: candidate,
      topicInput,
      expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      minimumScore: MIN_STRONG_SEARCH_RELEVANCE
    }).isApproved
  )) || null;

  if (semanticMatch) {
    const question = await enrichQuestionIfNeeded(semanticMatch);
    questionRepository.incrementQuestionUsage(question._id).catch(() => {});
    const payload = makeQuestionPayload({
      questions: [question],
      total: 1,
      page: 1,
      limit: normalizedLimit,
      source: 'db',
      topicInput
    });
    await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
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
    await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  const generated = await aiProvider.answerSearchFallback({
    skill: topicInput.skill,
    topicKey: topicInput.topicKey,
    question: query
  });
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

  const approvedRecord = withApprovalFields({
    record,
    topicInput,
    expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
    minimumScore: MIN_STRONG_SEARCH_RELEVANCE
  });
  const approved = approvedRecord.isApproved && Number(approvedRecord.qualityScore || 0) >= 3;
  if (!approved) {
    const error = new Error('A reliable answer could not be generated right now. Please try again.');
    error.statusCode = 503;
    throw error;
  }

  const result = await questionRepository.upsertQuestions([approvedRecord]);
  await invalidateInterviewPrepCache();
  const savedId = result.upsertedIds?.[0] || null;
  const payloadQuestion = {
    ...approvedRecord,
    _id: savedId,
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
  await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
  return payload;
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
  const targetCount = Math.max(1, normalizedLimit);
  const focusTopic = String(query || topic || topicInput.topicKey || '').trim().toLowerCase();
  const existing = await questionRepository.findAiGeneratedByTopic({
    topicKey: topicInput.topicKey,
    topic: focusTopic,
    limit: targetCount
  });

  if (existing.length >= targetCount) {
    const questions = await enrichQuestionListOnce(existing.slice(0, targetCount));
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
      topic: focusTopic,
      difficulty,
      count: gap
    });
    const existingComparableQuestions = await questionRepository.fetchComparableQuestionsByTopic(topicInput.topicKey, 600);
    const normalized = normalizeQuestions(generated)
      .map((item, index) => ({
        ...item,
        answerSections: generated[index]?.answerSections || item.answerSections,
        category: generated[index]?.category || item.category || 'conceptual',
        qualityScore: generated[index]?.qualityScore || 4,
        confidenceScore: generated[index]?.confidenceScore,
        answerFormat: 'structured',
        isEnriched: true,
        tags: sanitizeTags([...(item.tags || []), topicInput.topicKey, focusTopic, 'ai_generated'])
      }))
      .filter((item) => isQualityQuestionAnswer({ ...item, topicKey: topicInput.topicKey }));
    const deduped = dedupeQuestions({ questions: normalized, existingComparableQuestions });
    const records = deduped.map((item) => withApprovalFields({
      record: enrichmentOrchestrator.toStorableRecord({
        item,
        topic: topicInput,
        sourceType: 'ai_generated',
        sourceMeta: { topic: focusTopic, query: focusTopic, mode: 'practice-set', generatedAt: new Date().toISOString(), expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '' },
        popularity: 14
      }),
      topicInput,
      expectedDifficulty: difficulty ? sanitizeDifficulty(difficulty) : '',
      minimumScore: 0.78
    })).filter((record) => record.isApproved);

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
    if (questions.length > 0) {
      return {
        questions,
        total: questions.length,
        totalAvailable: questions.length,
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
    question: normalizedQuestion,
    minConfidence: 0.75
  });

  if (!reusable) {
    const semanticCandidates = await questionRepository.findSemanticCandidates({
      topicKey: topicInput.topicKey,
      minConfidence: 0.75
    });
    reusable = semanticCandidates.find((candidate) => (
      computeJaccardSimilarity(normalizedQuestion, candidate.normalizedQuestion || candidate.question) >= 0.78
      && validateRecordForApproval({
        record: candidate,
        topicInput,
        minimumScore: MIN_STRONG_SEARCH_RELEVANCE
      }).isApproved
    )) || null;
  }

  if (reusable) {
    questionRepository.incrementQuestionUsage(reusable._id).catch(() => {});
    const reusedPayload = {
      ...reusable,
      sourceType: 'db',
      sourceLabel: ['verified_seed', 'prebuilt'].includes(reusable.sourceType) ? 'Verified Seed' : 'DB',
      stored: true,
      duplicate: true,
      fromCache: false
    };
    await setCacheJson(cacheKey, reusedPayload, CACHE_TTL_SECONDS);
    return reusedPayload;
  }

  let generated = null;
  let generatedSourceType = 'ai_generated';
  try {
    generated = await aiProvider.answerSearchFallback({
      skill: topicInput.skill,
      topicKey: topicInput.topicKey,
      question: normalizedQuestion
    });
    interviewEngineMetrics.aiFallbackRuns += 1;
  } catch (error) {
    logger.warn('interview-prep custom AI answer failed', {
      topicKey: topicInput.topicKey,
      message: error.message
    });
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
      answerSections: generated.answerSections,
      category: generated.category,
      qualityScore: generated.qualityScore,
      answerFormat: 'structured',
      isEnriched: true,
      difficulty: generated.difficulty,
      tags: sanitizeTags([...(generated.tags || []), topicInput.topicKey, generatedSourceType])
    },
    topic: topicInput,
    sourceType: generatedSourceType,
    sourceMeta: { userId: String(userId || ''), askedAt: new Date().toISOString(), mode: 'custom-question' },
    popularity: 18
  });

  const approvedRecord = withApprovalFields({
    record,
    topicInput,
    expectedDifficulty: generated.difficulty || '',
    minimumScore: MIN_STRONG_SEARCH_RELEVANCE
  });
  const approved = approvedRecord.isApproved;
  if (!approved) {
    const error = new Error('A reliable answer could not be generated right now. Please try again.');
    error.statusCode = 503;
    throw error;
  }

  let stored = false;
  let storedId = null;
  const result = await questionRepository.upsertQuestions([approvedRecord]);
  stored = Number(result.insertedCount || 0) > 0;
  storedId = result.upsertedIds?.[0] || null;
  await invalidateInterviewPrepCache();

  const payload = {
    question: approvedRecord.question,
    answer: approvedRecord.answer,
    answerSections: approvedRecord.answerSections || {},
    difficulty: approvedRecord.difficulty,
    tags: approvedRecord.tags,
    topicKey: topicInput.topicKey,
    topicType: topicInput.topicType,
    sourceType: generatedSourceType,
    sourceLabel: generatedSourceType === 'scraped' ? 'Scraped' : 'AI Generated',
    confidenceScore: approvedRecord.confidenceScore,
    relevanceScore: approvedRecord.relevanceScore,
    category: approvedRecord.category,
    qualityScore: approvedRecord.qualityScore,
    answerFormat: approvedRecord.answerFormat,
    isEnriched: approvedRecord.isEnriched,
    _id: storedId,
    stored,
    duplicate: false,
    fromCache: false
  };

  await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
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
  invalidateInterviewPrepCache
};
