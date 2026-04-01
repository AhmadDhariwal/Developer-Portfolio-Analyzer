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

const buildQuestionGenerationPrompt = ({ topicKey, topicType, query = '', count = 10 }) => {
  return [
    'You are an expert interview coach.',
    `Generate ${count} high-quality interview question and answer pairs for topic: ${topicKey}.`,
    `Topic type: ${topicType}.`,
    'Return valid JSON only with this shape: {"questions":[{"question":"...","answer":"...","difficulty":"easy|medium|hard","tags":["..."]}]}.',
    'Each answer must be practical, concise, and include reasoning or an example.',
    'Avoid duplicate questions and avoid trivial one-line answers.',
    query ? `Focus context: ${query}` : 'Cover fundamentals and advanced topics with balanced difficulty.'
  ].join('\n');
};

const buildCustomAnswerPrompt = ({ topicKey, topicType, question = '' }) => {
  return [
    'You are an expert technical interview coach.',
    `Topic: ${topicKey} (${topicType}).`,
    `Candidate question: ${question}`,
    'Return valid JSON only with this shape:',
    '{"question":"...","answer":"...","difficulty":"easy|medium|hard","tags":["..."]}',
    'Provide a clear and practical answer with one short example when relevant.'
  ].join('\n');
};

const generateQuestionsFromAI = async ({ topicKey, topicType, query = '', count = 10 }) => {
  const prompt = buildQuestionGenerationPrompt({ topicKey, topicType, query, count });
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
    answer: `Start with the definition in ${topicKey}, explain implementation steps, tradeoffs, and provide one practical example.`,
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
