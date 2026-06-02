const aiService = require('../aiservice');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags
} = require('../interviewQuestionQualityService');

const VALID_CATEGORIES = new Set([
  'conceptual',
  'scenario_based',
  'code_output',
  'best_practice',
  'system_design',
  'behavioral'
]);

const normalizeStructuredAnswer = (answer = {}) => {
  if (typeof answer === 'string') {
    const shortAnswer = normalizeAnswerText(answer).split(/[.!?]\s/)[0] || normalizeAnswerText(answer);
    return {
      shortAnswer,
      summary: shortAnswer,
      explanation: normalizeAnswerText(answer),
      keyPoints: [],
      bulletPoints: [],
      example: '',
      codeExample: '',
      realWorldUseCase: '',
      realWorldContext: '',
      commonMistakes: [],
      interviewTip: ''
    };
  }

  const bulletPoints = Array.isArray(answer.keyPoints)
    ? answer.keyPoints
    : Array.isArray(answer.bulletPoints)
      ? answer.bulletPoints
      : [];
  const commonMistakes = Array.isArray(answer.commonMistakes)
    ? answer.commonMistakes.map((point) => normalizeAnswerText(point)).filter(Boolean).slice(0, 5)
    : [];

  const shortAnswer = normalizeAnswerText(answer.shortAnswer || answer.summary || answer.directAnswer || '');
  const keyPoints = bulletPoints.map((point) => normalizeAnswerText(point)).filter(Boolean).slice(0, 6);
  const example = String(answer.example || answer.codeExample || '').trim();
  const realWorldUseCase = normalizeAnswerText(answer.realWorldUseCase || answer.realWorldContext || answer.productionContext || '');

  return {
    shortAnswer,
    summary: shortAnswer,
    explanation: normalizeAnswerText(answer.explanation || ''),
    keyPoints,
    bulletPoints: keyPoints,
    example,
    codeExample: example,
    realWorldUseCase,
    realWorldContext: realWorldUseCase,
    commonMistakes,
    interviewTip: normalizeAnswerText(answer.interviewTip || '')
  };
};

const structuredAnswerToText = (answer = {}) => {
  const structured = normalizeStructuredAnswer(answer);
  return normalizeAnswerText([
    structured.shortAnswer ? `Short answer: ${structured.shortAnswer}` : '',
    structured.keyPoints.length ? `Key points:\n${structured.keyPoints.map((point) => `- ${point}`).join('\n')}` : '',
    structured.explanation ? `Explanation: ${structured.explanation}` : '',
    structured.example ? `Example:\n${structured.example}` : '',
    structured.realWorldUseCase ? `Real-world use case: ${structured.realWorldUseCase}` : '',
    structured.commonMistakes?.length ? `Common mistakes:\n${structured.commonMistakes.map((point) => `- ${point}`).join('\n')}` : '',
    structured.interviewTip ? `Interview tip: ${structured.interviewTip}` : ''
  ].filter(Boolean).join('\n\n'));
};

const sanitizeCategory = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_CATEGORIES.has(normalized) ? normalized : 'conceptual';
};

const sanitizeQualityScore = (value = 4) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 4;
  return Math.min(5, Math.max(1, Math.round(numeric)));
};

const normalizeArray = (questions = []) => {
  const safe = Array.isArray(questions) ? questions : [];
  return safe
    .map((item, idx) => {
      const question = normalizeQuestionText(item.question || item.title || `Interview question ${idx + 1}`);
      const answerSections = normalizeStructuredAnswer(item.answer || item.sampleAnswer || item);
      const answer = structuredAnswerToText(answerSections);
      return {
        question,
        answer,
        answerSections,
        category: sanitizeCategory(item.category),
        qualityScore: sanitizeQualityScore(item.qualityScore),
        difficulty: sanitizeDifficulty(item.difficulty),
        tags: sanitizeTags(item.tags),
        confidenceScore: Number(item.confidenceScore || 0)
      };
    })
    .filter((item) => item.question && item.answer);
};

