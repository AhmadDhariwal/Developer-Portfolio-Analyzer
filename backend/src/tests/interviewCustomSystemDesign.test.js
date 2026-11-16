const { certified, judgeResult } = require('./fixtures/interviewCoverageFixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const provider = require('../services/providers/interviewAIProvider');
const service = require('../services/interviewPrepService');
const repository = require('../repositories/interviewQuestionRepository');
const coordination = require('../services/interviewCoordinationService');
const manager = require('../services/aiProviderManager');
const admission = require('../services/aiProviderAdmissionService');
const sessions = require('../services/interviewSessionService');
const Session = require('../models/interviewPrepSession');
const cache = require('../services/redisCacheService');
const { SYSTEM_DESIGN_FIELDS, hasValidSystemDesign } = require('../services/interviewAIValidation');

const question = 'system design of netflix?';
const systemDesign = {
  problemDefinition:
    'Design an illustrative Netflix-like video streaming system with discovery and playback.',
  functionalRequirements:
    'Browse titles, start playback, and resume watched content using authenticated accounts.',
  nonFunctionalRequirements:
    'Keep playback available and startup latency low while supporting global viewers.',
  highLevelArchitecture:
    'Separate the Netflix-like control plane from a CDN-backed video delivery data plane.',
  components: 'Use an API gateway, catalog service, playback service, transcoding workers and a CDN.',
  databaseDesign: 'Store account and catalog metadata separately from immutable encoded video objects.',
  apiDesign: 'A playback-session endpoint authorizes access and returns a short-lived manifest URL.',
  dataFlow: 'A client authenticates, selects a title, requests a manifest and fetches segments from a CDN.',
  caching: 'Cache immutable video segments at the CDN and popular catalog metadata near the API.',
  scalability: 'Scale stateless playback APIs independently from asynchronous transcoding workers.',
  loadBalancing: 'Route clients to healthy regional APIs and select an available nearby CDN edge.',
  reliability: 'Replicate video objects and isolate regional playback failures with fallback routing.',
  security: 'Authorize playback sessions, sign manifest URLs and protect personal account information.',
  tradeOffs: 'Caching improves playback latency at the cost of invalidation work and storage duplication.',
  bottlenecks: 'Measure cache misses, origin bandwidth and transcoding queues before adding capacity.'
};
const sections = {
  shortAnswer:
    'An illustrative Netflix-like architecture separates metadata APIs from CDN-delivered video segments.',
  keyPoints: [
    'Separate control and delivery planes',
    'Encode video asynchronously',
    'Cache segments close to viewers'
  ],
  explanation:
    'For this educational Netflix-like system design, clients use authenticated metadata APIs to discover titles and create playback sessions. A playback service returns a manifest and signed segment URLs; a CDN serves video from replicated object storage. Transcoding workers prepare multiple bitrate renditions so the client can adapt to network conditions. This is an illustrative public-concepts architecture, not a verified account of Netflix internals.',
  example:
    'A viewer selects a Netflix-like title, creates an authorized playback session, then downloads adaptive video segments from a CDN.',
  realWorldUseCase:
    'An educational streaming platform separates globally cached video bytes from personalized account and catalog operations.',
  commonMistakes: [
    'Sending every video byte through metadata APIs',
    'Ignoring origin protection during CDN misses'
  ],
  interviewTip: 'Start with playback requirements, then explain data flow, failure isolation and trade-offs.',
  scopeNote:
    'This is an illustrative educational architecture using public concepts, not a verified description of Netflix internal implementation.',
  systemDesign
};
const rawAnswer = {
  ...sections,
  question,
  topicKey: 'system-design',
  technology: 'system-design',
  difficulty: 'senior',
  category: 'system-design',
  tags: ['system-design', 'streaming'],
  qualityScore: 94,
  confidenceScore: 0.94
};
const answer = {
  ...rawAnswer,
  answerSections: sections,
  answer: provider.toStructuredAnswerText(sections),
  generationMeta: {
    provider: 'fixture-provider',
    model: 'fixture-model',
    generatedAt: '2026-11-15T00:00:00Z'
  }
};

const isolatePrivate = (t) => {
  cache.clearMemoryCache();
  t.after(() => cache.clearMemoryCache());
  t.mock.method(repository, 'findExactReusableQuestion', async () => null);
  t.mock.method(repository, 'findSearchCandidates', async () => []);
  t.mock.method(repository, 'upsertQuestions', () =>
    assert.fail('Custom answers must stay out of the public bank')
  );
  t.mock.method(Session, 'findOne', () => ({ sort: () => ({ lean: async () => null }) }));
  const writes = [];
  t.mock.method(sessions, 'create', async (record) => {
    writes.push(record);
    return { _id: 'private-fixture-session' };
  });
  return writes;
};

test('Custom Q&A reserves persistence time within its configurable total deadline', () => {
  const previous = process.env.AI_REQUEST_TIMEOUT_MS;
  try {
    process.env.AI_REQUEST_TIMEOUT_MS = '30000';
    assert.equal(provider.customAnswerTimeoutMs('system-design', question), 18000);
    assert.equal(
      provider.customAnswerTimeoutMs('react', 'How would you design a distributed React service?'),
      18000
    );
    assert.ok(provider.customAnswerTimeoutMs('react', 'How does React receive props?') === 18000);
    process.env.AI_REQUEST_TIMEOUT_MS = '9000';
    assert.equal(provider.customAnswerTimeoutMs('system design', question), 7000);
    process.env.AI_REQUEST_TIMEOUT_MS = '60000';
    assert.equal(provider.customAnswerTimeoutMs('system-design', question), 18000);
  } finally {
    if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
    else process.env.AI_REQUEST_TIMEOUT_MS = previous;
  }
});

test('the service can finish a complete private system-design answer after the former 6.5-second deadline', async (t) => {
  const writes = isolatePrivate(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  t.mock.method(provider, 'answerSearchFallback', async (input) => {
    assert.ok(input.signal);
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    return certified({ ...input, skill: 'system-design', question }, answer);
  });
  const pending = service.answerCustomInterviewQuestion({
    userId: 'owner',
    skill: 'system-design',
    question
  });
  await entered;
  t.mock.timers.tick(6501);
  release();
  const result = await pending;
  assert.equal(result.verificationStatus, 'unverified');
  assert.equal(result.sourceMeta.provider, 'fixture-provider');
  assert.equal(result.sourceMeta.model, 'fixture-model');
  assert.ok(hasValidSystemDesign(result.answerSections));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].userId, 'owner');
  assert.equal(writes[0].questions[0].sourceMeta.generatedAt, answer.generationMeta.generatedAt);
});

