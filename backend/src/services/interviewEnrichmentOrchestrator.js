const logger = require('../utils/logger');
const {
  dedupeQuestions,
  isQualityQuestionAnswer,
  validateInterviewQuestionQuality,
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

const sectionTitles = [
  'Short direct answer',
  'Key points',
  'Explanation',
  'Example',
  'Real-world use case',
  'Common mistakes',
  'Interview tip'
];

const normalizeStructuredSections = (sections = {}, answer = '') => {
  const incoming = sections && typeof sections === 'object' ? sections : {};
  const extracted = extractAnswerSections(answer);
  const summary = incoming.shortAnswer || incoming.summary || incoming['Short direct answer'] || extracted['Short direct answer'] || '';
  const explanation = incoming.explanation || incoming.Explanation || extracted.Explanation || answer;
  const bulletPoints = Array.isArray(incoming.keyPoints)
    ? incoming.keyPoints
    : Array.isArray(incoming.bulletPoints)
      ? incoming.bulletPoints
    : String(incoming['Key points'] || extracted['Key points'] || '')
      .split(/\n|-/)
      .map((point) => point.trim())
      .filter(Boolean);
  const commonMistakes = Array.isArray(incoming.commonMistakes)
    ? incoming.commonMistakes.map((point) => normalizeAnswerText(point)).filter(Boolean).slice(0, 5)
    : [];

  return {
    summary: normalizeAnswerText(summary),
    explanation: normalizeAnswerText(explanation),
    bulletPoints: bulletPoints.map((point) => normalizeAnswerText(point)).filter(Boolean).slice(0, 6),
    codeExample: String(incoming.example || incoming.codeExample || incoming.Example || extracted.Example || '').trim(),
    realWorldContext: normalizeAnswerText(
      incoming.realWorldUseCase || incoming.realWorldContext || incoming['Real-world use case'] || extracted['Real-world use case'] || ''
    ),
    commonMistakes,
    interviewTip: normalizeAnswerText(incoming.interviewTip || '')
  };
};

const toStructuredText = (sections = {}) => normalizeAnswerText([
  sections.summary ? `Summary: ${sections.summary}` : '',
  sections.explanation ? `Explanation: ${sections.explanation}` : '',
  Array.isArray(sections.bulletPoints) && sections.bulletPoints.length
    ? `Key points:\n${sections.bulletPoints.map((point) => `- ${point}`).join('\n')}`
    : '',
  sections.codeExample ? `Code example:\n${sections.codeExample}` : '',
  sections.realWorldContext ? `Real-world context: ${sections.realWorldContext}` : '',
  Array.isArray(sections.commonMistakes) && sections.commonMistakes.length
    ? `Common mistakes:\n${sections.commonMistakes.map((point) => `- ${point}`).join('\n')}`
    : '',
  sections.interviewTip ? `Interview tip: ${sections.interviewTip}` : ''
].filter(Boolean).join('\n\n'));

const sanitizeCategory = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['conceptual', 'scenario_based', 'code_output', 'best_practice', 'system_design', 'behavioral'].includes(normalized)
    ? normalized
    : 'conceptual';
};

const sanitizeQualityScore = (value = 4) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 4;
  return Math.min(5, Math.max(1, Math.round(numeric)));
};

const extractAnswerSections = (answer = '') => {
  const sections = {};
  for (const title of sectionTitles) {
    const pattern = new RegExp(`${title}:\\s*([\\s\\S]*?)(?=\\n(?:${sectionTitles.join('|')}):|$)`, 'i');
    const value = String(answer || '').match(pattern)?.[1]?.trim();
    if (value) sections[title] = value;
  }
  return sections;
};

