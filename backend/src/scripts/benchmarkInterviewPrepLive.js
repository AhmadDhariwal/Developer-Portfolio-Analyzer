require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const service = require('../services/interviewPrepService');
const seedCatalog = require('../services/interviewQuestionSeedCatalog');
const cache = require('../services/redisCacheService');

const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(3));
};
const summary = (values) => ({ runs: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
const stage = (rows, key) => summary(rows.map((row) => Number(row?.performance?.[key])).filter(Number.isFinite));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  await connectDB();
  await cache.initRedisCache({ silent: true });

  const exactRows = [];
  for (let index = 0; index < 7; index += 1) {
    exactRows.push(await service.searchQuestionBank({ q: 'What is event delegation in JavaScript?', topic: 'javascript', page: 101 + index, limit: 5, allowEnrichment: false }));
  }

  const similarityRows = [];
  for (let index = 0; index < 7; index += 1) {
    similarityRows.push(await service.searchQuestionBank({ q: 'How do closures work in JavaScript in production?', topic: 'javascript', page: 201 + index, limit: 5, allowEnrichment: false }));
  }

  const memoryKeyInput = { q: 'What is event delegation in JavaScript?', topic: 'javascript', page: 999, limit: 5, allowEnrichment: false };
  await service.searchQuestionBank(memoryKeyInput);
  const memoryRows = [];
  for (let index = 0; index < 8; index += 1) memoryRows.push(await service.searchQuestionBank(memoryKeyInput));

  const redisKey = `interview:search:benchmark:${Date.now()}`;
  await cache.setCacheJson(redisKey, { benchmark: true }, 60);
  await sleep(250);
  const redisRows = [];
  for (let index = 0; index < 7; index += 1) {
    cache.clearMemoryCache();
    redisRows.push(await cache.getCacheJsonWithMeta(redisKey));
  }

  const seedTimes = [];
  for (let index = 0; index < 7; index += 1) {
    const started = process.hrtime.bigint();
    seedCatalog.findSeedRecordByQuestion('javascript', 'What is event delegation in JavaScript?');
    seedTimes.push(Number(process.hrtime.bigint() - started) / 1e6);
  }

  const aiQuestions = [
    'How does JavaScript Atomics.waitAsync coordinate workers without blocking the main thread?',
    'What tradeoffs arise when JavaScript uses structuredClone with transferable objects?',
    'How would you design backpressure for a JavaScript ReadableStream consumed by a slow UI?',
    'How do JavaScript FinalizationRegistry cleanup callbacks affect resource management guarantees?',
    'When should JavaScript use scheduler.postTask priorities instead of timers?'
  ];
  const aiRows = [];
  for (const question of aiQuestions) {
    try {
      aiRows.push(await service.answerCustomInterviewQuestion({ userId: 'live-benchmark', topic: 'javascript', question }));
    } catch (error) {
      aiRows.push({ error: error.message, performance: error.performance || null });
    }
  }

  const concurrentQuestion = 'How should JavaScript coordinate a bounded worker pool with MessageChannel backpressure?';
  const concurrent = await Promise.allSettled(Array.from({ length: 5 }, () => service.answerCustomInterviewQuestion({ userId: 'live-benchmark', topic: 'javascript', question: concurrentQuestion })));
  const concurrentSample = concurrent.find((item) => item.status === 'fulfilled')?.value || concurrent.find((item) => item.status === 'rejected')?.reason;

  const output = {
    memoryCache: stage(memoryRows, 'memoryCacheMs'),
    redis: summary(redisRows.map((row) => row.redisMs)),
    mongoExact: stage(exactRows, 'mongoExactMs'),
    similarity: stage(similarityRows, 'similarityMs'),
    seed: summary(seedTimes),
    ai: stage(aiRows, 'aiMs'),
    validation: stage(aiRows, 'validationMs'),
    persistence: stage(aiRows, 'persistenceMs'),
    nonAiTotal: stage([...exactRows, ...similarityRows], 'totalMs'),
    aiTotal: stage(aiRows, 'totalMs'),
    sources: {
      exact: exactRows.map((row) => row.source),
      similarity: similarityRows.map((row) => row.source),
      ai: aiRows.map((row) => row.error || row.sourceLabel)
    },
    counts: {
      exact: exactRows.map((row) => row.performance?.counts),
      similarity: similarityRows.map((row) => row.performance?.counts),
      memory: memoryRows.map((row) => row.performance?.counts),
      ai: aiRows.map((row) => row.performance?.counts)
    },
    concurrency: {
      settled: concurrent.map((item) => item.status),
      counts: concurrentSample?.performance?.counts || null,
      totalMs: concurrentSample?.performance?.totalMs || null
    }
  };
  console.log(`BENCHMARK_RESULT=${JSON.stringify(output)}`);
  await sleep(300);
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await cache.closeRedisCache(); await mongoose.disconnect(); });