for (const firstFailure of ['timeout', 'incomplete-design', 'invalid-example', 'wrong-topic']) {
  test(`system-design ${firstFailure} fails over through the shared manager using configured models`, async (t) => {
    t.mock.method(coordination, 'runAI', async (_key, operation, options) => {
      assert.ok(
        options.timeoutMs > 0 &&
          options.timeoutMs <= provider.customAnswerTimeoutMs('system-design', question)
      );
      return operation(new AbortController().signal);
    });
    t.mock.method(manager, 'getStatus', () => ({ enabledProviders: ['gemini', 'openai'] }));
    t.mock.method(manager, 'providerPriority', () => ['gemini', 'openai']);
    t.mock.method(manager, 'getProviderState', () => ({
      settings: { enabled: true },
      states: {
        gemini: { enabled: true, models: ['configured-gemini'], apiKey: 'fixture-only' },
        openai: { enabled: true, models: ['configured-openai'], apiKey: 'fixture-only' }
      }
    }));
    for (const method of ['enter', 'release', 'record']) t.mock.method(admission, method, async () => ({}));
    t.mock.method(admission, 'circuit', async () => true);
    const attempts = [];
    t.mock.method(
      manager,
      'runProviderRequest',
      async ({ provider: name, modelName, parseJson, timeoutMs, prompt }) => {
        const judged = judgeResult(prompt);
        if (judged) return judged.value;
        assert.equal(timeoutMs, 5000);
        assert.ok(prompt.includes('"technology":"system-design"'));
        assert.ok(prompt.includes('"topicKey":"system-design"'));
        attempts.push({ provider: name, model: modelName });
        if (name === 'gemini' && firstFailure === 'timeout')
          throw Object.assign(new Error('fixture timeout'), { aiReason: 'timeout' });
        const invalid =
          firstFailure === 'invalid-example'
            ? { ...rawAnswer, example: { invalid: 'object instead of string' } }
            : firstFailure === 'wrong-topic'
              ? { ...rawAnswer, technology: 'netflix' }
              : { ...rawAnswer, systemDesign: { problemDefinition: systemDesign.problemDefinition } };
        return parseJson(JSON.stringify(name === 'gemini' ? invalid : rawAnswer));
      }
    );
    const result = await provider.answerCustomQuestionFromAI({
      topicKey: 'system-design',
      question,
      userId: 'owner'
    });
    assert.deepEqual(attempts, [
      { provider: 'gemini', model: 'configured-gemini' },
      { provider: 'openai', model: 'configured-openai' }
    ]);
    assert.equal(result.generationMeta.provider, 'openai');
    assert.equal(result.generationMeta.model, 'configured-openai');
    assert.deepEqual(Object.keys(result.answerSections.systemDesign), Object.keys(SYSTEM_DESIGN_FIELDS));
    assert.ok(hasValidSystemDesign(result.answerSections));
  });
}

