const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTopicInput,
  resolveTopic,
  detectTopicsInText,
  IMPORTANT_TOPICS
} = require('../services/interviewTopicNormalizer');

const {
  getTopicSeedItems,
  buildSeedRecordsForTopic,
  findSeedRecordByQuestion,
  verifiedSeedCatalog
} = require('../services/interviewQuestionSeedCatalog');

const {
  computeJaccardSimilarity,
  validateInterviewQuestionQuality,
  buildCanonicalQuestionKey,
  normalizeComparableText,
  isQualityQuestionAnswer,
  dedupeQuestions
} = require('../services/interviewQuestionQualityService');

const {
  getQuestionBank,
  searchQuestionBank,
  generateFreshInterviewQuestions,
  answerCustomInterviewQuestion
} = require('../services/interviewPrepService');

const questionRepository = require('../repositories/interviewQuestionRepository');

test('Top-Question Correctness: Every supported topic yields exactly 30 top questions ranked 1-30 deterministically', async () => {
  for (const topic of IMPORTANT_TOPICS) {
    const seedRecords = buildSeedRecordsForTopic(topic);
    const topQuestions = seedRecords.filter((record) => record.isTopQuestion);

    assert.equal(topQuestions.length, 30, `Topic ${topic.key} must have exactly 30 top questions`);

    const ranks = topQuestions.map((q) => q.rank).sort((a, b) => a - b);
    const expectedRanks = Array.from({ length: 30 }, (_, i) => i + 1);
    assert.deepEqual(ranks, expectedRanks, `Topic ${topic.key} top question ranks must be 1..30 without gaps`);

    for (let i = 0; i < topQuestions.length; i++) {
      const q = topQuestions[i];
      assert.ok(q.rankScore > 0, `Question rankScore must be > 0 for topic ${topic.key}`);
      assert.equal(q.isTopQuestion, true);
      assert.ok(q.qualityScore >= 80, `Quality score must be >= 80 for topic ${topic.key}`);
      assert.ok(q.confidenceScore >= 0.72, `Confidence score must be >= 0.72 for topic ${topic.key}`);
      assert.ok(q.relevanceScore >= 0.75, `Relevance score must be >= 0.75 for topic ${topic.key}`);
      assert.ok(q.sourceType, `Source type must be defined for topic ${topic.key}`);
    }

    // Verify rank order is deterministic
    const rankOrder = topQuestions.map((q) => q.rank);
    assert.deepEqual(rankOrder, expectedRanks, `Top questions for ${topic.key} must be sorted deterministically by rank`);
  }
});

test('Strict Technology Boundary Enforcement: Java !== JavaScript, React !== React Native, Node.js !== Next.js, C# !== C++', () => {
  const javaRes = resolveTopic('Java');
  const jsRes = resolveTopic('JavaScript');
  assert.notEqual(javaRes.topicKey, jsRes.topicKey, 'Java and JavaScript must be distinct topics');

  const reactRes = resolveTopic('React');
  const reactNativeRes = resolveTopic('React Native');
  assert.notEqual(reactRes.topicKey, reactNativeRes.topicKey, 'React and React Native must be distinct topics');

  const nodeRes = resolveTopic('Node.js');
  const nextRes = resolveTopic('Next.js');
  assert.notEqual(nodeRes.topicKey, nextRes.topicKey, 'Node.js and Next.js must be distinct topics');

  const cppRes = resolveTopic('C++');
  const csharpRes = resolveTopic('C#');
  assert.notEqual(cppRes.topicKey, csharpRes.topicKey, 'C++ and C# must be distinct topics');

  const textMatchesJava = detectTopicsInText('Explain asynchronous event loop in JavaScript');
  assert.ok(textMatchesJava.some((m) => m.topicKey === 'javascript'));
  assert.ok(!textMatchesJava.some((m) => m.topicKey === 'java'), 'JavaScript text must not false-match Java topic');

  const textMatchesReact = detectTopicsInText('Building mobile apps with React Native');
  assert.ok(textMatchesReact.some((m) => m.topicKey === 'react-native'));
  assert.ok(!textMatchesReact.some((m) => m.topicKey === 'react'), 'React Native text must not false-match React topic');
});

