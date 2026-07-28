const test = require('node:test');
const assert = require('node:assert/strict');
const interviewPrepService = require('../services/interviewPrepService');
const aiProvider = require('../services/providers/interviewAIProvider');
const aiService = require('../services/aiservice');
const repository = require('../repositories/interviewQuestionRepository');
const { clearMemoryCache, getCacheJsonWithMeta, setCacheJson } = require('../services/redisCacheService');

const original = {
  answerSearchFallback: aiProvider.answerSearchFallback,
  runAIAnalysis: aiService.runAIAnalysis,
  findExactReusableQuestion: repository.findExactReusableQuestion,
  findSearchCandidates: repository.findSearchCandidates,
  findQuestionById: repository.findQuestionById,
  incrementQuestionUsage: repository.incrementQuestionUsage,
  upsertQuestions: repository.upsertQuestions
};

const isolatePipeline = () => {
  repository.findExactReusableQuestion = async () => null;
  repository.findSearchCandidates = async () => [];
  repository.findQuestionById = async () => null;
  repository.incrementQuestionUsage = async () => {};
};

test.afterEach(() => {
  Object.assign(aiProvider, { answerSearchFallback: original.answerSearchFallback });
  aiService.runAIAnalysis = original.runAIAnalysis;
  Object.assign(repository, {
    findExactReusableQuestion: original.findExactReusableQuestion,
    findSearchCandidates: original.findSearchCandidates,
    findQuestionById: original.findQuestionById,
    incrementQuestionUsage: original.incrementQuestionUsage,
    upsertQuestions: original.upsertQuestions
  });
  clearMemoryCache();
});

test('memory cache is the first layer and bypasses Redis', async () => {
  clearMemoryCache();
  const key = `interview:test:memory:${Date.now()}`;
  await setCacheJson(key, { ok: true }, 30);
  const result = await getCacheJsonWithMeta(key);
  assert.equal(result.layer, 'memory');
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.redisMs, 0);
});

test('five identical custom requests share one AI call and one persistence operation', async () => {
  clearMemoryCache();
  isolatePipeline();
  let aiCalls = 0;
  let persistenceCalls = 0;
  aiProvider.answerSearchFallback = async ({ question }) => {
    aiCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const answerSections = {
      shortAnswer: 'A microtask checkpoint drains queued promise reactions before the browser advances to the next task queue turn.',
      keyPoints: ['Microtasks drain after the current JavaScript stack', 'Tasks represent separate event-loop turns', 'Unbounded microtasks can delay rendering'],
      explanation: 'The browser runs one task, then performs a microtask checkpoint that drains promise callbacks and queueMicrotask work. Only after that checkpoint can rendering occur and the event loop select another task. This ordering makes microtasks useful for deterministic follow-up work but also creates starvation risk.',
      example: 'setTimeout(() => console.log("task")); Promise.resolve().then(() => console.log("microtask"));',
      realWorldUseCase: 'Framework schedulers use this ordering for batched state updates while yielding tasks for rendering and input.',
      commonMistakes: ['Treating microtasks as another timer queue', 'Recursively queuing microtasks and starving rendering'],
      interviewTip: 'State the stack, microtask checkpoint, render opportunity, and next-task order.'
    };
    return { question, answer: Object.values(answerSections).flat().join(' '), answerSections, difficulty: 'hard', category: 'conceptual', tags: ['javascript', 'event-loop', 'microtasks'], confidenceScore: 0.94, relevanceScore: 0.94, qualityScore: 94 };
  };
  repository.upsertQuestions = async () => {
    persistenceCalls += 1;
    return { insertedCount: 1, upsertedIds: ['test-id'] };
  };

  const input = { userId: 'user-a', topic: 'javascript', question: 'How do JavaScript microtask checkpoints differ from separate task queue turns?' };
  const results = await Promise.all(Array.from({ length: 5 }, () => interviewPrepService.answerCustomInterviewQuestion(input)));
  assert.equal(results.length, 5);
  assert.equal(aiCalls, 1);
  assert.equal(persistenceCalls, 1);
  assert.equal(results[0].performance.counts.ai, 1);
  assert.equal(results[0].performance.counts.persistence, 1);
});

