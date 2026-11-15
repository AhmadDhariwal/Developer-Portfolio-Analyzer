const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFilters, matchesFilters } = require('../services/interviewQuestionFilters');
const service = require('../services/interviewPrepService');
const repository = require('../repositories/interviewQuestionRepository');
const provider = require('../services/providers/interviewAIProvider');
const { buildSeedRecordsForTopic } = require('../services/interviewQuestionSeedCatalog');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const redis = require('../services/redisCacheService');

test('every filter independently and combined rejects mismatches, preserving source and technology', () => {
  const row = {
    topicKey: 'system-design',
    difficulty: 'easy',
    category: 'core-concepts',
    tags: ['scaling'],
    sourceType: 'verified_seed',
    question: 'Explain scaling services',
    answer: 'Capacity planning'
  };
  for (const input of [
    { difficulty: 'easy' },
    { technology: 'system_design' },
    { category: 'core-concepts' },
    { tags: ['scaling'] },
    { query: 'scaling' },
    { source: 'seed' },
    {
      difficulty: 'easy',
      technology: 'system_design',
      category: 'core-concepts',
      tags: 'scaling',
      query: 'scaling',
      source: 'seed'
    }
  ]) {
    const filters = normalizeFilters({ skill: 'system-design', ...input });
    assert.equal(matchesFilters(row, filters), true);
    if (input.difficulty) assert.equal(matchesFilters({ ...row, difficulty: 'hard' }, filters), false);
    if (input.technology) assert.equal(matchesFilters({ ...row, topicKey: 'react' }, filters), false);
    if (input.category) assert.equal(matchesFilters({ ...row, category: 'debugging' }, filters), false);
    if (input.tags) assert.equal(matchesFilters({ ...row, tags: [] }, filters), false);
    if (input.query)
      assert.equal(matchesFilters({ ...row, question: 'Other', answer: 'Other' }, filters), false);
    if (input.source) assert.equal(matchesFilters({ ...row, sourceType: 'ai_generated' }, filters), false);
  }
  assert.throws(() => normalizeFilters({ difficulty: 'expert' }), { statusCode: 400 });
});

test('database predicates include difficulty, topic, tags and source before pagination', () => {
  const filter = repository.buildQuestionFilter({
    topicKey: 'system_design',
    difficulty: 'easy',
    tags: 'scaling',
    source: 'seed',
    query: 'capacity'
  });
  assert.equal(filter.topicKey, 'system-design');
  assert.equal(filter.difficulty, 'easy');
  assert.deepEqual(filter.tags, { $in: ['scaling'] });
  assert.deepEqual(filter.sourceType, { $in: ['verified_seed', 'prebuilt'] });
  assert.deepEqual(filter.$text, { $search: 'capacity' });
});

test('Easy generation never returns Hard from Mongo reuse, verified fallback or AI; caches isolate combinations', async (t) => {
  const topic = listImportantTopics().find((item) => item.key === 'javascript');
  const seeds = buildSeedRecordsForTopic(topic);
  const easy = seeds[0];
  const hard = { ...easy, difficulty: 'hard', sourceType: 'ai_generated' };
  t.mock.method(repository, 'findAiGeneratedByTopic', async () => [hard]);
  t.mock.method(repository, 'fetchComparableQuestionsByTopic', async () => []);
  t.mock.method(repository, 'getSourceMixByTopic', async () => ({}));
  t.mock.method(repository, 'findTopQuestions', async () => {
    throw new Error('fixture DB unavailable');
  });
  t.mock.method(repository, 'findAllQuestionsPage', async () => {
    throw new Error('fixture DB unavailable');
  });
  t.mock.method(provider, 'generateStructuredQuestionSet', async () => [hard]);
  const writes = t.mock.method(repository, 'upsertQuestions', async () => ({}));
  for (const source of ['', 'seed', 'ai']) {
    const input = { skill: 'javascript', difficulty: 'easy', limit: 2, source };
    await assert.rejects(service.generateFreshInterviewQuestions(input), { statusCode: 503 });
  }
  assert.equal(writes.mock.callCount(), 0);
  const easyResult = await service.getQuestionBank({ skill: 'javascript', difficulty: 'easy' });
  const hardResult = await service.getQuestionBank({ skill: 'javascript', difficulty: 'hard' });
  const mediumResult = await service.getQuestionBank({ skill: 'javascript', difficulty: 'medium' });
  assert.ok(mediumResult.questions.length > 0);
  assert.ok(mediumResult.questions.every((item) => item.difficulty === 'medium'));
  assert.ok(easyResult.questions.every((item) => item.difficulty === 'easy'));
  assert.ok(hardResult.questions.every((item) => item.difficulty === 'hard'));
  const empty = await service.getQuestionBank({ skill: 'javascript', difficulty: 'easy', source: 'ai' });
  assert.equal(empty.questions.length, 0);
  repository.findAllQuestionsPage.mock.mockImplementation(async () => ({
    questions: [{ ...easy, difficulty: 'easy' }],
    total: 1
  }));
  await redis.invalidateInterviewPrepCache('javascript');
  const accepted = await service.generateFreshInterviewQuestions({
    skill: 'javascript',
    difficulty: 'easy',
    limit: 1
  });
  assert.equal(accepted.questions.length, 1);
  assert.equal(accepted.questions[0].difficulty, 'easy');
  await redis.closeRedisCache();
});

