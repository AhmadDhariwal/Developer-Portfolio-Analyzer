require('dotenv').config();
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/user');

const cases = [
  ['mysql', 'What is the difference between an index and a transaction?'],
  ['oop', 'What is the difference between inheritance and polymorphism?'],
  ['javascript', 'What is the difference between Java and JavaScript?'],
  ['sql', 'What is an SQL JOIN?'],
  ['react', 'How does React reconciliation work?']
];

const run = async () => {
  await connectDB();
  const user = await User.findOne({ isActive: { $ne: false } }).select('_id').lean();
  assert.ok(user, 'An authenticated test user is required.');
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '10m', algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  const results = [];
  for (const [topic, question] of cases) {
    const startedAt = Date.now();
    const response = await fetch('http://127.0.0.1:5000/api/interview-prep/ask-question', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, question })
    });
    const body = await response.json();
    assert.equal(response.status, 200, `${question}: HTTP ${response.status}`);
    assert.notEqual(body.sourceType, 'no_verified_answer', `${question}: no useful answer`);
    assert.ok(body.answerSections?.shortAnswer, `${question}: missing shortAnswer`);
    assert.ok(body.answerSections?.explanation, `${question}: missing explanation`);
    assert.ok(Array.isArray(body.answerSections?.keyPoints) && body.answerSections.keyPoints.length >= 3, `${question}: incomplete keyPoints`);
    assert.doesNotMatch(body.answer, /define the concept|explain relevant|provide a relevant example|no verified answer/i);
    results.push({ question, topic, sourceType: body.sourceType, elapsedMs: Date.now() - startedAt, aiMs: body.performance?.aiMs || 0, qualityScore: body.qualityScore, confidenceScore: body.confidenceScore, relevanceScore: body.relevanceScore });
  }
  console.log(`INTERVIEW_AI_LIVE_RESULT=${JSON.stringify(results)}`);
};

run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
