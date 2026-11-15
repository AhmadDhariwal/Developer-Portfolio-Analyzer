const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/interviewPrepService');
const repository = require('../repositories/interviewQuestionRepository');
const provider = require('../services/providers/interviewAIProvider');
const aiService = require('../services/aiservice');
const manager = require('../services/aiProviderManager');
const coordination = require('../services/interviewCoordinationService');
const admission = require('../services/aiProviderAdmissionService');
const cache = require('../services/redisCacheService');
const { generationFlight } = require('../services/interviewGenerationFlight');
const { coverageTarget, coveragePlan, planCoverageBatch } = require('../services/interviewCoverageService');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { generationSourcePolicy } = require('../services/interviewQuestionFilters');
const { nearDuplicateCoverage, groupCoverageExclusions } = require('../services/interviewCoverageAudit');

const questions = [
  [
    'What is the purpose of React props in a MERN user interface?',
    'Props pass read-only input from a parent React component to a child.',
    'A parent sends product data to a reusable product-card component.'
  ],
  [
    'How does Express read a query parameter from an incoming GET request?',
    'Express exposes URL query parameters through req.query on the request object.',
    'An Express product endpoint reads a page query parameter before returning a result.'
  ],
  [
    'What is a MongoDB document and how does it differ from a collection?',
    'A MongoDB document stores one BSON record while a collection groups related documents.',
    'A products collection holds separate documents for each product.'
  ],
  [
    'How can Node.js read an environment variable without placing it in browser code?',
    'Node.js reads server environment values through process.env.',
    'An Express server reads a database connection setting at startup.'
  ],
  [
    'How does a React component use useState to update the value in a text input?',
    'useState stores a current value and provides a setter that schedules an update.',
    'A search input stores typed text and renders the current value.'
  ]
].map(([question, shortAnswer, example]) => {
  const answerSections = {
    shortAnswer,
    explanation: `${shortAnswer} In a MERN application this keeps component responsibilities explicit and allows a simple input to be traced through the application. ${example}`,
    keyPoints: ['Identify the input', 'Use the documented API', 'Keep responsibilities explicit'],
    example,
    realWorldUseCase: example,
    commonMistakes: ['Skipping input validation', 'Mixing server and browser responsibilities'],
    interviewTip: 'Trace a small concrete example through the MERN application.'
  };
  return {
    question,
    answerSections,
    answer: Object.values(answerSections).flat().join(' '),
    topicKey: 'mern',
    difficulty: 'easy',
    category: 'core-concepts',
    tags: ['mern'],
    confidenceScore: 0.9,
    qualityScore: 90,
    sourceType: 'ai_generated'
  };
});
const isolate = (t) => {
  cache.clearMemoryCache();
  t.after(() => cache.clearMemoryCache());
  t.mock.method(repository, 'findAllQuestionsPage', async () => ({ questions: [], total: 0 }));
  t.mock.method(repository, 'getSourceMixByTopic', async () => ({}));
  t.mock.method(repository, 'findAiGeneratedByTopic', async () => []);
  t.mock.method(repository, 'fetchComparableQuestionsByTopic', async () => []);
  t.mock.method(repository, 'upsertQuestions', async () => ({ insertedCount: 5 }));
};

test('two verified Easy MERN questions plus three AI questions return exactly five and preserve provenance', async (t) => {
  isolate(t);
  repository.findAllQuestionsPage.mock.mockImplementation(async (input) => {
    assert.equal(input.source, 'seed');
    assert.equal(input.difficulty, 'easy');
    return {
      questions: questions.slice(0, 2).map((row) => ({ ...row, sourceType: 'verified_seed' })),
      total: 2
    };
  });
  t.mock.method(provider, 'generateStructuredQuestionSet', async (input) => {
    assert.equal(input.count, 3);
    return questions
      .slice(2)
      .map((row) => ({ ...row, generationMeta: { provider: 'fixture', model: 'fixture-model' } }));
  });
  const result = await service.generateFreshInterviewQuestions({
    skill: 'MERN stack',
    difficulty: 'easy',
    source: 'database',
    limit: 5
  });
  assert.equal(result.questions.length, 5);
  assert.deepEqual(result.sourceMix, { verified_seed: 2, ai_generated: 3 });
  assert.ok(
    result.questions
      .slice(2)
      .every((row) => row.verificationStatus === 'unverified' && row.sourceMeta.provider === 'fixture')
  );
});

