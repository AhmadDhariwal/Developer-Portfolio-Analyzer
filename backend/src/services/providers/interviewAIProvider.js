const aiService = require('../aiservice');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags
} = require('../interviewQuestionQualityService');

const normalizeArray = (questions = []) => {
  const safe = Array.isArray(questions) ? questions : [];
  return safe
    .map((item, idx) => {
      const question = normalizeQuestionText(item.question || item.title || `Interview question ${idx + 1}`);
      const answer = normalizeAnswerText(item.answer || item.sampleAnswer || 'Explain the concept, practical usage, and tradeoffs with a real-world example.');
      return {
        question,
        answer,
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
    'You are an expert interview coach.',
    `Generate ${count} high-quality interview question and answer pairs for topic: ${topicKey}.`,
    `Topic type: ${topicType}.`,
    'Return valid JSON only with this shape: {"questions":[{"question":"...","answer":"...","difficulty":"easy|medium|hard","tags":["..."]}]}.',
    'Each answer must use labeled sections: Short direct answer, Key points, Explanation, Example, Real-world use case, Common mistakes, Interview tip.',
    `Every question and answer must reference concrete ${topicKey} concepts, APIs, patterns, failure modes, or production tradeoffs.`,
    'Each answer must be practical, concise, and include reasoning or an example.',
    'Avoid duplicate questions and avoid trivial one-line answers.',
    difficultyRules,
    difficulty ? `Target difficulty: ${difficulty}.` : 'Use balanced difficulty levels.',
    query ? `Focus context: ${query}` : 'Cover fundamentals and advanced topics.'
  ].join('\n');
};

const buildCustomAnswerPrompt = ({ topicKey, topicType, question = '' }) => {
  return [
    'You are an expert technical interview coach.',
    `Topic: ${topicKey} (${topicType}).`,
    `Candidate question: ${question}`,
    'Return valid JSON only with this shape:',
    '{"question":"...","answer":"...","difficulty":"easy|medium|hard","tags":["..."]}',
    'The answer must use these exact labeled sections: Short direct answer, Key points, Explanation, Example, Real-world use case, Common mistakes, Interview tip.',
    'Key points must be short bullet-style lines. Include code in Example when the question is implementation-focused.',
    'Keep it specific and technically accurate; do not return a plain paragraph.'
  ].join('\n');
};

const generateQuestionsFromAI = async ({ topicKey, topicType, query = '', difficulty = '', count = 10 }) => {
  const prompt = buildQuestionGenerationPrompt({ topicKey, topicType, query, difficulty, count });
  const fallback = {
    questions: [
      {
        question: `How would you explain the core concepts of ${topicKey} in an interview?`,
        answer: `Define the fundamentals of ${topicKey}, explain when to use it, discuss tradeoffs, and share one production-style example.`,
        difficulty: 'medium',
        tags: [topicKey, topicType]
      }
    ]
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  return normalizeArray(result.questions);
};

const answerCustomQuestionFromAI = async ({ topicKey, topicType, question }) => {
  const prompt = buildCustomAnswerPrompt({ topicKey, topicType, question });
  const fallback = {
    question: normalizeQuestionText(question),
    answer: `Short direct answer: Explain the relevant ${topicKey} concept precisely.\nKey points: - Define the concept.\n- Explain when to use it.\n- Mention one tradeoff.\nExplanation: Describe how it works and why it matters in interviews.\nExample: Show a concise implementation-oriented example when relevant.\nReal-world use case: Connect it to production work.\nCommon mistakes: Mention one failure mode.\nInterview tip: State the design choice and why it fits.`,
    difficulty: 'medium',
    tags: [topicKey, topicType, 'ai_generated']
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  return {
    question: normalizeQuestionText(result.question || question),
    answer: normalizeAnswerText(result.answer || fallback.answer),
    difficulty: sanitizeDifficulty(result.difficulty || 'medium'),
    tags: sanitizeTags(Array.isArray(result.tags) ? result.tags : fallback.tags)
  };
};

module.exports = {
  generateQuestionsFromAI,
  answerCustomQuestionFromAI
};
