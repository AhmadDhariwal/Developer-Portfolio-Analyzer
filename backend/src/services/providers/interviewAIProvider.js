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
    return {
      summary: normalizeAnswerText(answer).split(/[.!?]\s/)[0] || normalizeAnswerText(answer),
      explanation: normalizeAnswerText(answer),
      bulletPoints: [],
      codeExample: '',
      realWorldContext: ''
    };
  }

  const bulletPoints = Array.isArray(answer.bulletPoints)
    ? answer.bulletPoints.map((point) => normalizeAnswerText(point)).filter(Boolean).slice(0, 6)
    : [];

  return {
    summary: normalizeAnswerText(answer.summary || answer.directAnswer || ''),
    explanation: normalizeAnswerText(answer.explanation || ''),
    bulletPoints,
    codeExample: String(answer.codeExample || '').trim(),
    realWorldContext: normalizeAnswerText(answer.realWorldContext || answer.productionContext || '')
  };
};

const structuredAnswerToText = (answer = {}) => {
  const structured = normalizeStructuredAnswer(answer);
  return normalizeAnswerText([
    structured.summary ? `Summary: ${structured.summary}` : '',
    structured.explanation ? `Explanation: ${structured.explanation}` : '',
    structured.bulletPoints.length ? `Key points:\n${structured.bulletPoints.map((point) => `- ${point}`).join('\n')}` : '',
    structured.codeExample ? `Code example:\n${structured.codeExample}` : '',
    structured.realWorldContext ? `Real-world context: ${structured.realWorldContext}` : ''
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
      const answerSections = normalizeStructuredAnswer(item.answer || item.sampleAnswer || {});
      const answer = structuredAnswerToText(answerSections);
      return {
        question,
        answer,
        answerSections,
        category: sanitizeCategory(item.category),
        qualityScore: sanitizeQualityScore(item.qualityScore),
        difficulty: sanitizeDifficulty(item.difficulty),
        tags: sanitizeTags(item.tags)
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
    'Return ONLY a valid JSON array. Each object:',
    '{',
    "  question: 'the question text',",
    '  answer: {',
    "    summary: 'one sentence direct answer',",
    "    explanation: 'detailed 2-3 paragraph explanation',",
    "    bulletPoints: ['point1', 'point2', 'point3'],",
    "    codeExample: 'only if relevant, else empty string',",
    "    realWorldContext: 'how this works in production'",
    '  },',
    "  category: 'conceptual|scenario_based|code_output|best_practice|system_design|behavioral',",
    "  difficulty: 'easy|medium|hard',",
    '  qualityScore: number 1-5,',
    "  tags: ['tag1', 'tag2']",
    '}',
    'No markdown. No extra text. JSON array only.',
    `Every question and answer must reference concrete ${topicKey} concepts, APIs, patterns, failure modes, or production tradeoffs.`,
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
    '  answer: {',
    "    summary: 'one sentence direct answer',",
    "    explanation: 'detailed 2-3 paragraph explanation',",
    "    bulletPoints: ['point1', 'point2', 'point3'],",
    "    codeExample: 'only if relevant, else empty string',",
    "    realWorldContext: 'how this works in production'",
    '  },',
    "  category: 'conceptual|scenario_based|code_output|best_practice|system_design|behavioral',",
    "  difficulty: 'easy|medium|hard',",
    '  qualityScore: number 1-5,',
    "  tags: ['tag1', 'tag2']",
    '}',
    'No markdown. No extra text. JSON only.',
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
  "  summary: 'one sentence direct answer',",
  "  explanation: 'detailed explanation in 2-3 paragraphs',",
  "  bulletPoints: ['point1', 'point2', 'point3'],",
  "  codeExample: 'only if relevant, else empty string',",
  "  realWorldContext: 'production-level context'",
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
    tags: sanitizeTags(Array.isArray(result.tags) ? result.tags : fallbackTags)
  };
};

const generateQuestionsFromAI = async ({ topicKey, topicType, query = '', difficulty = '', count = 10 }) => {
  const prompt = buildQuestionGenerationPrompt({ topicKey, topicType, query, difficulty, count });
  const fallback = {
    questions: [
      {
        question: `How would you explain the core concepts of ${topicKey} in an interview?`,
        answer: {
          summary: `Explain the core ${topicKey} concepts clearly and connect them to practical engineering choices.`,
          explanation: `A strong answer should define the main ${topicKey} concepts, explain how they are used in real applications, and describe the tradeoffs that matter in production. Interviewers usually look for whether you can connect the concept to debugging, maintainability, performance, and team decision-making.`,
          bulletPoints: [`Define the primary ${topicKey} concept`, 'Explain when it is useful', 'Mention a production tradeoff'],
          codeExample: '',
          realWorldContext: `Production teams use ${topicKey} decisions to improve reliability, developer velocity, and runtime behavior.`
        },
        category: 'conceptual',
        qualityScore: 4,
        difficulty: 'medium',
        tags: [topicKey, topicType]
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
      summary: `Explain the relevant ${topicKey} concept precisely and relate it to real implementation choices.`,
      explanation: `A useful interview answer should define the concept, show how it behaves in practice, and explain the tradeoffs behind using it. For ${topicKey}, strong answers avoid generic theory and mention concrete APIs, patterns, or failure modes where possible.`,
      bulletPoints: ['Define the concept', 'Explain when to use it', 'Mention one tradeoff'],
      codeExample: '',
      realWorldContext: `In production, ${topicKey} choices affect reliability, performance, maintainability, and debugging workflows.`
    },
    category: 'conceptual',
    qualityScore: 4,
    difficulty: 'medium',
    tags: [topicKey, topicType, 'ai_generated']
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