test('AI-only reuses matching canonical difficulty without invoking a provider', async (t) => {
  isolate(t);
  repository.findAiGeneratedByTopic.mock.mockImplementation(async () => questions);
  t.mock.method(provider, 'generateStructuredQuestionSet', () => assert.fail('Reusable pool must be used'));
  const result = await service.generateFreshInterviewQuestions({
    skill: 'mern',
    difficulty: 'easy',
    source: 'ai',
    limit: 5
  });
  assert.equal(result.aiGeneratedCount, 0);
  assert.equal(result.questions.length, 5);
  assert.equal(generationSourcePolicy('seed').generateAI, false);
  assert.equal(generationSourcePolicy('').generateAI, true);
  assert.equal(generationSourcePolicy('database').generateAI, true);
  assert.equal(generationSourcePolicy('scraped').generateAI, false);
});

test('partial provider batches keep valid rows and retry only the gap within one shared budget', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  const budgets = [],
    prompts = [];
  t.mock.method(aiService, 'runAIAnalysis', async (prompt, _fallback, _retries, options) => {
    budgets.push(options.requestPolicy.maxAttempts);
    prompts.push(prompt);
    return {
      ok: true,
      provider: 'fixture',
      model: 'fixture-model',
      value:
        budgets.length === 1
          ? [questions[0], { ...questions[2], difficulty: 'medium' }, questions[1]]
          : questions.slice(2)
    };
  });
  const result = await provider.generateStructuredQuestionSet({
    skill: 'mern',
    difficulty: 'easy',
    count: 5
  });
  assert.equal(result.length, 5);
  assert.deepEqual(budgets, [3, 2]);
  assert.match(prompts[1], /Generate 3 interview questions/);
  assert.ok(result.every((row) => row.difficulty === 'easy' && row.generationMeta.provider === 'fixture'));
});

test('semantic wrong-difficulty output falls through the existing manager to its next provider', async (t) => {
  t.mock.method(coordination, 'runAI', async (_key, operation) => operation(new AbortController().signal));
  t.mock.method(manager, 'getStatus', () => ({ enabledProviders: ['gemini', 'openai'] }));
  t.mock.method(manager, 'providerPriority', () => ['gemini', 'openai']);
  t.mock.method(manager, 'getProviderState', () => ({
    settings: { enabled: true },
    states: {
      gemini: { enabled: true, models: ['fixture'], apiKey: 'test-fixture-only' },
      openai: { enabled: true, models: ['fixture'], apiKey: 'test-fixture-only' }
    }
  }));
  for (const method of ['enter', 'release', 'record']) t.mock.method(admission, method, async () => ({}));
  t.mock.method(admission, 'circuit', async () => true);
  const attempts = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider: name, parseJson }) => {
    attempts.push(name);
    return parseJson(
      JSON.stringify(
        name === 'gemini' ? questions.map((row) => ({ ...row, difficulty: 'medium' })) : questions
      )
    );
  });
  const result = await provider.generateStructuredQuestionSet({
    skill: 'mern',
    difficulty: 'easy',
    count: 5
  });
  assert.equal(result.length, 5);
  assert.deepEqual(attempts, ['gemini', 'openai']);
  assert.equal(result.generation.attemptsUsed, 2);
});

test('provider failures and invalid output have distinct typed outcomes and cannot persist wrong difficulty', async (t) => {
  isolate(t);
  let mode = 'failure';
  t.mock.method(provider, 'generateStructuredQuestionSet', async () => {
    if (mode === 'failure') throw Object.assign(new Error('Unavailable'), { reasonCode: 'provider_error' });
    return questions.map((row) => ({ ...row, difficulty: 'medium' }));
  });
  await assert.rejects(
    service.generateFreshInterviewQuestions({ skill: 'mern', difficulty: 'easy', limit: 5 }),
    { code: 'ai_unavailable', generationStatus: 'provider_unavailable' }
  );
  mode = 'invalid';
  await assert.rejects(
    service.generateFreshInterviewQuestions({ skill: 'mern', difficulty: 'easy', limit: 5 }),
    { code: 'invalid_ai_response', generationStatus: 'invalid_response' }
  );
  assert.equal(repository.upsertQuestions.mock.callCount(), 0);
});