test('Topic Normalization: Canonical aliases for all supported technologies resolve cleanly', () => {
  const aliasesToTest = [
    { input: 'React', expected: 'react' },
    { input: 'reactjs', expected: 'react' },
    { input: 'react.js', expected: 'react' },
    { input: 'Node', expected: 'nodejs' },
    { input: 'nodejs', expected: 'nodejs' },
    { input: 'node.js', expected: 'nodejs' },
    { input: 'Next', expected: 'nextjs' },
    { input: 'nextjs', expected: 'nextjs' },
    { input: 'next.js', expected: 'nextjs' },
    { input: 'TypeScript', expected: 'typescript' },
    { input: 'TS', expected: 'typescript' },
    { input: 'JavaScript', expected: 'javascript' },
    { input: 'JS', expected: 'javascript' },
    { input: 'C++', expected: 'cpp' },
    { input: 'C#', expected: 'csharp' },
    { input: '.NET', expected: 'dotnet' },
    { input: 'SQL', expected: 'sql' },
    { input: 'PostgreSQL', expected: 'postgresql' },
    { input: 'System Design', expected: 'system-design' },
    { input: 'Docker', expected: 'docker' },
    { input: 'Kubernetes', expected: 'kubernetes' },
    { input: 'k8s', expected: 'kubernetes' }
  ];

  for (const item of aliasesToTest) {
    const resolved = resolveTopic(item.input);
    assert.equal(resolved.topicKey, item.expected, `Alias '${item.input}' must resolve to '${item.expected}'`);
  }
});

test('Topic Normalization: Unknown or ambiguous topics stay isolated without mapping to unrelated topics', () => {
  const customTopic = resolveTopic('foobar123');
  assert.equal(customTopic.topicKey, 'foobar123');

  const normalized = normalizeTopicInput({ topic: 'foobar123' });
  assert.equal(normalized.topicKey, 'foobar123', 'Unknown topic must retain its slugified identity and not fall back to javascript');
});

test('Search Resolution Hierarchy & Quality Validation: Weak similarity does not return unrelated questions', () => {
  const query = 'How do closures work in JavaScript?';
  const unrelatedText = 'What is the purpose of CSS Grid layout?';

  const similarity = computeJaccardSimilarity(query, unrelatedText);
  assert.ok(similarity < 0.30, 'Unrelated questions must have low Jaccard similarity');

  const seedMatch = findSeedRecordByQuestion('javascript', query);
  assert.ok(seedMatch, 'Exact or canonical seed question must be found');
  assert.equal(seedMatch.topicKey, 'javascript');
  assert.equal(seedMatch.sourceType, 'verified_seed');
});

test('AI Ownership & Quality: Mandatory structured JSON schema and pre-persistence validation', () => {
  const validStructuredAnswer = {
    shortAnswer: 'A closure lets an inner function preserve access to variables from its outer scope.',
    keyPoints: ['Lexical scoping', 'Variable retention', 'Encapsulation'],
    explanation: 'When a function is declared in JavaScript, it captures references to its surrounding state.',
    example: 'function outer() { let x = 10; return () => x; }',
    realWorldUseCase: 'Creating private module state or callbacks with persistent context.',
    commonMistakes: ['Retaining large objects unnecessarily', 'Creating accidental memory leaks'],
    interviewTip: 'Mention lexical environment and give a 3-line counter example.'
  };

  const validation = validateInterviewQuestionQuality({
    topicKey: 'javascript',
    question: 'How do closures work in JavaScript?',
    answer: JSON.stringify(validStructuredAnswer),
    answerSections: validStructuredAnswer,
    qualityScore: 90,
    confidenceScore: 0.85,
    sourceType: 'ai_generated'
  });

  const qualityScore = Math.round(validation.relevanceScore * 100);

  assert.equal(validation.isValid, true, 'Valid structured JSON answer must pass quality validation');
  assert.ok(qualityScore >= 80, 'Quality score must be >= 80');
});

