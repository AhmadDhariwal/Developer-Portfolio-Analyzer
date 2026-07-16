const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeQuestionText,
  sanitizeCategory,
  sanitizeDifficulty,
  normalizeQualityScore,
  computeJaccardSimilarity,
  dedupeQuestions,
  isQualityQuestionAnswer,
  validateInterviewQuestionQuality
} = require('../services/interviewQuestionQualityService');

test('normalizeQuestionText appends question mark when missing', () => {
  assert.equal(normalizeQuestionText('Explain closures'), 'Explain closures?');
  assert.equal(normalizeQuestionText('What is closure?'), 'What is closure?');
});

test('computeJaccardSimilarity returns high score for similar questions', () => {
  const a = 'How do closures work in JavaScript?';
  const b = 'How do closure functions work in JavaScript?';
  const similarity = computeJaccardSimilarity(a, b);
  assert.ok(similarity > 0.6);
});

test('dedupeQuestions removes exact and near duplicates', () => {
  const existing = ['what is closure in javascript'];
  const incoming = [
    { question: 'What is closure in JavaScript?', answer: 'A closure captures lexical scope.' },
    { question: 'Explain closures in JavaScript', answer: 'Closures retain access to outer scope values.' },
    { question: 'How does the event loop work in JavaScript?', answer: 'It schedules async callbacks with call stack and queues.' }
  ];

  const unique = dedupeQuestions({ questions: incoming, existingComparableQuestions: existing });
  assert.equal(unique.length, 1);
  assert.equal(unique[0].question, 'How does the event loop work in JavaScript?');
});

test('isQualityQuestionAnswer enforces minimum useful length', () => {
  assert.equal(isQualityQuestionAnswer({ question: 'What is JS?', answer: 'Good' }), false);
  assert.equal(isQualityQuestionAnswer({
    question: 'How would you optimize React rendering performance in a dashboard?',
    answer: 'I would profile rendering hotspots, memoize expensive computations, split large components, virtualize heavy lists, and validate improvements with production metrics.'
  }), true);
});

test('production category and difficulty sanitizers support ranked bank values', () => {
  assert.equal(sanitizeCategory('scenario_based'), 'real-world-scenarios');
  assert.equal(sanitizeCategory('system-design'), 'system-design');
  assert.equal(sanitizeDifficulty('senior'), 'senior');
  assert.equal(normalizeQualityScore(4), 80);
  assert.equal(normalizeQualityScore(93), 93);
});

test('validateInterviewQuestionQuality rejects placeholder or AI-disclaimer content', () => {
  const result = validateInterviewQuestionQuality({
    question: 'How does React state batching affect rendering behavior?',
    answer: 'As an AI language model, TODO placeholder answer for React rendering behavior.',
    topicKey: 'react',
    tags: ['react', 'state', 'rendering'],
    category: 'core-concepts'
  });

  assert.equal(result.isValid, false);
  assert.ok(result.reasons.includes('placeholder_or_weak_ai_content'));
});

test('validateInterviewQuestionQuality accepts a structured answer that uses different technical wording', () => {
  const result = validateInterviewQuestionQuality({
    question: 'How does event delegation work in JavaScript?',
    answer: 'A parent click handler inspects the originating element as events bubble through the DOM. This keeps dynamically rendered controls interactive while avoiding a separate listener for every child node.',
    answerSections: {
      shortAnswer: 'A parent handler uses event bubbling to handle child interactions.',
      explanation: 'The handler checks the originating DOM element and applies the matching behavior.'
    },
    topicKey: 'javascript',
    tags: ['javascript', 'dom'],
    category: 'core-concepts',
    sourceType: 'ai_generated',
    confidenceScore: 0.9,
    qualityScore: 80,
    minimumScore: 0.78
  });

  assert.equal(result.isValid, true);
  assert.equal(result.reasons.includes('answer_does_not_directly_address_question'), false);
});