test('one cancelled caller does not cancel a concurrent caller; the last cancellation aborts shared work', async () => {
  const first = new AbortController(),
    second = new AbortController();
  let release,
    calls = 0;
  const operation = async (signal) => {
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
    assert.equal(signal.aborted, false);
    return 'shared';
  };
  const left = generationFlight('two-callers', operation, first.signal);
  const right = generationFlight('two-callers', operation, second.signal);
  await Promise.resolve();
  first.abort();
  await assert.rejects(left, { statusCode: 499 });
  release();
  assert.equal(await right, 'shared');
  assert.equal(calls, 1);
  const last = new AbortController();
  let sharedSignal;
  const pending = generationFlight(
    'last-caller',
    (signal) => {
      sharedSignal = signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      );
    },
    last.signal
  );
  await Promise.resolve();
  last.abort();
  await assert.rejects(pending, { statusCode: 499 });
  assert.equal(sharedSignal.aborted, true);
});

test('cancellation before persistence prevents generated question writes', async (t) => {
  isolate(t);
  const controller = new AbortController();
  t.mock.method(provider, 'generateStructuredQuestionSet', async () => {
    controller.abort();
    return questions;
  });
  await assert.rejects(
    service.generateFreshInterviewQuestions({
      skill: 'mern',
      difficulty: 'easy',
      limit: 5,
      signal: controller.signal
    }),
    { statusCode: 499 }
  );
  assert.equal(repository.upsertQuestions.mock.callCount(), 0);
});

test('coverage targets can vary by technology/difficulty and reporting covers every supported cell', () => {
  const previous = process.env.INTERVIEW_QUESTION_COVERAGE_TARGETS;
  try {
    process.env.INTERVIEW_QUESTION_COVERAGE_TARGETS = JSON.stringify({
      default: 30,
      difficulties: { hard: 12 },
      technologies: { mern: { easy: 40 } }
    });
    assert.equal(coverageTarget('MERN stack', 'easy'), 40);
    assert.equal(coverageTarget('react', 'hard'), 12);
    assert.equal(coverageTarget('angular', 'easy'), 30);
    const plan = coveragePlan({ mern: { easy: 5 } });
    assert.equal(plan.length, listImportantTopics().length * 4);
    assert.equal(plan.find((row) => row.technology === 'mern' && row.difficulty === 'easy').missing, 35);
    process.env.INTERVIEW_QUESTION_COVERAGE_TARGETS = '{"technologies":{"typo":{"easy":10}}}';
    assert.throws(() => coverageTarget('mern', 'easy'));
  } finally {
    if (previous === undefined) delete process.env.INTERVIEW_QUESTION_COVERAGE_TARGETS;
    else process.env.INTERVIEW_QUESTION_COVERAGE_TARGETS = previous;
  }
});

test('exclusion auditing reports missing canonical metadata and near duplicates without changing records', () => {
  const rows = [
    { ...questions[0], _id: 'a', qualityScore: 4 },
    { ...questions[0], _id: 'b', difficulty: 'medium' }
  ];
  const before = JSON.stringify(rows);
  const groups = groupCoverageExclusions(rows, new Set(['b']), new Map([['a', ['quality_score']]]));
  assert.equal(groups[0].reasons.quality_score, 1);
  assert.equal(groups[0].metadata.legacy_quality_scale_1_to_5, 1);
  assert.equal(nearDuplicateCoverage(rows).pairs, 1);
  assert.equal(JSON.stringify(rows), before);
});

test('bounded coverage resumes only the missing part of a stable run and stops at the cell target', () => {
  assert.equal(planCoverageBatch({ batch: 5, alreadyGenerated: 2, target: 30, available: 7 }), 3);
  assert.equal(planCoverageBatch({ batch: 5, alreadyGenerated: 5, target: 30, available: 10 }), 0);
  assert.equal(planCoverageBatch({ batch: 5, alreadyGenerated: 2, target: 30, available: 29 }), 1);
  assert.equal(planCoverageBatch({ batch: 5, alreadyGenerated: 0, target: 30, available: 30 }), 0);
  assert.throws(() => planCoverageBatch({ batch: 11, alreadyGenerated: 0, target: 30, available: 0 }));
});