test('last caller cancellation reaches the provider and does not persist a custom system-design answer', async (t) => {
  const writes = isolatePrivate(t);
  const caller = new AbortController();
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let providerSignal;
  t.mock.method(provider, 'answerSearchFallback', async (input) => {
    providerSignal = input.signal;
    entered();
    await new Promise((_resolve, reject) =>
      input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    );
  });
  const pending = service.answerCustomInterviewQuestion({
    userId: 'owner',
    skill: 'system-design',
    question,
    signal: caller.signal
  });
  await started;
  caller.abort();
  await assert.rejects(pending, { statusCode: 499 });
  assert.equal(providerSignal.aborted, true);
  assert.equal(writes.length, 0);
});

test('one cancelled custom caller cannot cancel the matching private answer requested by another tab', async (t) => {
  const writes = isolatePrivate(t);
  const caller = new AbortController();
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const mocked = t.mock.method(provider, 'answerSearchFallback', async (input) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    assert.equal(input.signal.aborted, false);
    return certified({ ...input, skill: 'system-design', question }, answer);
  });
  const input = { userId: 'owner', skill: 'system-design', question };
  const left = service.answerCustomInterviewQuestion({ ...input, signal: caller.signal });
  const right = service.answerCustomInterviewQuestion(input);
  await started;
  await new Promise((resolve) => setImmediate(resolve));
  caller.abort();
  await assert.rejects(left, { statusCode: 499 });
  release();
  assert.equal((await right).verificationStatus, 'unverified');
  assert.equal(mocked.mock.callCount(), 1);
  assert.equal(writes.length, 1);
});

test('incomplete system-design content cannot be persisted even when the provider reports success', async (t) => {
  const writes = isolatePrivate(t);
  t.mock.method(provider, 'answerSearchFallback', async () => ({
    ...answer,
    answerSections: { ...sections, systemDesign: {} }
  }));
  await assert.rejects(
    service.answerCustomInterviewQuestion({ userId: 'owner', skill: 'system-design', question }),
    { code: 'invalid_ai_answer', generationStatus: 'invalid_response' }
  );
  assert.equal(writes.length, 0);
});

test('an exhausted shared budget retains the last invalid-output reason instead of reporting provider outage', async (t) => {
  t.mock.method(manager, 'getProviderState', () => ({
    settings: { enabled: true },
    states: { gemini: { enabled: true }, openai: { enabled: true } }
  }));
  t.mock.method(manager, 'providerPriority', () => ['gemini', 'openai']);
  for (const method of ['enter', 'release']) t.mock.method(admission, method, async () => ({}));
  const calls = [];
  t.mock.method(
    manager,
    'tryProvider',
    async (name, _prompt, _retries, _parse, _timeout, _model, _signal, budget) => {
      calls.push(name);
      budget.remaining--;
      return { ok: false, failover: true, reason: 'incomplete_output' };
    }
  );
  const result = await manager.execute('fixture', { requestPolicy: { maxAttempts: 1 } });
  assert.equal(result.reason, 'incomplete_output');
  assert.deepEqual(calls, ['gemini']);
});

test('operation-specific provider deadlines remain bounded by 12 seconds and the global request deadline', async (t) => {
  t.mock.method(manager, 'getProviderState', () => ({
    settings: { enabled: true },
    states: { gemini: { enabled: true } }
  }));
  t.mock.method(manager, 'providerPriority', () => ['gemini']);
  for (const method of ['enter', 'release']) t.mock.method(admission, method, async () => ({}));
  let observed;
  t.mock.method(
    manager,
    'tryProvider',
    async (_name, _prompt, _retries, _parse, _timeout, _model, _signal, budget) => {
      observed = budget.providerTimeoutMs;
      return { ok: true, parsed: {} };
    }
  );
  await manager.execute('fixture', { timeoutMs: 30000, requestPolicy: { providerTimeoutMs: 60000 } });
  assert.equal(observed, 12000);
  await manager.execute('fixture', { timeoutMs: 5000, requestPolicy: { providerTimeoutMs: 12000 } });
  assert.equal(observed, 5000);
  await manager.execute('fixture');
  assert.equal(observed, undefined);
});

test('bare design labels and missing targets remain invalid interview questions', () => {
  const { validateInterviewQuestionQuality } = require('../services/interviewQuestionQualityService');
  for (const question of ['system design', 'system design of?', 'Netflix marketing brochure']) {
    const result = validateInterviewQuestionQuality({ ...answer, question });
    assert.ok(result.reasons.includes('not_an_interview_question'));
  }
});
