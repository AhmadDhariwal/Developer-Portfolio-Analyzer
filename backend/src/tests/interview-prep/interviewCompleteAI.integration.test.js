const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Bank = require('../../modules/interview-prep/models/interviewQuestionBank');
const Session = require('../../modules/interview-prep/models/interviewPrepSession');
const service = require('../../modules/interview-prep/services/interviewPrepService');
const provider = require('../../modules/interview-prep/providers/interviewAIProvider');
const cache = require('../../core/cache/redisCacheService');

test(
  'complete AI flow against task-owned MongoDB with deterministic provider fixtures',
  { skip: !process.env.INTERVIEW_TEST_MONGO_URI },
  async (t) => {
    await mongoose.connect(process.env.INTERVIEW_TEST_MONGO_URI, {
      dbName: `codex_complete_ai_${randomUUID().replaceAll('-', '')}`,
      autoIndex: false
    });
    t.after(async () => {
      cache.clearMemoryCache();
      await mongoose.disconnect();
    });
    await Promise.all([Bank.createIndexes(), Session.createIndexes()]);
    const sections = {
      shortAnswer: 'MERN combines MongoDB, Express, React and Node.js to build a JavaScript web application.',
      keyPoints: [
        'MongoDB stores documents',
        'Express routes HTTP requests on Node.js',
        'React renders the user interface'
      ],
      explanation:
        'In a MERN application, React sends HTTP requests to an Express server running on Node.js. The server validates inputs and reads documents from MongoDB. It returns JSON that React displays. Keeping database access on the server avoids exposing database credentials in the browser.',
      example: 'const response = await fetch("/api/products");\nconst products = await response.json();',
      realWorldUseCase:
        'A small product catalog uses React for browsing, Express for product endpoints and MongoDB for document storage.',
      commonMistakes: [
        'Connecting the browser directly to the database',
        'Assuming Express replaces the Node.js runtime'
      ],
      interviewTip: 'Name all four technologies and trace one HTTP request through the stack.'
    };
    const fixture = {
      question: 'What are the four components of the MERN stack?',
      topicKey: 'mern',
      answer: provider.toStructuredAnswerText(sections),
      answerSections: sections,
      difficulty: 'easy',
      tags: ['mern'],
      category: 'core-concepts',
      qualityScore: 90,
      confidenceScore: 0.9
    };
    const calls = t.mock.method(provider, 'generateStructuredQuestionSet', async () => [fixture]);
    const result = await service.generateFreshInterviewQuestions({
      skill: 'mern',
      difficulty: 'easy',
      limit: 1
    });
    assert.equal(result.questions[0].verificationStatus, 'unverified');
    const persisted = await Bank.findOne({ question: fixture.question }).lean();
    assert.equal(persisted.sourceMeta.verificationStatus, 'unverified');
    assert.equal(persisted.sourceType, 'ai_generated');
    cache.clearMemoryCache();
    const reused = await service.generateFreshInterviewQuestions({
      skill: 'mern',
      difficulty: 'easy',
      limit: 1
    });
    assert.equal(reused.questions.length, 1);
    assert.equal(calls.mock.callCount(), 1);
    const owner = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const saved = await service.generateInterviewPrepSessionFromBank({
      userId: owner,
      skill: 'mern',
      difficulty: 'easy',
      limit: 1,
      idempotencyKey: 'saved-request'
    });
    await Bank.updateOne(
      { _id: persisted._id },
      { $set: { difficulty: 'hard', answer: 'New catalog answer' } }
    );
    const sessions = require('../../modules/interview-prep/services/interviewSessionService');
    const snapshot = await sessions.getOwned(owner, saved.sessionId);
    assert.equal(snapshot.questions[0].difficulty, 'easy');
    assert.equal(snapshot.questions[0].topicKey, 'mern');
    assert.ok(snapshot.questions[0].sourceMeta.generatedAt);
    assert.equal(snapshot.questions[0].answerSections.example, sections.example);
    await assert.rejects(service.deleteInterviewPrepSession(other, saved.sessionId), { statusCode: 404 });
    assert.equal((await service.deleteInterviewPrepSession(owner, saved.sessionId)).deleted, true);
    await assert.rejects(sessions.getOwned(owner, saved.sessionId), { statusCode: 404 });
  }
);
