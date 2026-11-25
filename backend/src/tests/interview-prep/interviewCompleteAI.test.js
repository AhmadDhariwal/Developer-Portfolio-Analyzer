const { certified, judgeResult } = require('../fixtures/interviewCoverageFixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../../modules/interview-prep/services/interviewPrepService');
const repository = require('../../modules/interview-prep/repositories/interviewQuestionRepository');
const provider = require('../../modules/interview-prep/providers/interviewAIProvider');
const aiService = require('../../core/ai/aiservice');
const coordination = require('../../modules/interview-prep/services/interviewCoordinationService');
const manager = require('../../core/ai/aiProviderManager');
const admission = require('../../core/ai/aiProviderAdmissionService');
const Session = require('../../modules/interview-prep/models/interviewPrepSession');
const sessions = require('../../modules/interview-prep/services/interviewSessionService');
const cache = require('../../core/cache/redisCacheService');
const { listImportantTopics } = require('../../modules/interview-prep/services/interviewTopicNormalizer');
const { SYSTEM_DESIGN_FIELDS, validateGeneratedQuestion } = require('../../modules/interview-prep/services/interviewAIValidation');
const { summarizeCoverage } = require('../../modules/interview-prep/services/interviewCoverageService');

const row = (
  topicKey = 'mern',
  difficulty = 'easy',
  question = `What is the basic purpose of ${topicKey} application components?`
) => {
  const answerSections = {
    shortAnswer: `${topicKey} application components separate responsibilities into modules with explicit interfaces.`,
    keyPoints: [
      'Define each responsibility',
      'Pass data through explicit interfaces',
      'Test behavior at module boundaries'
    ],
    explanation: `${topicKey} components encapsulate behavior and data. A caller uses an explicit interface to request work. Each module can be understood through its inputs and outputs; separating responsibilities makes it easier to test and change an application.`,
    example: 'const response = await api.get("/items");\nrender(response.items);',
    realWorldUseCase: `A ${topicKey} application can keep rendering separate from data access.`,
    commonMistakes: ['Sharing mutable data implicitly', 'Mixing unrelated responsibilities'],
    interviewTip: 'Describe an interface and trace a small input through it.'
  };
  return {
    question,
    topicKey,
    difficulty,
    answer: provider.toStructuredAnswerText(answerSections),
    answerSections,
    tags: [topicKey],
    category: 'core-concepts',
    qualityScore: 90,
    confidenceScore: 0.9,
    sourceType: 'ai_generated'
  };
};
const propsSections = () => ({
  ...row('react').answerSections,
  shortAnswer: 'React components receive read-only props from a parent component.',
  explanation:
    'A parent passes props as JSX attributes when rendering a child component. The child reads these values from its props argument. Updating parent state can produce new props and rerender the child; the child should not mutate the input.'
});
const isolate = (t) => {
  cache.clearMemoryCache();
  t.mock.method(repository, 'findAllQuestionsPage', async () => ({ questions: [], total: 0 }));
  t.mock.method(repository, 'getSourceMixByTopic', async () => ({}));
  t.mock.method(repository, 'findAiGeneratedByTopic', async () => []);
  t.mock.method(repository, 'fetchComparableQuestionsByTopic', async () => []);
  t.mock.method(repository, 'upsertQuestions', async (records) => ({ insertedCount: records.length }));
  t.after(() => cache.clearMemoryCache());
};

