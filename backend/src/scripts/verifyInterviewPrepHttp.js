require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/db');
const User = require('../models/user');

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(3));
};
const summary = (values) => ({ runs: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) });

const run = async () => {
  await connectDB();
  const user = await User.findOne({ isActive: { $ne: false } }).select('_id').lean();
  if (!user) throw new Error('No active user available for authenticated verification.');
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '15m', algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  const request = async (path) => {
    const started = process.hrtime.bigint();
    const response = await fetch(`http://127.0.0.1:5000${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (!response.ok) throw new Error(`${response.status}: ${body.message || 'request failed'}`);
    return { body, elapsedMs };
  };

  const boundaries = {};
  for (const topic of ['java', 'javascript', 'react', 'react-native', 'nodejs', 'nextjs', 'csharp', 'cpp']) {
    const { body } = await request(`/api/interview-prep/questions?topic=${encodeURIComponent(topic)}&block=top&limit=30`);
    boundaries[topic] = {
      count: body.questions?.length || 0,
      strict: (body.questions || []).every((item) => item.topicKey === topic),
      unique: new Set((body.questions || []).map((item) => String(item.question).toLowerCase())).size
    };
  }

  const cold = [];
  for (let index = 0; index < 7; index += 1) {
    cold.push(await request(`/api/interview-prep/search?topic=javascript&q=${encodeURIComponent('What is event delegation in JavaScript?')}&lookupOnly=true&page=${401 + index}&limit=5`));
  }
  const memoryPath = `/api/interview-prep/search?topic=javascript&q=${encodeURIComponent('What is event delegation in JavaScript?')}&lookupOnly=true&page=999&limit=5`;
  await request(memoryPath);
  const memory = [];
  for (let index = 0; index < 7; index += 1) memory.push(await request(memoryPath));

  console.log(`HTTP_VERIFY_RESULT=${JSON.stringify({
    authenticatedUser: String(user._id),
    boundaries,
    exactHttp: summary(cold.map((item) => item.elapsedMs)),
    memoryHttp: summary(memory.map((item) => item.elapsedMs)),
    memoryStages: summary(memory.map((item) => item.body.performance.memoryCacheMs)),
    memoryCounts: memory.map((item) => item.body.performance.counts),
    errors: []
  })}`);
};

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());