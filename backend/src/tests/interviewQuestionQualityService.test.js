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

test('semantic validation rejects the reproduced inheritance versus polymorphism boilerplate', () => {
  const result = validateInterviewQuestionQuality({
    question: 'What is the difference between polymorphism and inheritance?',
    answer: 'Explain the relevant OOP concept precisely. Define the concept, explain when to use it, and mention one tradeoff.',
    answerSections: { shortAnswer: 'Define the concept.', explanation: 'Explain relevant OOP behavior.' },
    topicKey: 'oop', tags: ['oop'], sourceType: 'user_asked', confidenceScore: 0.9, qualityScore: 90, minimumScore: 0.78
  });
  assert.equal(result.isValid, false);
  assert.ok(result.reasons.includes('placeholder_or_weak_ai_content'));
  assert.ok(result.reasons.includes('comparison_missing_main_concept'));
});

test('semantic validation accepts a complete inheritance versus polymorphism comparison', () => {
  const result = validateInterviewQuestionQuality({
    question: 'What is the difference between polymorphism and inheritance?',
    answer: 'Inheritance creates an is-a relationship where a subclass receives and specializes parent behavior, whereas polymorphism lets callers use one contract with multiple implementations. For example, Circle and Rectangle may inherit Shape and each implement area(). Use inheritance for a genuine stable hierarchy; use interface-based polymorphism when implementations must be substitutable. The tradeoff is that inheritance couples subclasses to a base class, while polymorphism through composition adds indirection but stays more flexible.',
    answerSections: { shortAnswer: 'Inheritance reuses a hierarchy; polymorphism varies implementations behind one contract.', explanation: 'Both can coexist without being the same mechanism.', example: 'Shape s = new Circle(); s.area();', realWorldUseCase: 'Selecting interchangeable payment providers behind one interface.' },
    topicKey: 'oop', tags: ['oop', 'inheritance', 'polymorphism'], sourceType: 'ai_generated', confidenceScore: 0.9, qualityScore: 92, minimumScore: 0.78
  });
  assert.equal(result.isValid, true, result.reasons.join(','));
});

test('semantic regressions reject generic and cross-topic answers', () => {
  const cases = [
    ['How does inheritance work in Java?', 'JavaScript uses prototypes to share behavior between objects.', 'java', 'answer_topic_contradiction'],
    ['How does React reconciliation work?', 'React Native renders native mobile views and uses a bridge.', 'react', 'answer_topic_contradiction'],
    ['How does the Node.js event loop work?', 'Next.js provides server rendering and route handlers.', 'nodejs', 'answer_topic_contradiction'],
    ['What does a SQL JOIN do?', 'Define the concept and explain relevant SQL behavior.', 'sql', 'placeholder_or_weak_ai_content'],
    ['How does React reconciliation work?', 'A useful interview answer should define the concept and mention one tradeoff.', 'react', 'placeholder_or_weak_ai_content']
  ];
  for (const [question, answer, topicKey, reason] of cases) {
    const result = validateInterviewQuestionQuality({ question, answer, answerSections: { shortAnswer: answer, explanation: answer }, topicKey, tags: [topicKey], sourceType: 'ai_generated', confidenceScore: 0.9, qualityScore: 90, minimumScore: 0.78 });
    assert.equal(result.isValid, false, question);
    assert.ok(result.reasons.includes(reason), `${question}: ${result.reasons.join(',')}`);
  }
});
test('comparison validation accepts semantic tradeoffs without requiring the literal word tradeoff', () => {
  const result = validateInterviewQuestionQuality({
    question: 'What is the difference between Java and JavaScript?',
    answer: 'Java is a statically typed language compiled to JVM bytecode, while JavaScript is dynamically typed and normally executed by a browser or JavaScript runtime. Java compile-time checks catch many type errors earlier; JavaScript permits faster iteration but moves more checks to runtime. For example, a Java service declares parameter types whereas a JavaScript function can accept values dynamically. Java is common for large backend systems, while JavaScript is the browser language and also powers Node.js services.',
    answerSections: {
      shortAnswer: 'Java and JavaScript are separate languages with different type systems and runtimes.',
      keyPoints: ['Java uses static typing', 'JavaScript uses dynamic typing', 'Their runtimes and primary ecosystems differ'],
      explanation: 'Compile-time checking and runtime flexibility lead to different engineering choices.',
      example: 'Java declares String name; JavaScript uses const name.',
      realWorldUseCase: 'Java commonly powers enterprise services while JavaScript powers browsers and Node.js.',
      commonMistakes: ['Assuming JavaScript is a Java variant', 'Ignoring runtime and type-system differences'],
      interviewTip: 'Compare typing, runtime, ecosystem, and use cases.'
    },
    topicKey: 'javascript', tags: ['javascript', 'java', 'comparison'], sourceType: 'ai_generated', confidenceScore: 0.9, qualityScore: 90, minimumScore: 0.78
  });
  assert.equal(result.isValid, true, result.reasons.join(','));
  assert.equal(result.reasons.includes('comparison_missing_tradeoff'), false);
});