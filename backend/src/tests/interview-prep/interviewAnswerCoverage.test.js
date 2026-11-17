const test = require('node:test');
const assert = require('node:assert/strict');
const coverage = require('../../modules/interview-prep/services/interviewAnswerCoverage');
const provider = require('../../modules/interview-prep/providers/interviewAIProvider');
const ai = require('../../core/ai/aiservice');
const coordination = require('../../modules/interview-prep/services/interviewCoordinationService');

const localQuestion = 'Tell me about Redis and also tell me how to use the local Redis.';
const guide = {
  shortAnswer: 'Redis is an in-memory data store with useful data structures and optional persistence.',
  explanation:
    'Use the following general Ubuntu/WSL instructions; these are not a claim about your installed services. Prerequisites are a terminal, a supported Ubuntu distribution and package-management permission.\n1. Install Redis using the documented package manager for your environment.\n2. Start the local Redis server.\n3. Verify a client connection and the expected result.\n4. Try a set/get pair before integrating your application.\n5. Configure the application with the intended endpoint and test it.\nFor Windows use a supported WSL environment or an appropriate container rather than assuming a native service is installed. Local configuration applies to this example and must be adapted to your own environment. Restrict the server to the local interface and avoid exposing an unauthenticated instance. These instructions are general guidance, not proof of a successful local installation. In a project, confirm the declared client dependency and actual configuration source before changing connection settings.',
  example:
    '```sh\nsudo apt update\nsudo apt install redis-server\nsudo service redis-server start\nredis-cli ping\n# Expected output: PONG\nredis-cli SET demo hello\nredis-cli GET demo\n# Expected output: hello\n```\n```js\nimport { createClient } from "redis";\nconst client = createClient({ url: "redis://127.0.0.1:6379" });\nclient.on("error", console.error);\nawait client.connect();\nconsole.log(await client.ping()); // PONG\nawait client.quit();\n```',
  keyPoints: [
    'Use the correct environment',
    'Verify with the documented client',
    'Configure the application endpoint'
  ],
  realWorldUseCase: 'Cache local development data after checking the declared application integration.',
  commonMistakes: [
    'Connection refused: check the server and endpoint before retrying.',
    'An address inside WSL/container may not identify the same host as your application; test from the application environment.'
  ],
  interviewTip: 'Separate the server lifecycle, client commands and application connection.'
};
const row = {
  question: localQuestion,
  answerSections: guide,
  answer: provider.toStructuredAnswerText(guide),
  topicKey: 'redis',
  technology: 'redis',
  tags: ['redis'],
  category: 'core-concepts',
  difficulty: 'medium',
  confidenceScore: 0.94,
  qualityScore: 94
};
const plan = coverage.analyzeQuestion({ topicKey: 'redis', question: localQuestion });
const assessment = (p, answer, satisfied = true) => ({
  requirements: p.requirements.map((req) => ({
    id: req.id,
    satisfied,
    evidence: coverage.answerText(answer).slice(0, 80),
    reason: satisfied
      ? 'The quoted instructions substantively cover this requested task.'
      : 'The answer does not contain the requested actionable installation steps.'
  }))
});

const scenarios = [
  ['What is Redis?', 'redis', false, 'definition'],
  ['Why is Redis used?', 'redis', false, 'purpose'],
  ['How do I use local Redis?', 'redis', true, 'installation'],
  ['Explain Redis and integrate it with Node.js.', 'redis', true, 'integration'],
  ['Explain MongoDB indexing and how to implement it.', 'mongodb', true, 'procedure'],
  ['What is Angular change detection?', 'angular', false, 'definition'],
  ['Explain Docker and deploy a Node.js application.', 'docker', true, 'procedure'],
  ['Explain JWT authentication and its implementation.', 'nodejs', true, 'integration'],
  ['Explain the full RAG workflow and its purpose.', 'rag', true, 'workflow'],
  ['Explain system design for a URL shortener.', 'system-design', true, 'architecture']
];
for (const [question, topicKey, complex, requirement] of scenarios)
  test(`intent and coverage plan: ${question}`, () => {
    const result = coverage.analyzeQuestion({ question, topicKey });
    assert.equal(result.complex, complex);
    assert.ok(result.requirements.some((item) => item.id === requirement));
  });