test('empty Easy MERN bank generates the exact gap, persists reusable unverified records and returns stable identities', async (t) => {
  isolate(t);
  t.mock.method(provider, 'generateStructuredQuestionSet', async (input) => {
    assert.equal(input.count, 1);
    assert.equal(input.difficulty, 'easy');
    return [row()];
  });
  const result = await service.generateFreshInterviewQuestions({
    skill: 'MERN stack',
    difficulty: 'easy',
    limit: 1
  });
  assert.equal(result.questions.length, 1);
  assert.ok(result.questions[0].questionId);
  assert.equal(result.questions[0].verificationStatus, 'unverified');
  assert.equal(result.questions[0].sourceMeta.verificationStatus, 'unverified');
  assert.equal(result.questions[0].sourceType, 'ai_generated');
  assert.equal(result.aiGeneratedCount, 1);
  assert.deepEqual(result.sourceMix, { ai_generated: 1 });
  repository.findAiGeneratedByTopic.mock.mockImplementation(async () => result.questions);
  await service.generateFreshInterviewQuestions({ skill: 'mern', difficulty: 'easy', limit: 1 });
  assert.equal(
    provider.generateStructuredQuestionSet.mock.callCount(),
    1,
    'reusable pool avoids provider calls'
  );
});

test('partial verified React coverage is used first and only the missing quantity is generated', async (t) => {
  isolate(t);
  const verified = { ...row('react', 'easy', 'What is JSX in React?'), sourceType: 'verified_seed' };
  repository.findAllQuestionsPage.mock.mockImplementation(async ({ source }) => {
    assert.equal(source, 'seed');
    return { questions: [verified], total: 1 };
  });
  t.mock.method(provider, 'generateStructuredQuestionSet', async (input) => {
    assert.equal(input.count, 1);
    assert.ok(input.excludeQuestions.includes(verified.question));
    return [row('react', 'easy', 'How does a React component receive a prop?')];
  });
  const result = await service.generateFreshInterviewQuestions({
    skill: 'React.js',
    difficulty: 'easy',
    limit: 2
  });
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].verificationStatus, 'verified');
  assert.equal(result.questions[1].verificationStatus, 'unverified');
});

test('verified-only never invokes AI and insufficient results are explicit', async (t) => {
  isolate(t);
  const calls = t.mock.method(provider, 'generateStructuredQuestionSet', () => assert.fail('AI excluded'));
  await assert.rejects(
    service.generateFreshInterviewQuestions({ skill: 'mern', difficulty: 'easy', source: 'seed', limit: 5 }),
    { code: 'insufficient_results', requestedCount: 5, availableCount: 0 }
  );
  assert.equal(calls.mock.callCount(), 0);
});

test('all supported technologies and four difficulties can use an empty-bank AI path', async (t) => {
  isolate(t);
  t.mock.method(provider, 'generateStructuredQuestionSet', async ({ skill, difficulty }) => [
    row(
      skill,
      difficulty,
      difficulty === 'senior'
        ? `How would you design ${skill} reliability boundaries and justify the trade-offs?`
        : `How do ${skill} components exchange explicit input data?`
    )
  ]);
  for (const { key } of listImportantTopics()) {
    for (const difficulty of ['easy', 'medium', 'hard', 'senior']) {
      const result = await service.generateFreshInterviewQuestions({
        skill: key,
        difficulty,
        source: 'ai',
        limit: 1
      });
      assert.equal(result.questions[0].difficulty, difficulty, `${key}/${difficulty}`);
      assert.equal(result.questions[0].topicKey, key);
    }
  }
});

test('wrong metadata, malformed sections, missing answers, duplicates and unsuitable difficulty tasks are rejected', async (t) => {
  isolate(t);
  const base = row('react', 'medium');
  for (const patch of [
    { difficulty: 'easy' },
    { difficulty: 'hard' },
    { difficulty: 'expert' },
    { topicKey: 'angular' },
    { category: 'unknown' },
    { tags: [{}] },
    { answer: '' },
    { answerSections: { shortAnswer: 'incomplete' } }
  ])
    assert.equal(
      validateGeneratedQuestion({ ...base, ...patch }, { topicKey: 'react', difficulty: 'medium' }),
      false
    );
  assert.equal(
    validateGeneratedQuestion(
      row('react', 'easy', 'How would you design a distributed React service with multi-region consensus?'),
      { topicKey: 'react', difficulty: 'easy' }
    ),
    false
  );
  t.mock.method(provider, 'generateStructuredQuestionSet', async () => [row(), row()]);
  await assert.rejects(
    service.generateFreshInterviewQuestions({ skill: 'mern', difficulty: 'easy', source: 'ai', limit: 2 }),
    { statusCode: 503, availableCount: 1 }
  );
});

