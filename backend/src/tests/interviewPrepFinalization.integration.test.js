const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Bank = require('../models/interviewQuestionBank');
const Session = require('../models/interviewPrepSession');
const Lease = require('../models/interviewJobLease');
const repository = require('../repositories/interviewQuestionRepository');
const service = require('../services/interviewPrepService');
const ai = require('../services/providers/interviewAIProvider');
const cache = require('../services/redisCacheService');
const { runInterviewJob } = require('../services/interviewJobService');
const { buildSeedRecordsForTopic, getImportantTopicByKey } = require('../services/interviewQuestionSeedCatalog');

test('Interview Prep isolated Mongo critical paths', { skip: !process.env.INTERVIEW_TEST_MONGO_URI }, async (t) => {
  const database = `codex_interview_test_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(process.env.INTERVIEW_TEST_MONGO_URI, {
    dbName: database,
    autoIndex: false,
    serverSelectionTimeoutMS: 5000
  });
  t.after(async () => {
    assert.equal(mongoose.connection.name, database, 'Only the task-owned database may be removed');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    cache.clearMemoryCache();
  });
  await Promise.all([Bank.createIndexes(), Session.createIndexes(), Lease.createIndexes()]);

  await t.test('real unique indexes and atomic trust protection survive competing workers', async () => {
    const seed = buildSeedRecordsForTopic(getImportantTopicByKey('javascript'))[0];
    const generated = {
      ...seed,
      sourceType: 'ai_generated',
      source: 'ai_generated',
      answer: 'Unverified competing answer.',
      sourceMeta: {},
      seedId: ''
    };
    await Promise.all([repository.upsertQuestions([generated]), repository.upsertQuestions([seed])]);
    await repository.upsertQuestions([generated]);
    const saved = await Bank.findOne({
      topicKey: 'javascript',
      normalizedQuestionHash: repository.toQuestionHash(seed.question)
    }).lean();
    assert.equal(saved.answer, seed.answer);
    assert.equal(saved.sourceType, 'verified_seed');
    assert.equal(saved.isApproved, true);
    const concurrent = {
      ...generated,
      question: 'How does JavaScript isolate a bounded worker message queue?',
      seedId: '',
      normalizedQuestion: '',
      normalizedQuestionHash: '',
      canonicalQuestionKey: ''
    };
    await Promise.all(Array.from({ length: 4 }, () => repository.upsertQuestions([concurrent])));
    assert.equal(await Bank.countDocuments({ question: concurrent.question }), 1);
  });

  await t.test('All Questions paginates past 500 records with stable nonoverlapping pages', async () => {
    await Bank.insertMany(
      Array.from({ length: 620 }, (_, index) => ({
        topicKey: 'qa-pagination',
        skill: 'qa-pagination',
        question: `Fixture question ${index}?`,
        normalizedQuestion: `fixture ${index}`,
        answer: 'Test fixture answer.',
        qualityScore: 90,
        confidenceScore: 0.9,
        relevanceScore: 0.9,
        createdAt: new Date('2026-01-01')
      }))
    );
    const first = await repository.findAllQuestionsPage({ topicKey: 'qa-pagination', page: 60, limit: 10 });
    const next = await repository.findAllQuestionsPage({ topicKey: 'qa-pagination', page: 61, limit: 10 });
    assert.equal(first.total, 620);
    assert.equal(first.questions.length, 10);
    assert.equal(next.questions.length, 10);
    assert.equal(new Set([...first.questions, ...next.questions].map((row) => String(row._id))).size, 20);
    await repository.incrementUsageStats(first.questions.map((row) => row._id));
    const repeated = await repository.findAllQuestionsPage({ topicKey: 'qa-pagination', page: 60, limit: 10 });
    assert.deepEqual(
      repeated.questions.map((row) => String(row._id)),
      first.questions.map((row) => String(row._id))
    );
  });

  await t.test('scraped and legacy private content cannot enter public approved results', async () => {
    const seed = buildSeedRecordsForTopic(getImportantTopicByKey('react'))[0];
    await repository.upsertQuestions([
      { ...seed, sourceType: 'scraped', source: 'scraped', sourceMeta: {}, seedId: '' }
    ]);
    const stored = await Bank.findOne({ topicKey: 'react' }).lean();
    assert.equal(stored.isApproved, false);
    assert.equal(stored.reviewStatus, 'pending');
    assert.equal((await repository.findAllQuestionsPage({ topicKey: 'react' })).total, 0);
    await Bank.updateOne(
      { _id: stored._id },
      {
        $set: {
          sourceType: 'ai_generated',
          isApproved: true,
          qualityStatus: 'approved',
          reviewStatus: 'approved',
          qualityState: 'approved',
          sourceMeta: { userId: 'historical-owner' }
        }
      }
    );
    assert.equal((await repository.findAllQuestionsPage({ topicKey: 'react' })).total, 0);
    assert.ok(await Bank.findById(stored._id), 'Historical data is retained');
  });

  await t.test('Mongo lease excludes overlapping workers, releases on failure, and retries', async () => {
    let release;
    let started;
    const gate = new Promise((resolve) => {
      started = resolve;
    });
    const running = runInterviewJob(async () => {
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return 'finished';
    });
    await gate;
    assert.deepEqual(await runInterviewJob(async () => assert.fail('Overlapping job executed')), { skipped: true });
    release();
    assert.equal(await running, 'finished');
    await assert.rejects(
      runInterviewJob(async () => {
        throw new Error('retry fixture');
      }),
      /retry fixture/
    );
    assert.equal(await runInterviewJob(async () => 'retried'), 'retried');
  });

  await t.test('owned history remains bounded and isolated', async () => {
    const owner = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    await Session.create([
      { userId: owner, questions: [] },
      { userId: other, questions: [] }
    ]);
    const history = await service.listInterviewPrepHistory(owner, 100000);
    assert.equal(history.length, 1);
    assert.equal(String(history[0].userId), String(owner));
  });

  await t.test('Top 30 and text search read existing data without AI, scraper, or seed writes', async (subtest) => {
    const aiMock = subtest.mock.method(ai, 'answerSearchFallback', async () => assert.fail('AI called by browsing'));
    const writeMock = subtest.mock.method(repository, 'upsertQuestions', async () =>
      assert.fail('Read path wrote seeds')
    );
    const top = await service.getQuestionBank({ topic: 'javascript', block: 'top', limit: 30 });
    assert.equal(top.questions.length, 30);
    const search = await service.searchQuestionBank({
      topic: 'javascript',
      q: 'JavaScript',
      allowEnrichment: false,
      limit: 5
    });
    assert.ok(search.total > 0);
    assert.ok(search.questions.length <= 5);
    assert.equal(aiMock.mock.callCount(), 0);
    assert.equal(writeMock.mock.callCount(), 0);
    const samples = [];
    for (let index = 0; index < 20; index++) {
      const started = performance.now();
      await service.getQuestionBank({ topic: 'javascript', block: 'top', limit: 30 });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    subtest.diagnostic(
      `Warm Top 30 (20 requests, local Mongo, Redis disabled): p50=${samples[9].toFixed(3)}ms p95=${samples[18].toFixed(3)}ms; zero provider calls/writes.`
    );
  });

  await t.test('custom AI answers persist privately, reuse owned history, and isolate users', async (subtest) => {
    const sections = {
      shortAnswer: 'A JavaScript microtask checkpoint drains promise reactions before the next event-loop task runs.',
      keyPoints: [
        'Microtasks drain after the current JavaScript stack',
        'Tasks run in separate event-loop turns',
        'Unbounded microtasks can starve rendering'
      ],
      explanation:
        'The browser executes one task and then drains queued promise reactions and queueMicrotask callbacks. A rendering opportunity follows before another task is selected. This ordering provides predictable follow-up work, while recursively scheduling microtasks risks starving timers and user input.',
      example: 'setTimeout(() => console.log("task")); Promise.resolve().then(() => console.log("microtask"));',
      realWorldUseCase: 'JavaScript frameworks batch state updates before yielding for rendering and input.',
      commonMistakes: ['Treating promises as timer callbacks', 'Recursively scheduling microtasks without yielding'],
      interviewTip: 'Explain stack completion, the microtask checkpoint, rendering, and the next task.'
    };
    const provider = subtest.mock.method(ai, 'answerSearchFallback', async () => ({
      answer: Object.values(sections).flat().join(' '),
      answerSections: sections,
      difficulty: 'hard',
      category: 'core-concepts',
      tags: ['javascript', 'microtasks'],
      qualityScore: 94
    }));
    const owner = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const input = {
      userId: owner,
      topic: 'javascript',
      question: 'How do JavaScript microtask checkpoints differ from separate task queue turns?'
    };
    const first = await service.answerCustomInterviewQuestion(input);
    assert.equal(first.sourceType, 'ai_generated');
    assert.equal(first.verificationStatus, 'unverified');
    assert.ok(first.sessionId);
    assert.equal(await Bank.countDocuments({ question: input.question }), 0);
    cache.clearMemoryCache();
    const reused = await service.answerCustomInterviewQuestion(input);
    assert.equal(String(reused.sessionId), String(first.sessionId));
    assert.equal(provider.mock.callCount(), 1);
    const separated = await service.answerCustomInterviewQuestion({ ...input, userId: other });
    assert.notEqual(String(separated.sessionId), String(first.sessionId));
    assert.equal(provider.mock.callCount(), 2);
  });

  await t.test(
    'authenticated API contracts, input rejection, practice fallback, and canonical personalization',
    async (subtest) => {
      const express = require('express');
      const jwt = require('jsonwebtoken');
      const User = require('../models/user');
      const previousSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = 'isolated-interview-test-secret';
      subtest.after(() => {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
      });
      const user = await User.create({
        name: 'Interview Fixture',
        email: `${randomUUID()}@example.test`,
        providers: ['github'],
        authProvider: 'github',
        activeCareerStack: 'Frontend',
        activeExperienceLevel: 'Student'
      });
      const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '5m'
      });
      const app = express();
      app.use(express.json());
      app.use('/api/interview-prep', require('../routes/interviewPrep.routes'));
      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      subtest.after(() => new Promise((resolve) => server.close(resolve)));
      const request = async (path, body, authenticated = true) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/interview-prep${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(authenticated ? { Authorization: `Bearer ${token}` } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, body: await response.json() };
      };
      assert.equal((await request('/history', null, false)).status, 401);
      assert.equal((await request('/search?q[bad]=input&topic=javascript')).status, 400);
      assert.equal((await request('/generate', { skill: { $ne: '' } })).status, 400);
      const top = await request('/questions?topic=javascript&block=top&limit=30');
      assert.equal(top.status, 200);
      assert.equal(top.body.questions.length, 30);
      assert.equal((await request('/search?topic=javascript&q=JavaScript')).status, 200);
      subtest.mock.method(ai, 'generateStructuredQuestionSet', async () => {
        throw new Error('provider unavailable fixture');
      });
      const practice = await request('/generate', { topic: 'javascript', limit: 5 });
      assert.equal(practice.status, 200);
      assert.ok(practice.body.questions.length > 0);
      const session = await request('', {
        careerStack: 'Untrusted request override',
        experienceLevel: 'Senior',
        skillGaps: ['invented inability']
      });
      assert.equal(session.status, 200);
      const persisted = await Session.findById(session.body.sessionId).lean();
      assert.equal(persisted.careerStack, 'Frontend');
      assert.equal(persisted.experienceLevel, 'Student');
      assert.deepEqual(persisted.skillGaps, []);
      assert.match(session.body.personalization.limitation, /evidence|ability|scores/i);
      assert.equal((await request('/history?limit=99999')).status, 200);
    }
  );

  await t.test('explicit custom generation honors the existing 6500ms AI deadline', async (subtest) => {
    subtest.mock.method(ai, 'answerSearchFallback', () => new Promise(() => {}));
    const started = performance.now();
    const result = await service.answerCustomInterviewQuestion({
      userId: new mongoose.Types.ObjectId(),
      topic: 'javascript',
      question: 'How should JavaScript coordinate MessageChannel backpressure for isolated worker scheduling?'
    });
    const elapsed = performance.now() - started;
    assert.equal(result.sourceType, 'no_verified_answer');
    assert.equal(result.stored, false);
    assert.ok(elapsed >= 6400 && elapsed < 8000, `6500ms deadline plus local database overhead: ${elapsed}ms`);
    subtest.diagnostic(`AI timeout fallback completed in ${elapsed.toFixed(1)}ms (existing AI budget: 6500ms).`);
  });
});