test('controlled AI faults are rejected without persistence, cache contamination, or provider-detail leakage', async (t) => {
  const scenarios = [
    ['timeout', async () => { throw new Error('secret-provider timeout token=abc'); }],
    ['quota', async () => { throw new Error('provider quota account-id=private'); }],
    ['malformed', async () => ({ unexpected: 'not the answer schema' })],
    ['low-quality', async ({ question }) => ({
      question,
      answer: 'Define the concept and explain relevant behavior.',
      answerSections: { shortAnswer: 'Define the concept.', explanation: 'Explain relevant behavior.' },
      difficulty: 'medium', category: 'conceptual', tags: ['javascript'], confidenceScore: 0.3, relevanceScore: 0.2, qualityScore: 20
    })],
    ['generic-boilerplate', async ({ question }) => ({
      question,
      answer: 'Define the concept. Explain the relevant behavior. Provide an example and discuss tradeoffs.',
      answerSections: {
        shortAnswer: 'Define the concept and describe what it does.',
        keyPoints: ['Explain the relevant behavior', 'Provide an example', 'Discuss common tradeoffs'],
        explanation: 'Give a clear explanation that directly answers the interview question.',
        example: 'Provide a relevant example.',
        realWorldUseCase: 'Mention a real-world use case.',
        commonMistakes: ['Avoid vague answers', 'Do not omit details'],
        interviewTip: 'Keep the answer concise and specific.'
      },
      difficulty: 'medium', category: 'conceptual', tags: ['javascript'], confidenceScore: 0.95, relevanceScore: 0.95, qualityScore: 95
    })]
  ];

  for (const [name, fault] of scenarios) {
    await t.test(name, async () => {
      clearMemoryCache();
      isolatePipeline();
      let aiCalls = 0;
      let persistenceCalls = 0;
      aiProvider.answerSearchFallback = async (args) => { aiCalls += 1; return fault(args); };
      repository.upsertQuestions = async () => { persistenceCalls += 1; return { insertedCount: 1, upsertedIds: ['invalid'] }; };
      const input = { userId: 'user-a', topic: 'javascript', question: `How would JavaScript schedule isolated deterministic browser work for ${name} handling?` };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await interviewPrepService.answerCustomInterviewQuestion(input);
        assert.equal(result.sourceType, 'no_verified_answer');
        assert.equal(result.answer, 'No verified answer available.');
        assert.equal(result.stored, false);
        assert.equal(result.fromCache, false);
        assert.doesNotMatch(JSON.stringify(result), /secret-provider|token=|quota account|account-id/i);
      }
      assert.equal(aiCalls, 2, 'a rejected result must not be cached');
      assert.equal(persistenceCalls, 0, 'a rejected result must not be persisted');
    });
  }
});
test('provider accepts a complete structured AI answer and reports typed failures', async () => {
  const complete = {
    shortAnswer: 'An index accelerates data lookup, while a transaction groups operations into one atomic unit.',
    keyPoints: ['Indexes optimize reads through an auxiliary structure', 'Transactions guarantee atomicity and isolation', 'Indexes affect access paths whereas transactions protect state changes'],
    explanation: 'A database index stores searchable keys so the engine can avoid scanning every row. A transaction defines a boundary in which writes commit together or roll back together; it also provides isolation from concurrent work. They solve different problems and can be used together.',
    example: 'CREATE INDEX idx_email ON users(email); BEGIN; UPDATE accounts SET balance = balance - 10; COMMIT;',
    realWorldUseCase: 'Use an index for frequent email lookups and a transaction for a multi-step funds transfer.',
    commonMistakes: ['Assuming an index guarantees atomicity', 'Adding indexes without accounting for write overhead'],
    interviewTip: 'Contrast query access speed with correctness of a unit of work.',
    difficulty: 'medium', technology: 'mysql', topicKey: 'mysql', tags: ['mysql', 'index', 'transaction'], confidenceScore: 0.94, qualityScore: 94
  };
  aiService.runAIAnalysis = async () => ({ ok: true, value: complete, provider: 'mock', latencyMs: 10 });
  const accepted = await aiProvider.answerSearchFallback({ topicKey: 'mysql', question: 'What is the difference between an index and a transaction?' });
  assert.equal(accepted.answerSections.keyPoints.length, 3);
  assert.match(accepted.answer, /index/i);
  assert.match(accepted.answer, /transaction/i);

  aiService.runAIAnalysis = async () => ({ ok: true, value: { shortAnswer: 'incomplete' } });
  await assert.rejects(
    () => aiProvider.answerSearchFallback({ topicKey: 'mysql', question: 'What is the difference between an index and a transaction?' }),
    (error) => error.reasonCode === 'schema_rejected'
  );
  aiService.runAIAnalysis = async () => ({ ok: false, reason: 'invalid_json' });
  await assert.rejects(
    () => aiProvider.answerSearchFallback({ topicKey: 'mysql', question: 'What is the difference between an index and a transaction?' }),
    (error) => error.reasonCode === 'invalid_json'
  );
  aiService.runAIAnalysis = async () => ({ ok: false, reason: 'timeout' });
  await assert.rejects(
    () => aiProvider.answerSearchFallback({ topicKey: 'mysql', question: 'What is the difference between an index and a transaction?' }),
    (error) => error.reasonCode === 'provider_timeout'
  );
  aiService.runAIAnalysis = async () => ({ ok: false, reason: '429' });
  await assert.rejects(
    () => aiProvider.answerSearchFallback({ topicKey: 'mysql', question: 'What is the difference between an index and a transaction?' }),
    (error) => error.reasonCode === 'provider_error'
  );
});

test('verified fallback selection reports useful content or an honest missing result', () => {
  const found = interviewPrepService.buildAiFailurePayload({
    topicInput: { topicKey: 'oop', topicType: 'technology' },
    question: 'What is the difference between polymorphism and inheritance?'
  });
  assert.equal(found.sourceType, 'verified_seed');
  assert.match(found.answer, /inheritance/i);
  assert.match(found.answer, /polymorphism/i);

  const missing = interviewPrepService.buildAiFailurePayload({
    topicInput: { topicKey: 'mysql', topicType: 'technology' },
    question: 'How does a completely novel imaginary database mechanism behave?'
  });
  assert.equal(missing.sourceType, 'no_verified_answer');
  assert.equal(missing.answer, 'No verified answer available.');
});