const buildQuestionGenerationPrompt = ({ topicKey, topicType, query = '', difficulty = '', count = 10 }) => {
  const difficultyRules = [
    'Difficulty standards:',
    'easy = definitions, basic concepts, syntax, and beginner examples only.',
    'medium = practical usage, tradeoffs, debugging, common patterns, and real-world scenarios.',
    'hard = internals, architecture, performance, scaling, advanced edge cases, and system-level reasoning.',
    'Do not return hard questions for easy difficulty.'
  ].join('\n');

  return [
    'You are a senior software engineer creating interview questions.',
    `Skill: ${topicKey}, Topic: ${query || topicKey}`,
    `Generate ${count} interview questions.`,
    'Return ONLY a valid JSON array. Each object must use exactly this schema:',
    '{',
    "  question: 'technology-specific interview question',",
    "  shortAnswer: 'one sentence direct answer',",
    "  keyPoints: ['point1', 'point2', 'point3'],",
    "  explanation: 'detailed 2-3 paragraph explanation',",
    "  example: 'specific code/config/example if relevant, else empty string',",
    "  realWorldUseCase: 'how this applies in production',",
    "  commonMistakes: ['mistake1', 'mistake2'],",
    "  interviewTip: 'one concise interview tip',",
    "  difficulty: 'easy|medium|hard',",
    `  technology: '${topicKey}',`,
    `  topicKey: '${topicKey}',`,
    "  tags: ['tag1', 'tag2'],",
    '  confidenceScore: number between 0 and 1',
    '}',
    'No markdown. No extra text. JSON array only.',
    `Every question and answer must reference concrete ${topicKey} concepts, APIs, patterns, failure modes, or production tradeoffs.`,
    `Reject generic questions that could apply to a different technology.`,
    difficultyRules,
    difficulty ? `Target difficulty: ${difficulty}.` : 'Use balanced difficulty levels.',
    `Topic type: ${topicType}.`
  ].join('\n');
};

const buildCustomAnswerPrompt = ({ topicKey, topicType, question = '' }) => {
  return [
    'You are a senior software engineer being asked an interview question.',
    `Skill: ${topicKey}, Topic: ${topicKey}`,
    `Question: ${question}`,
    'Return ONLY valid JSON:',
    '{',
    "  question: 'repeat the exact user question',",
    "  shortAnswer: 'one sentence direct answer to the exact question',",
    "  keyPoints: ['point1', 'point2', 'point3'],",
    "  explanation: 'detailed 2-3 paragraph explanation',",
    "  example: 'specific code/config/example if relevant, else empty string',",
    "  realWorldUseCase: 'how this applies in production',",
    "  commonMistakes: ['mistake1', 'mistake2'],",
    "  interviewTip: 'one concise interview tip',",
    "  difficulty: 'easy|medium|hard',",
    `  technology: '${topicKey}',`,
    `  topicKey: '${topicKey}',`,
    "  tags: ['tag1', 'tag2'],",
    '  confidenceScore: number between 0 and 1',
    '}',
    'No markdown. No extra text. JSON only.',
    `The answer must directly answer the exact question and mention concrete ${topicKey} concepts.`,
    `Topic type: ${topicType}.`
  ].join('\n');
};

const buildEnrichmentPrompt = ({ question = '', currentAnswer = '' }) => [
  'You are a senior software engineer.',
  'Expand this interview question answer into a structured format.',
  `Question: ${question}`,
  `Current answer: ${currentAnswer}`,
  'Return ONLY valid JSON:',
  '{',
  "  shortAnswer: 'one sentence direct answer',",
  "  explanation: 'detailed explanation in 2-3 paragraphs',",
  "  keyPoints: ['point1', 'point2', 'point3'],",
  "  example: 'only if relevant, else empty string',",
  "  realWorldUseCase: 'production-level context',",
  "  commonMistakes: ['mistake1', 'mistake2'],",
  "  interviewTip: 'one concise interview tip'",
  '}',
  'No markdown. No extra text. JSON only.'
].join('\n');

const normalizeGeneratedResult = ({ result = {}, fallbackQuestion = '', fallbackTags = [] }) => {
  const answerSections = normalizeStructuredAnswer(result.answer || result);
  return {
    question: normalizeQuestionText(result.question || fallbackQuestion),
    answer: structuredAnswerToText(answerSections),
    answerSections,
    category: sanitizeCategory(result.category),
    qualityScore: sanitizeQualityScore(result.qualityScore),
    difficulty: sanitizeDifficulty(result.difficulty || 'medium'),
    tags: sanitizeTags(Array.isArray(result.tags) ? result.tags : fallbackTags),
    confidenceScore: Number(result.confidenceScore || 0)
  };
};