test('Custom Q&A answers polite system-design questions with complete private unverified snapshots and isolated reuse', async (t) => {
  cache.clearMemoryCache();
  t.after(() => cache.clearMemoryCache());
  t.mock.method(repository, 'findExactReusableQuestion', async () => null);
  t.mock.method(repository, 'findSearchCandidates', async () => []);
  t.mock.method(Session, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  const writes = [];
  t.mock.method(sessions, 'create', async (record) => {
    writes.push(record);
    const persisted = new Session({ ...record, userId: '507f1f77bcf86cd799439011' });
    assert.ok(persisted.questions[0].sourceMeta.generatedAt);
    assert.equal(persisted.questions[0].topicKey, 'system-design');
    assert.ok(persisted.questions[0].answerSections.systemDesign.security);
    return { _id: 'private-session' };
  });
  const answer = row('system-design', 'senior');
  answer.answerSections.systemDesign = Object.fromEntries(
    Object.keys(SYSTEM_DESIGN_FIELDS).map((key) => [
      key,
      `Illustrative streaming-platform ${key}: use explicit interfaces, partition traffic and monitor failures.`
    ])
  );
  answer.answerSections.scopeNote =
    'An educational design using public architectural concepts, not verified Netflix internals.';
  t.mock.method(provider, 'answerSearchFallback', async (input) => {
    assert.ok(input.userId);
    return certified(input, answer);
  });
  t.mock.method(repository, 'upsertQuestions', () =>
    assert.fail('Private custom answers cannot enter catalog')
  );
  const input = {
    userId: 'owner-a',
    skill: 'system-design',
    question: 'Can you give me the system design of Netflix? How does it work?'
  };
  const result = await service.answerCustomInterviewQuestion(input);
  assert.equal(result.sourceType, 'ai_generated');
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.generationStatus, 'generated');
  assert.equal(writes[0].userId, 'owner-a');
  await service.answerCustomInterviewQuestion(input);
  assert.equal(provider.answerSearchFallback.mock.callCount(), 1);
  await service.answerCustomInterviewQuestion({ ...input, userId: 'owner-b' });
  assert.equal(provider.answerSearchFallback.mock.callCount(), 2, 'private cache is isolated per owner');
});

test('provider integration gives existing orchestration a bounded fallback budget and isolates custom coordination keys', async (t) => {
  const keys = [];
  t.mock.method(coordination, 'runAI', async (key, operation) => {
    keys.push(key);
    return operation(new AbortController().signal);
  });
  t.mock.method(aiService, 'runAIAnalysis', async (_prompt, _fallback, retries, options) => {
    assert.equal(retries, 0);
    assert.equal(options.requestPolicy.maxAttempts, 4);
    assert.equal(options.requestPolicy.cacheResponse, false);
    assert.equal(options.requestPolicy.maxOutputTokens, 8000);
    return { ok: true, value: propsSections() };
  });
  const input = {
    topicKey: 'react',
    topicType: 'framework',
    question: 'How do React components receive props?'
  };
  await provider.answerCustomQuestionFromAI({ ...input, userId: 'owner-a' });
  await provider.answerCustomQuestionFromAI({ ...input, userId: 'owner-b' });
  assert.notEqual(keys[0], keys[1]);
});