const toStorableRecord = ({ item, topic, sourceType, sourceMeta = {}, popularity = 10, qualityState = 'approved' }) => {
  const question = normalizeQuestionText(item.question);
  const answerSections = normalizeStructuredSections(item.answerSections, item.answer);
  const answer = normalizeAnswerText(item.answerFormat === 'structured' || item.answerSections
    ? toStructuredText(answerSections)
    : item.answer);
  const confidenceScore = computeConfidenceScore({ sourceType, question, answer });
  const quality = validateInterviewQuestionQuality({
    question,
    answer,
    answerSections,
    topicKey: topic.topicKey,
    difficulty: item.difficulty,
    expectedDifficulty: sourceMeta.expectedDifficulty || '',
    tags: item.tags,
    sourceType,
    confidenceScore,
    qualityScore: item.qualityScore,
    minimumScore: sourceType === 'scraped' ? 0.8 : 0.75
  });
  const approved = qualityState === 'approved' && quality.isValid;

  return {
    topicKey: topic.topicKey,
    topicType: topic.topicType,
    topicDimensions: topic.topicDimensions,
    skill: topic.skill,
    question,
    answer,
    answerSections,
    normalizedQuestion: normalizeComparableText(question),
    normalizedAnswer: normalizeComparableText(answer),
    difficulty: sanitizeDifficulty(item.difficulty),
    tags: sanitizeTags([...(item.tags || []), topic.topicKey, topic.topicType]),
    source: sourceType === 'user_asked' ? 'ai_generated' : sourceType,
    sourceType,
    sourceMeta,
    confidenceScore,
    relevanceScore: quality.relevanceScore,
    category: sanitizeCategory(item.category),
    qualityScore: sanitizeQualityScore(item.qualityScore || (confidenceScore >= 0.85 ? 4 : 3)),
    answerFormat: item.answerSections || item.answerFormat === 'structured' ? 'structured' : 'plain',
    isEnriched: Boolean(item.isEnriched || item.answerSections || item.answerFormat === 'structured'),
    qualityState: approved ? 'approved' : 'rejected',
    isApproved: approved,
    qualityStatus: approved ? 'approved' : 'rejected',
    rejectedReason: approved ? '' : quality.reasons.join(', '),
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
    initiatedBy = 'runtime',
    allowScraper = true,
    difficulty = ''
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

    let scrapeCandidates = [];
    let aiCandidates = [];

    if (allowScraper) {
      try {
        scrapeCandidates = await withTimeout(
          scraperProvider.scrapeQuestionsForTopic({
            topicKey: topic.topicKey,
            topicType: topic.topicType,
            count: missing
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
      questions: scrapeCandidates.filter((item) => {
        const confidenceScore = computeConfidenceScore({
          sourceType: 'scraped',
          question: item.question,
          answer: item.answer
        });
        const quality = validateInterviewQuestionQuality({
          ...item,
          topicKey: topic.topicKey,
          expectedDifficulty: difficulty,
          sourceType: 'scraped',
          confidenceScore,
          minimumScore: 0.8
        });
        return isQualityQuestionAnswer({ ...item, topicKey: topic.topicKey }) && quality.isValid;
      }),
      existingComparableQuestions
    });

    const remainingAfterScrape = Math.max(0, missing - dedupedScrape.length);

    if (remainingAfterScrape > 0) {
      try {
        aiCandidates = await aiProvider.generateQuestionsFromAI({
          topicKey: topic.topicKey,
          topicType: topic.topicType,
          query,
          difficulty,
          count: remainingAfterScrape
        });
      } catch (error) {
        logger.warn('interview-prep ai enrichment failed', {
          topicKey: topic.topicKey,
          message: error.message,
          initiatedBy
        });
      }
    }

    const validAi = dedupeQuestions({
      questions: aiCandidates.filter((item) => {
        const confidenceScore = computeConfidenceScore({
          sourceType: 'ai',
          question: item.question,
          answer: item.answer
        });
        const quality = validateInterviewQuestionQuality({
          ...item,
          topicKey: topic.topicKey,
          expectedDifficulty: difficulty,
          sourceType: 'ai',
          confidenceScore,
          minimumScore: 0.75
        });
        return isQualityQuestionAnswer({ ...item, topicKey: topic.topicKey }) && quality.isValid;
      }),
      existingComparableQuestions: [
        ...existingComparableQuestions,
        ...dedupedScrape.map((item) => normalizeComparableText(item.question))
      ]
    });

    const storable = [
      ...dedupedScrape.map((item) => toStorableRecord({
        item,
        topic,
        sourceType: 'scraped',
        sourceMeta: { query, initiatedBy, expectedDifficulty: difficulty },
        popularity: 12
      })),
      ...validAi.map((item) => toStorableRecord({
        item,
        topic,
        sourceType: 'ai',
        sourceMeta: { query, initiatedBy, expectedDifficulty: difficulty },
        popularity: 10
      }))
    ].filter((record) => record.isApproved && record.qualityStatus === 'approved');

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