const generateQuestionsFromAI = async ({ topicKey, topicType, query = '', difficulty = '', count = 10 }) => {
  const prompt = buildQuestionGenerationPrompt({ topicKey, topicType, query, difficulty, count });
  const fallback = {
    questions: [
      {
        question: `How would you explain the core concepts of ${topicKey} in an interview?`,
        answer: {
          shortAnswer: `Explain the core ${topicKey} concepts clearly and connect them to practical engineering choices.`,
          explanation: `A strong answer should define the main ${topicKey} concepts, explain how they are used in real applications, and describe the tradeoffs that matter in production. Interviewers usually look for whether you can connect the concept to debugging, maintainability, performance, and team decision-making.`,
          keyPoints: [`Define the primary ${topicKey} concept`, 'Explain when it is useful', 'Mention a production tradeoff'],
          example: '',
          realWorldUseCase: `Production teams use ${topicKey} decisions to improve reliability, developer velocity, and runtime behavior.`,
          commonMistakes: ['Giving a generic answer without technology-specific details'],
          interviewTip: `Name concrete ${topicKey} APIs or patterns when possible.`
        },
        category: 'conceptual',
        qualityScore: 4,
        difficulty: 'medium',
        tags: [topicKey, topicType],
        confidenceScore: 0.78
      }
    ]
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  const rawQuestions = Array.isArray(result)
    ? result
    : Array.isArray(result.questions)
      ? result.questions
      : fallback.questions;
  return normalizeArray(rawQuestions);
};

const answerCustomQuestionFromAI = async ({ topicKey, topicType, question }) => {
  const prompt = buildCustomAnswerPrompt({ topicKey, topicType, question });
  const fallback = {
    answer: {
      shortAnswer: `Explain the relevant ${topicKey} concept precisely and relate it to real implementation choices.`,
      explanation: `A useful interview answer should define the concept, show how it behaves in practice, and explain the tradeoffs behind using it. For ${topicKey}, strong answers avoid generic theory and mention concrete APIs, patterns, or failure modes where possible.`,
      keyPoints: ['Define the concept', 'Explain when to use it', 'Mention one tradeoff'],
      example: '',
      realWorldUseCase: `In production, ${topicKey} choices affect reliability, performance, maintainability, and debugging workflows.`,
      commonMistakes: ['Answering with generic theory instead of technology-specific details'],
      interviewTip: `Tie the answer to concrete ${topicKey} behavior.`
    },
    category: 'conceptual',
    qualityScore: 4,
    difficulty: 'medium',
    tags: [topicKey, topicType, 'ai_generated'],
    confidenceScore: 0.78
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  return normalizeGeneratedResult({
    result: { ...result, question },
    fallbackQuestion: question,
    fallbackTags: fallback.tags
  });
};

const enrichAnswerToStructured = async ({ question, currentAnswer }) => {
  const prompt = buildEnrichmentPrompt({ question, currentAnswer });
  const fallback = normalizeStructuredAnswer(currentAnswer);
  const result = await aiService.runAIAnalysis(prompt, fallback);
  return normalizeStructuredAnswer(result);
};

const answerSearchFallback = async ({ skill, topicKey, question }) => {
  return answerCustomQuestionFromAI({
    topicKey: topicKey || skill,
    topicType: 'technology',
    question
  });
};

const generateStructuredQuestionSet = async ({ skill, topic = '', difficulty = '', count = 10 }) => (
  generateQuestionsFromAI({
    topicKey: skill,
    topicType: 'technology',
    query: topic,
    difficulty,
    count
  })
);

const toStructuredAnswerText = (answer) => structuredAnswerToText(answer);

const normalizeAnswerShape = (answer) => normalizeStructuredAnswer(answer);

const normalizeCategory = (value) => sanitizeCategory(value);

const normalizeQualityScore = (value) => sanitizeQualityScore(value);

module.exports = {
  generateQuestionsFromAI,
  answerCustomQuestionFromAI,
  enrichAnswerToStructured,
  answerSearchFallback,
  generateStructuredQuestionSet,
  toStructuredAnswerText,
  normalizeAnswerShape,
  normalizeCategory,
  normalizeQualityScore
};