test('primary provider failure falls through the shared manager to a configured secondary provider', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  t.mock.method(manager, 'getStatus', () => ({ enabledProviders: ['gemini', 'openai'] }));
  t.mock.method(manager, 'getProviderState', () => ({
    settings: { enabled: true },
    states: { gemini: { enabled: true }, openai: { enabled: true } }
  }));
  t.mock.method(manager, 'providerPriority', () => ['gemini', 'openai']);
  t.mock.method(admission, 'enter', async () => ({}));
  t.mock.method(admission, 'release', async () => {});
  const attempted = [];
  t.mock.method(
    manager,
    'tryProvider',
    async (name, _prompt, _retries, _parse, _timeout, _model, _signal, budget) => {
      attempted.push(name);
      budget.remaining--;
      return name === 'gemini'
        ? { ok: false, failover: true, reason: 'provider_error' }
        : { ok: true, parsed: propsSections(), provider: name };
    }
  );
  const result = await provider.answerCustomQuestionFromAI({
    topicKey: 'react',
    question: 'How do React components receive props?',
    userId: 'owner'
  });
  assert.ok(result.answerSections.explanation);
  assert.deepEqual(attempted, ['gemini', 'openai']);
});

test('coverage counts all rows, invalid metadata and duplicate identities without inventing database counts', () => {
  const result = summarizeCoverage([
    row('react', 'easy'),
    row('react', 'easy'),
    { ...row('Node.js', 'expert'), answer: '' }
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.matrix.react.easy, 2);
  assert.equal(result.duplicates, 1);
  assert.equal(result.missingAnswers, 1);
  assert.equal(result.invalidDifficulties, 1);
  assert.equal(result.technologyAliases, 1);
});

test('snapshot detaches nested content and records original technology and generation provenance', () => {
  const original = {
    ...row(),
    sourceMeta: { generatedAt: '2026-11-15T00:00:00Z', verificationStatus: 'unverified' }
  };
  const [snapshot] = sessions.snapshotQuestions([original], 'mern');
  original.answerSections.keyPoints[0] = 'changed';
  original.sourceMeta.generatedAt = 'changed';
  assert.notEqual(snapshot.answerSections.keyPoints[0], 'changed');
  assert.equal(snapshot.sourceMeta.generatedAt, '2026-11-15T00:00:00Z');
});

test('an explicit provider no-answer is distinguishable from provider failure', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  t.mock.method(aiService, 'runAIAnalysis', async () => ({
    ok: true,
    value: { answerStatus: 'no_answer', reason: 'Insufficient technical context' }
  }));
  await assert.rejects(
    provider.answerCustomQuestionFromAI({
      topicKey: 'react',
      question: 'Can you explain this unspecified design?',
      userId: 'owner'
    }),
    { reasonCode: 'no_answer' }
  );
  const failure = service.buildAiFailurePayload({ reasonCode: 'no_answer' });
  assert.equal(failure.statusCode, 422);
  assert.equal(failure.code, 'no_answer');
  assert.equal(failure.retryable, false);
});

test('regenerating a rejected legacy private answer creates a distinct immutable snapshot', async (t) => {
  cache.clearMemoryCache();
  t.after(() => cache.clearMemoryCache());
  const question = 'How should React isolate a custom serialized workflow state?';
  const identity = repository.buildQuestionIdentity({ question, topicKey: 'react' });
  const legacyKey = `custom:react:${identity.normalizedQuestionHash}`;
  t.mock.method(repository, 'findExactReusableQuestion', async () => null);
  t.mock.method(repository, 'findSearchCandidates', async () => []);
  t.mock.method(Session, 'findOne', () => ({
    sort: () => ({
      lean: async () => ({
        _id: 'old-snapshot',
        questions: [
          {
            question,
            normalizedQuestionHash: identity.normalizedQuestionHash,
            answer: 'Invalid old answer',
            confidenceScore: 0.1
          }
        ]
      })
    })
  }));
  t.mock.method(provider, 'answerSearchFallback', async (input) => certified(input, row('react', 'hard')));
  t.mock.method(sessions, 'create', async (record) => {
    assert.notEqual(record.requestKey, legacyKey);
    assert.ok(record.questions[0].answerSections.explanation);
    return { _id: 'new-snapshot' };
  });
  const result = await service.answerCustomInterviewQuestion({ userId: 'owner', skill: 'react', question });
  assert.equal(result.sessionId, 'new-snapshot');
});