test('the complete local-usage request cannot pass with only a definition and a generic Node example', () => {
  const incomplete = {
    answerSections: {
      ...guide,
      explanation: 'Redis is an in-memory data store useful for caching and sessions.',
      example: 'const client = createClient(); await client.connect();'
    }
  };
  assert.equal(coverage.structuralCoverage(plan, incomplete).complete, false);
  assert.equal(coverage.reusable(plan, incomplete), false);
  assert.ok(plan.requirements.some((item) => item.id === 'startup'));
  assert.ok(plan.requirements.some((item) => item.id === 'interaction'));
});
test('headings, a claimed complete flag and hallucinated evaluator quotes do not establish coverage', () => {
  assert.equal(coverage.reusable(plan, { ...row, complete: true }), false);
  const judged = assessment(plan, row);
  judged.requirements[0].evidence = 'this evidence does not exist in the actual answer';
  assert.equal(coverage.validateAssessment(plan, row, judged), false);
  const missing = assessment(plan, row, false);
  assert.equal(coverage.assessmentComplete(plan, row, missing), false);
});
test('quality attestations bind the request, context, version and answer content without changing historical data', () => {
  const before = JSON.stringify(row);
  const quality = coverage.attest(plan, row, { provider: 'fixture', model: 'fixture' });
  const stored = { ...row, sourceMeta: { answerQuality: quality } };
  assert.equal(coverage.reusable(plan, stored), true);
  assert.equal(
    coverage.reusable(plan, { ...stored, answerSections: { ...guide, example: 'removed instructions' } }),
    false
  );
  assert.equal(
    coverage.reusable(
      coverage.analyzeQuestion({ topicKey: 'redis', question: localQuestion, context: { changed: true } }),
      stored
    ),
    false
  );
  assert.equal(JSON.stringify(row), before);
  assert.equal(coverage.reusable(plan, row), false);
});
test('simple conceptual questions do not require a second provider call', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  const calls = t.mock.method(ai, 'runAIAnalysis', async () => ({
    ok: true,
    value: row,
    provider: 'fixture',
    model: 'fixture'
  }));
  const answer = await provider.answerCustomQuestionFromAI({
    topicKey: 'redis',
    question: 'What is Redis?',
    userId: 'owner'
  });
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(answer.answerQuality.method, 'deterministic-conceptual');
});
test('independent evaluation rejects missing coverage and permits one bounded repair before persistence', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  const budgets = [];
  let calls = 0;
  t.mock.method(ai, 'runAIAnalysis', async (prompt, _fallback, _retry, options) => {
    budgets.push(options.requestPolicy.attemptBudget.remaining);
    calls++;
    if (calls === 1 || calls === 3) return { ok: true, value: row, provider: 'fixture', model: 'fixture' };
    const data = JSON.parse(prompt.split('\n').at(-1));
    return { ok: true, value: assessment(data.request, row, calls === 4), provider: 'judge', model: 'judge' };
  });
  const answer = await provider.answerCustomQuestionFromAI({
    topicKey: 'redis',
    question: localQuestion,
    userId: 'owner'
  });
  assert.deepEqual(budgets, [4, 3, 2, 1]);
  assert.equal(calls, 4);
  assert.equal(answer.answerQuality.method, 'independent-evaluation');
});
test('an answer which remains incomplete exhausts the existing budget and returns an honest failure', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  let calls = 0;
  t.mock.method(ai, 'runAIAnalysis', async (prompt) => {
    calls++;
    if (calls % 2) return { ok: true, value: row, provider: 'fixture', model: 'fixture' };
    return {
      ok: true,
      value: assessment(JSON.parse(prompt.split('\n').at(-1)).request, row, false),
      provider: 'judge',
      model: 'judge'
    };
  });
  await assert.rejects(
    provider.answerCustomQuestionFromAI({ topicKey: 'redis', question: localQuestion, userId: 'owner' }),
    { reasonCode: 'answer_incomplete' }
  );
  assert.equal(calls, 4);
});
test('short, long, ambiguous and missing-context inputs remain bounded without fabricated environment facts', () => {
  assert.ok(coverage.analyzeQuestion({ topicKey: 'redis', question: 'How do I fix it?' }).ambiguous);
  assert.equal(
    coverage.analyzeQuestion({ topicKey: 'redis', question: 'x'.repeat(1000) }).subject.length,
    500
  );
  const context = require('../../modules/interview-prep/services/interviewProjectContext').projectContext('redis');
  assert.ok(context.verifiedSourceFacts.packages.backend.redis);
  assert.ok(context.limitations.includes('unknown'));
  assert.ok(!JSON.stringify(context).includes('redis://'));
});

const isolateService = (t) => {
  const repository = require('../../modules/interview-prep/repositories/interviewQuestionRepository');
  const Session = require('../../modules/interview-prep/models/interviewPrepSession');
  const sessions = require('../../modules/interview-prep/services/interviewSessionService');
  const cache = require('../../core/cache/redisCacheService');
  cache.clearMemoryCache();
  t.after(() => cache.clearMemoryCache());
  t.mock.method(repository, 'findExactReusableQuestion', async () => null);
  t.mock.method(repository, 'findSearchCandidates', async () => []);
  t.mock.method(repository, 'upsertQuestions', () => assert.fail('Private answers cannot enter the bank'));
  t.mock.method(Session, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  const writes = [];
  t.mock.method(sessions, 'create', async (record) => {
    writes.push(record);
    return { _id: 'new-private' };
  });
  return { repository, Session, cache, writes };
};

test('an incomplete cached answer is evicted and cannot bypass current coverage or enter private persistence', async (t) => {
  const { repository, cache, writes } = isolateService(t);
  const service = require('../../modules/interview-prep/services/interviewPrepService');
  const identity = repository.buildQuestionIdentity({ question: localQuestion, topicKey: 'redis' });
  const key = await cache.resolveInterviewCacheKey(
    `interview:custom:v7:coverage=1:topic=redis:user=${repository.toQuestionHash('owner')}:question=${repository.toQuestionHash(identity.normalizedQuestion)}`,
    'redis'
  );
  await cache.setCacheJson(
    key,
    { ...row, answerSections: { shortAnswer: 'Redis is a cache.' }, sessionId: 'incomplete-old' },
    30
  );
  const generated = t.mock.method(provider, 'answerSearchFallback', async (input) => ({
    ...row,
    answerQuality: coverage.attest(input.answerPlan, row, { provider: 'fixture' })
  }));
  const result = await service.answerCustomInterviewQuestion({
    userId: 'owner',
    skill: 'redis',
    question: localQuestion
  });
  assert.equal(result.sessionId, 'new-private');
  assert.equal(generated.mock.callCount(), 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].questions[0].sourceMeta.answerQuality.version, coverage.QUALITY_VERSION);
  assert.ok(writes[0].questions[0].answerSections.explanation.includes('\n1.'));
});