test('Mongo all-bank query applies category, difficulty, source and tags before skip/limit', async (t) => {
  const Model = require('../models/interviewQuestionBank');
  let captured;
  const operations = [];
  const cursor = {
    sort() {
      return this;
    },
    hint(value) {
      assert.equal(value, 'topic_stable_page');
      return this;
    },
    skip(value) {
      operations.push(['skip', value]);
      return this;
    },
    limit(value) {
      operations.push(['limit', value]);
      return this;
    },
    maxTimeMS() {
      return this;
    },
    async lean() {
      return [];
    }
  };
  t.mock.method(Model, 'find', (filter) => {
    captured = filter;
    return cursor;
  });
  t.mock.method(Model, 'countDocuments', () => ({
    hint: (name) => {
      assert.equal(name, 'topic_stable_page');
      return { maxTimeMS: async () => 0 };
    }
  }));
  await repository.findAllQuestionsPage({
    topicKey: 'system_design',
    difficulty: 'easy',
    category: 'core-concepts',
    tags: 'scaling',
    source: 'ai',
    page: 2,
    limit: 5
  });
  assert.equal(captured.topicKey, 'system-design');
  assert.equal(captured.difficulty, 'easy');
  assert.equal(captured.category, 'core-concepts');
  assert.deepEqual(captured.tags, { $in: ['scaling'] });
  assert.deepEqual(captured.sourceType, { $in: ['ai', 'ai_generated', 'user_asked'] });
  assert.deepEqual(operations, [
    ['skip', 5],
    ['limit', 5]
  ]);
});

test('saved Sessions fingerprint the filters and retain owner-scoped immutable snapshots', async (t) => {
  const sessions = require('../services/interviewSessionService');
  const topic = listImportantTopics().find((item) => item.key === 'javascript');
  const row = { ...buildSeedRecordsForTopic(topic)[0], difficulty: 'easy' };
  t.mock.method(repository, 'findAllQuestionsPage', async () => ({ questions: [row], total: 1 }));
  t.mock.method(repository, 'getSourceMixByTopic', async () => ({}));
  const requests = [];
  t.mock.method(sessions, 'findRequest', async (...args) => {
    requests.push(args);
    return null;
  });
  t.mock.method(sessions, 'create', async (record) => ({ ...record, _id: 'session' }));
  await redis.invalidateInterviewPrepCache('javascript');
  const result = await service.generateInterviewPrepSessionFromBank({
    userId: 'owner',
    skill: 'javascript',
    difficulty: 'easy',
    limit: 1,
    idempotencyKey: 'request'
  });
  assert.equal(result.session.userId, 'owner');
  assert.equal(result.questions[0].difficulty, 'easy');
  assert.equal(result.questions[0].verificationStatus, 'verified');
  assert.ok(result.questions[0].contentVersion);
  const first = requests[0][2];
  sessions.findRequest.mock.mockImplementation(async (...args) => {
    requests.push(args);
    return result.session;
  });
  await assert.rejects(
    service.generateInterviewPrepSessionFromBank({
      userId: 'owner',
      skill: 'javascript',
      difficulty: 'hard',
      limit: 1,
      idempotencyKey: 'request'
    }),
    { statusCode: 409 }
  );
  assert.notEqual(requests[1][2], first);
  assert.equal(requests[1][0], 'owner');
});

test('Easy generation rejects Medium, Hard and Senior AI responses when no matching bank rows exist', async (t) => {
  const topic = listImportantTopics().find((item) => item.key === 'javascript');
  const example = buildSeedRecordsForTopic(topic)[0];
  t.mock.method(repository, 'findAllQuestionsPage', async () => ({ questions: [], total: 0 }));
  t.mock.method(repository, 'findTopQuestions', async () => []);
  t.mock.method(repository, 'getSourceMixByTopic', async () => ({}));
  t.mock.method(repository, 'findAiGeneratedByTopic', async () => []);
  t.mock.method(repository, 'fetchComparableQuestionsByTopic', async () => []);
  let level = 'medium';
  t.mock.method(provider, 'generateStructuredQuestionSet', async () => [
    { ...example, sourceType: 'ai_generated', difficulty: level }
  ]);
  const writes = t.mock.method(repository, 'upsertQuestions', async () => ({}));
  for (level of ['medium', 'hard', 'senior']) {
    await redis.invalidateInterviewPrepCache('javascript');
    await assert.rejects(
      service.generateFreshInterviewQuestions({
        skill: 'javascript',
        difficulty: 'easy',
        source: 'ai',
        limit: 1
      }),
      { statusCode: 503 }
    );
  }
  assert.equal(writes.mock.callCount(), 0);
});
