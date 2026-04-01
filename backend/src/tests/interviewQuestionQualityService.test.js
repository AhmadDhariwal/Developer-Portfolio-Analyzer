const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeQuestionText,
  computeJaccardSimilarity,
  dedupeQuestions,
  isQualityQuestionAnswer
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
