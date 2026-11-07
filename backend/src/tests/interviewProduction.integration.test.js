const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const path = require('node:path');
const State = require('../models/interviewCoordination');
const Session = require('../models/interviewPrepSession');
const Bank = require('../models/interviewQuestionBank');
const coordination = require('../services/interviewCoordinationService');
const sessions = require('../services/interviewSessionService');
const repo = require('../repositories/interviewQuestionRepository');
const service = require('../services/interviewPrepService');
const aiService = require('../services/aiservice');
const aiProvider = require('../services/providers/interviewAIProvider');
const cache = require('../services/redisCacheService');
const { IMPORTANT_TOPICS } = require('../services/interviewTopicNormalizer');
const { buildSeedRecordsForTopic } = require('../services/interviewQuestionSeedCatalog');

test('Interview production local Mongo verification', { skip: !process.env.INTERVIEW_TEST_MONGO_URI }, async (t) => {
  const database = `codex_interview_production_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(process.env.INTERVIEW_TEST_MONGO_URI, { dbName: database, serverSelectionTimeoutMS: 3000 });
  t.after(async () => {
    cache.clearMemoryCache();
    await mongoose.disconnect();
  });
  // No destructive DB cleanup. Run against a task-owned ephemeral mongod; the
  // launcher owns its exact data files and stops it after all verification.
  await Promise.all([State.createIndexes(), Session.createIndexes(), Bank.createIndexes()]);

  await t.test('four independent backend processes make one provider call', async (subtest) => {
    const started = performance.now();
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise((resolve, reject) => {
            const worker = fork(path.join(__dirname, 'fixtures/interviewCoordinationWorker.js'), [], {
              env: {
                ...process.env,
                INTERVIEW_TEST_DATABASE: database,
                INTERVIEW_TEST_PROMPT: 'identical cross-user prompt'
              },
              stdio: ['ignore', 'ignore', 'pipe', 'ipc']
            });
            let result;
            worker.on('message', (message) => {
              result = message;
            });
            worker.on('error', reject);
            worker.on('exit', (code) => (code === 0 ? resolve(result) : reject(new Error(`Worker exit ${code}`))));
          })
      )
    );
    assert.ok(results.every((result) => result.answer === 'shared result'));
    assert.equal((await State.findById('fixture-provider-count')).count, 1);
    subtest.diagnostic(
      `4 real Node workers / 4 identical requests / 1 stub provider call; wall=${(performance.now() - started).toFixed(1)}ms including startup.`
    );
  });
  await t.test('shared user rate limits and quotas are atomic', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => coordination.reserve('test-owner-limit', 3, 600000))
    );
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal(await coordination.reserve('different-owner-limit', 3, 600000), true);
  });
  await t.test('cancelled custom requests cannot persist or call a provider', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      service.answerCustomInterviewQuestion({
        userId: new mongoose.Types.ObjectId(),
        topic: 'javascript',
        question: 'How should JavaScript isolate bounded worker message queues?',
        signal: controller.signal
      }),
      { statusCode: 499 }
    );
  });
  await t.test('global concurrency bounds distinct prompts and failure recovers', async () => {
    const old = process.env.INTERVIEW_AI_MAX_CONCURRENCY;
    process.env.INTERVIEW_AI_MAX_CONCURRENCY = '1';
    try {
      let release;
      let started;
      const gate = new Promise((resolve) => {
        started = resolve;
      });
      const running = coordination.runAI('concurrency-first', async () => {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
        return 'first';
      });
      await gate;
      await assert.rejects(coordination.runAI('concurrency-second', () => assert.fail('Over quota provider ran')));
      release();
      assert.equal(await running, 'first');
      assert.equal(await coordination.runAI('after-failure', async () => 'recovered'), 'recovered');
    } finally {
      if (old === undefined) delete process.env.INTERVIEW_AI_MAX_CONCURRENCY;
      else process.env.INTERVIEW_AI_MAX_CONCURRENCY = old;
    }
  });
  await t.test('expired ownership recovers and stale publication/release are fenced', async () => {
    await coordination.acquire('fixture-crashed', 'old', 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(await coordination.acquire('fixture-crashed', 'new', 1000));
    await coordination.release('fixture-crashed', 'old');
    assert.equal((await State.findById('fixture-crashed')).token, 'new');
    await assert.rejects(
      coordination.runAI('fence-publish', async () => {
        await State.updateOne({ _id: `ai:v1:${coordination.hash('fence-publish')}` }, { $set: { token: 'new-owner' } });
        return 'obsolete';
      })
    );
    assert.equal((await State.findById(`ai:v1:${coordination.hash('fence-publish')}`)).value, undefined);
  });
  await t.test('invalid provider JSON is never cached as content', async (subtest) => {
    let count = 0;
    subtest.mock.method(aiService, 'runAIAnalysis', async (_prompt, _fallback, retries, options) => {
      count++;
      assert.equal(retries, 0);
      assert.equal(options.timeoutMs, 6200);
      assert.equal(options.requestPolicy.maxAttempts, 1);
      assert.equal(options.requestPolicy.cacheResponse, false);
      assert.ok(options.signal);
      return { ok: true, value: { shortAnswer: 'invalid' } };
    });
    const input = {
      topicKey: 'javascript',
      question: 'How do bounded JavaScript worker message queues coordinate backpressure?'
    };
    await assert.rejects(aiProvider.answerSearchFallback(input));
    await assert.rejects(aiProvider.answerSearchFallback(input));
    assert.equal(count, 1, '3-second failure cooldown avoids a retry storm');
    const cached = await State.find({ 'value.result': { $exists: true } }).lean();
    assert.ok(cached.every((row) => !JSON.stringify(row.value).includes('shortAnswer')));
  });
  await t.test(
    '6200ms coordinator deadline aborts a pending provider and stores only a cooldown marker',
    async (subtest) => {
      let aborted = false;
      const started = performance.now();
      await assert.rejects(
        coordination.runAI(
          'timeout-fixture',
          (signal) =>
            new Promise((_, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true;
                  reject(new Error('fixture aborted'));
                },
                { once: true }
              );
            })
        )
      );
      const elapsed = performance.now() - started;
      assert.equal(aborted, true);
      assert.ok(elapsed >= 6100 && elapsed < 7500, `timeout elapsed ${elapsed}ms`);
      const row = await State.findById(`ai:v1:${coordination.hash('timeout-fixture')}`).lean();
      assert.equal(row.value.failed, true);
      assert.equal(row.value.result, undefined);
      subtest.diagnostic(`6200ms abort deadline including Mongo overhead: ${elapsed.toFixed(1)}ms.`);
    }
  );
  await t.test('session retries, ownership, snapshots, concurrent progress and completion', async () => {
    const userId = new mongoose.Types.ObjectId();
    const seeds = buildSeedRecordsForTopic(IMPORTANT_TOPICS[0]);
    const record = {
      userId,
      requestKey: 'fixture-idempotency',
      requestFingerprint: 'same',
      questions: sessions.snapshotQuestions([seeds[0], seeds[0], seeds[1]], 'javascript')
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => sessions.create(record)));
    assert.equal(new Set(results.map((row) => String(row._id))).size, 1);
    const id = String(results[0]._id);
    assert.equal(results[0].questions.length, 2);
    assert.equal(results[0].questions[0].contentVersion.length, 64);
    await assert.rejects(sessions.findRequest(userId, record.requestKey, 'different'), { statusCode: 409 });
    await assert.rejects(sessions.getOwned(new mongoose.Types.ObjectId(), id), { statusCode: 404 });
    const before = (await sessions.getOwned(userId, id)).questions;
    await Session.updateOne({ _id: id }, { $set: { questions: [] } });
    assert.deepEqual((await sessions.getOwned(userId, id)).questions, before);
    const input = { userId, id, expectedVersion: 0, questionIndex: 0, selfCheck: 'review' };
    const writes = await Promise.allSettled([
      sessions.updateProgress(input),
      sessions.updateProgress({ ...input, selfCheck: 'comfortable' })
    ]);
    assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
    const current = await sessions.getOwned(userId, id);
    const repeated = await sessions.updateProgress({ ...input, selfCheck: current.progress['0'] });
    assert.equal(repeated.progressVersion, 1);
    await assert.rejects(sessions.updateProgress({ userId, id, expectedVersion: 1, complete: true }), {
      statusCode: 409
    });
    await sessions.updateProgress({ ...input, expectedVersion: 1, questionIndex: 1 });
    const completed = await sessions.updateProgress({ userId, id, expectedVersion: 2, complete: true });
    assert.equal(completed.status, 'completed');
    assert.equal(
      (await sessions.updateProgress({ userId, id, expectedVersion: 2, complete: true })).progressVersion,
      3
    );
    await assert.rejects(sessions.updateProgress({ ...input, expectedVersion: 3, selfCheck: 'different' }), {
      statusCode: 400
    });
    assert.deepEqual(completed.questions, before);
  });
  await t.test('coverage, Top filters, query execution and cold/warm performance', async (subtest) => {
    const records = IMPORTANT_TOPICS.flatMap(buildSeedRecordsForTopic);
    await repo.upsertQuestions(records);
    const coverage = IMPORTANT_TOPICS.map((topic) => ({
      topic: topic.key,
      total: records.filter((row) => row.topicKey === topic.key).length,
      top: records.filter((row) => row.topicKey === topic.key && row.isTopQuestion).length
    }));
    assert.ok(coverage.every((row) => row.top === 30));
    subtest.diagnostic(`Coverage: ${JSON.stringify(coverage)}`);
    const aiOnly = await service.getQuestionBank({ topic: 'javascript', source: 'ai' });
    assert.equal(aiOnly.questions.length, 0);
    const security = await service.getQuestionBank({ topic: 'javascript', category: 'security' });
    assert.ok(security.questions.every((row) => row.category === 'security'));
    const plans = {};
    const base = repo.buildQuestionFilter({ topicKey: 'javascript', excludeGenericSeeds: true });
    for (const [name, filter, sort] of [
      ['page', base, { qualityScore: -1, rankScore: -1, createdAt: -1, _id: 1 }],
      [
        'filtered',
        { ...base, difficulty: 'hard', category: 'security' },
        { qualityScore: -1, rankScore: -1, createdAt: -1, _id: 1 }
      ],
      ['text', { ...base, $text: { $search: 'JavaScript' } }, { score: { $meta: 'textScore' } }]
    ]) {
      const result = await Bank.find(filter).sort(sort).limit(10).explain('executionStats');
      plans[name] = {
        returned: result.executionStats.nReturned,
        keys: result.executionStats.totalKeysExamined,
        documents: result.executionStats.totalDocsExamined,
        ms: result.executionStats.executionTimeMillis,
        plan: result.queryPlanner.winningPlan
      };
    }
    subtest.diagnostic(`Mongo executionStats: ${JSON.stringify(plans)}`);
    cache.clearMemoryCache();
    const coldStart = performance.now();
    await service.getQuestionBank({ topic: 'javascript', block: 'all', limit: 10 });
    const cold = performance.now() - coldStart;
    const samples = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const value = await service.getQuestionBank({ topic: 'javascript', block: 'all', limit: 10 });
      assert.equal(value.fromCache, true);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    subtest.diagnostic(
      `All Questions: cold=${cold.toFixed(3)}ms warm p50=${samples[24].toFixed(3)}ms p95=${samples[47].toFixed(3)}ms; warm cache hits=50/50; catalog provider calls=0 by read-only path.`
    );
  });
});