test('poisoned Medium and Hard cache entries are evicted before answering an Easy request', async (t) => {
  isolate(t);
  const base =
    'interview:questions:bank=v14:block=all:topic=mern:page=1:limit=1:difficulty=easy:tags=:category=:source=ai';
  repository.findAllQuestionsPage.mock.mockImplementation(async (input) => {
    assert.equal(input.difficulty, 'easy');
    return { questions: [questions[0]], total: 1 };
  });
  for (const wrongDifficulty of ['medium', 'hard']) {
    const key = await cache.resolveInterviewCacheKey(base, 'mern');
    await cache.setCacheJson(
      key,
      { questions: [{ ...questions[1], difficulty: wrongDifficulty }], total: 1 },
      30
    );
    const result = await service.getQuestionBank({
      skill: 'MERN stack',
      difficulty: 'easy',
      source: 'ai',
      block: 'all',
      limit: 1
    });
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].difficulty, 'easy');
    assert.equal(result.questions[0].question, questions[0].question);
  }
  assert.equal(repository.findAllQuestionsPage.mock.callCount(), 2);
});

test('reusable search applies technology aliases, source and canonical difficulty before limiting', async (t) => {
  const Bank = require('../models/interviewQuestionBank');
  const captured = [];
  const query = {
    sort() {
      return this;
    },
    select() {
      return this;
    },
    limit() {
      return this;
    },
    async lean() {
      return [];
    }
  };
  t.mock.method(Bank, 'find', (filter) => {
    captured.push(filter);
    return query;
  });
  t.mock.method(Bank, 'findOne', (filter) => {
    captured.push(filter);
    return query;
  });
  for (const source of ['seed', 'ai', 'scraped', 'ai_generated']) {
    await repository.findSearchCandidates({ topicKey: 'MERN stack', difficulty: 'Easy', source, limit: 1 });
    await repository.findExactReusableQuestion({
      topicKey: 'MERN stack',
      question: questions[0].question,
      difficulty: 'Easy',
      source
    });
    for (const filter of captured.splice(0)) {
      assert.equal(filter.topicKey, 'mern');
      assert.equal(filter.difficulty, 'easy');
      assert.deepEqual(
        filter.sourceType,
        source === 'seed'
          ? { $in: ['verified_seed', 'prebuilt'] }
          : source === 'ai'
            ? { $in: ['ai', 'ai_generated', 'user_asked'] }
            : source
      );
    }
  }
  await repository.findAiGeneratedByTopic({ topicKey: 'MERN stack', difficulty: 'Easy', limit: 1 });
  assert.equal(captured[0].topicKey, 'mern');
  assert.equal(captured[0].difficulty, 'easy');
  assert.throws(() => repository.buildQuestionFilter({ topicKey: 'mern', difficulty: 'expert' }), {
    statusCode: 400
  });
});

test('a partial verified Mongo import is completed from canonical curated records before invoking AI', async (t) => {
  isolate(t);
  const catalog = require('../services/interviewQuestionSeedCatalog');
  const seeds = catalog
    .buildSeedRecordsForTopic(catalog.getImportantTopicByKey('javascript'))
    .filter((row) => row.difficulty === 'medium');
  repository.findAllQuestionsPage.mock.mockImplementation(async () => ({ questions: [seeds[0]], total: 1 }));
  t.mock.method(provider, 'generateStructuredQuestionSet', () =>
    assert.fail('The matching curated catalog must be consulted first')
  );
  const result = await service.generateFreshInterviewQuestions({
    skill: 'JavaScript',
    difficulty: 'medium',
    source: 'database',
    limit: 5
  });
  assert.equal(result.questions.length, 5);
  assert.equal(result.aiGeneratedCount, 0);
  assert.ok(
    result.questions.every(
      (row) =>
        row.topicKey === 'javascript' &&
        row.difficulty === 'medium' &&
        row.sourceType === 'verified_seed' &&
        row.answerSections?.shortAnswer
    )
  );
});