test('legacy incomplete private snapshots remain immutable while a compliant replacement is generated', async (t) => {
  const { repository, Session, writes } = isolateService(t);
  const identity = repository.buildQuestionIdentity({ question: localQuestion, topicKey: 'redis' });
  const old = {
    _id: 'historical-private',
    questions: [
      {
        ...row,
        normalizedQuestionHash: identity.normalizedQuestionHash,
        answerSections: { shortAnswer: 'Redis is an in-memory cache.' }
      }
    ]
  };
  const before = JSON.stringify(old);
  Session.findOne.mock.mockImplementation(() => ({ sort: () => ({ lean: async () => old }) }));
  t.mock.method(provider, 'answerSearchFallback', async (input) => ({
    ...row,
    answerQuality: coverage.attest(input.answerPlan, row, { provider: 'fixture' })
  }));
  const result = await require('../../modules/interview-prep/services/interviewPrepService').answerCustomInterviewQuestion({
    userId: 'owner',
    skill: 'redis',
    question: localQuestion
  });
  assert.equal(result.sessionId, 'new-private');
  assert.equal(JSON.stringify(old), before);
  assert.equal(writes.length, 1);
});

test('a complete legacy private guide is independently revalidated and reused without overwriting its snapshot', async (t) => {
  const { repository, Session, writes } = isolateService(t);
  const identity = repository.buildQuestionIdentity({ question: localQuestion, topicKey: 'redis' });
  const old = {
    _id: 'historical-private',
    questions: [{ ...row, normalizedQuestionHash: identity.normalizedQuestionHash }]
  };
  const before = JSON.stringify(old);
  Session.findOne.mock.mockImplementation(() => ({ sort: () => ({ lean: async () => old }) }));
  const judged = t.mock.method(provider, 'assessCustomAnswer', async (input) => ({
    complete: true,
    quality: coverage.attest(input.plan, input.answer, { provider: 'fixture-judge' })
  }));
  t.mock.method(provider, 'answerSearchFallback', () =>
    assert.fail('A revalidated complete guide should be reused')
  );
  const result = await require('../../modules/interview-prep/services/interviewPrepService').answerCustomInterviewQuestion({
    userId: 'owner',
    skill: 'redis',
    question: localQuestion
  });
  assert.equal(result.sessionId, 'historical-private');
  assert.equal(judged.mock.callCount(), 1);
  assert.equal(writes.length, 0);
  assert.equal(JSON.stringify(old), before);
});

test('a generation-stage cap reserves unused shared attempts for independent evaluation', async (t) => {
  const manager = require('../../core/ai/aiProviderManager');
  const admission = require('../../core/ai/aiProviderAdmissionService');
  t.mock.method(manager, 'getProviderState', () => ({
    settings: { enabled: true },
    states: { groq: { enabled: true }, gemini: { enabled: true } }
  }));
  for (const name of ['enter', 'release']) t.mock.method(admission, name, async () => ({}));
  t.mock.method(
    manager,
    'tryProvider',
    async (name, _prompt, _retry, _parse, _timeout, _model, _signal, budget) => {
      budget.remaining--;
      return name === 'groq' ? { ok: false, failover: true, reason: 'timeout' } : { ok: true, parsed: {} };
    }
  );
  const shared = { remaining: 4 };
  assert.equal(
    (
      await manager.execute('fixture', {
        requestPolicy: { providerPriority: ['groq', 'gemini'], maxAttempts: 2, attemptBudget: shared }
      })
    ).ok,
    true
  );
  assert.equal(shared.remaining, 2);
});

test('programming requests receive practical planning and independent evaluation rather than conceptual checks', () => {
  const plan = coverage.analyzeQuestion({
    topicKey: 'javascript',
    question: 'Write a function to debounce a search input.'
  });
  assert.equal(plan.practical, true);
  assert.equal(plan.complex, true);
  assert.ok(plan.requirements.some((item) => item.id === 'example'));
  assert.ok(plan.requirements.some((item) => item.id === 'verification'));
});