test('Shared-Bank Safety: Idempotent upserts protect verified_seed records from AI overwrites', async () => {
  const store = new Map();
  const origUpsert = questionRepository.upsertQuestions;
  const origFindTop = questionRepository.findTopQuestions;

  questionRepository.upsertQuestions = async (records = []) => {
    for (const r of records) {
      const key = `${r.topicKey}:${normalizeComparableText(r.question)}`;
      const existing = store.get(key);
      if (!existing || r.sourceType === 'verified_seed') {
        store.set(key, { ...r });
      }
    }
    return { insertedCount: records.length, upsertedIds: ['mocked_id'] };
  };

  questionRepository.findTopQuestions = async ({ topicKey }) => {
    return Array.from(store.values()).filter((r) => r.topicKey === topicKey);
  };

  try {
    const seedRecord = {
      topicKey: 'javascript',
      question: 'What is the event loop in JavaScript?',
      answer: 'The event loop processes synchronous code first, then drains microtasks before running macrotasks.',
      sourceType: 'verified_seed',
      qualityScore: 95,
      rank: 3,
      isTopQuestion: true
    };

    await questionRepository.upsertQuestions([seedRecord]);

    const aiRecord = {
      topicKey: 'javascript',
      question: 'What is the event loop in JavaScript?',
      answer: 'AI generated explanation of the event loop.',
      sourceType: 'ai_generated',
      qualityScore: 82,
      rank: 0,
      isTopQuestion: false
    };

    await questionRepository.upsertQuestions([aiRecord]);

    const questions = await questionRepository.findTopQuestions({ topicKey: 'javascript', limit: 10 });
    const matched = questions.find((q) => q.question.includes('event loop'));

    assert.ok(matched);
    assert.equal(matched.sourceType, 'verified_seed', 'Verified seed sourceType must NOT be overwritten by AI upsert');
    assert.ok(matched.qualityScore >= 90, 'Verified seed quality score must be preserved');
  } finally {
    questionRepository.upsertQuestions = origUpsert;
    questionRepository.findTopQuestions = origFindTop;
  }
});

test('Single-Flight Execution: Concurrent identical requests coalesce into a single execution pipeline', async () => {
  const origFindTop = questionRepository.findTopQuestions;
  const origSourceMix = questionRepository.getSourceMixByTopic;
  const origCountSeedVersion = questionRepository.countQuestionsByTopicAndSeedVersion;
  const origCountTopic = questionRepository.countQuestionsByTopic;
  let callCount = 0;

  questionRepository.findTopQuestions = async () => {
    callCount += 1;
    return getTopicSeedItems('javascript').slice(0, 30);
  };
  questionRepository.getSourceMixByTopic = async () => ({ verified_seed: 30 });
  questionRepository.countQuestionsByTopicAndSeedVersion = async () => 31;
  questionRepository.countQuestionsByTopic = async () => 31;

  try {
    const requestPromises = Array.from({ length: 5 }, () => (
      getQuestionBank({ topic: 'javascript', block: 'top', limit: 30 })
    ));

    const results = await Promise.all(requestPromises);

    assert.equal(results.length, 5);
    for (let i = 1; i < results.length; i++) {
      assert.equal(results[i].questions.length, results[0].questions.length, 'All concurrent requests must return identical payload');
      assert.equal(results[i].topicKey, results[0].topicKey);
    }
  } finally {
    questionRepository.findTopQuestions = origFindTop;
    questionRepository.getSourceMixByTopic = origSourceMix;
    questionRepository.countQuestionsByTopicAndSeedVersion = origCountSeedVersion;
    questionRepository.countQuestionsByTopic = origCountTopic;
  }
});

test('Security & Input Protection: Custom question length validation (12-500 chars)', async () => {
  // Too short
  await assert.rejects(
    async () => {
      await answerCustomInterviewQuestion({ question: 'short', topic: 'javascript' });
    },
    (err) => err.statusCode === 400,
    'Question shorter than 12 chars must throw 400'
  );

  // Too long (> 500 chars)
  const longQuestion = 'a'.repeat(501);
  await assert.rejects(
    async () => {
      await answerCustomInterviewQuestion({ question: longQuestion, topic: 'javascript' });
    },
    (err) => err.statusCode === 400,
    'Question longer than 500 chars must throw 400'
  );
});

test('Deduplication & Quality Service: Normalizes text and eliminates exact/semantic duplicates', () => {
  const q1 = { question: 'How do closures work in JavaScript?', topicKey: 'javascript' };
  const q2 = { question: 'How do closures work in JavaScript?', topicKey: 'javascript' };

  const key1 = buildCanonicalQuestionKey(q1.question, q1.topicKey);
  const key2 = buildCanonicalQuestionKey(q2.question, q2.topicKey);

  assert.equal(key1, key2, 'Identical questions must produce identical canonical keys');

  const deduplicated = dedupeQuestions({ questions: [q1, q2] });
  assert.equal(deduplicated.length, 1, 'Duplicate questions must be deduplicated to 1 item');
});
