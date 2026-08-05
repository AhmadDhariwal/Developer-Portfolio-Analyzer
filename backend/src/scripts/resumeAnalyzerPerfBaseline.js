'use strict';

/**
 * Post-optimization resume analyzer timings (memory / redis / mongo / cold).
 * Run: node src/scripts/resumeAnalyzerPerfBaseline.js
 */
process.env.NODE_ENV = 'test';
process.env.RESUME_TIMING = '1';

const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const Module = require('node:module');

const servicePath = require.resolve('../services/resumeservice');
const redisPath = require.resolve('../services/redisCacheService');

const SAMPLE = [
  'Jane Developer',
  'jane@example.com',
  '+1 555 0100',
  'EXPERIENCE',
  'Built Node.js APIs and reduced latency by 30% for 100 users.',
  'Led TypeScript migration across 4 services.',
  'PROJECTS',
  'Created an Angular dashboard with TypeScript and Redis caching.',
  'SKILLS',
  'Node.js, Angular, TypeScript, MongoDB, Redis, Docker'
].join('\n');

const normalize = (text) => String(text || '')
  .replace(/\r/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] || 0;
};

const summarize = (label, samples) => ({
  label,
  n: samples.length,
  p50: Number(percentile(samples, 50).toFixed(2)),
  p95: Number(percentile(samples, 95).toFixed(2))
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const state = {
    counters: { ai: 0, mongoReads: 0, mongoWrites: 0, redisGets: 0, redisSets: 0 },
    mongo: new Map(),
    redis: new Map()
  };

  const redisService = {
    async getCacheJsonWithMeta(key) {
      state.counters.redisGets += 1;
      await delay(1);
      const raw = state.redis.get(key);
      if (!raw) return { value: null, layer: 'miss', memoryMs: 0, redisMs: 1 };
      return { value: structuredClone(raw), layer: 'redis', memoryMs: 0, redisMs: 1 };
    },
    async setCacheJson(key, payload) {
      state.counters.redisSets += 1;
      state.redis.set(key, structuredClone(payload));
    }
  };

  const ResumeAnalysisCache = {
    findOne(query) {
      state.counters.mongoReads += 1;
      const key = `${query.userId}:${query.resumeFileId}:${query.resumeHash}:${query.analysisVersion}`;
      const chain = {
        select() { return chain; },
        lean: async () => {
          await delay(2);
          return state.mongo.get(key) || null;
        }
      };
      return chain;
    },
    async findOneAndUpdate(query, update) {
      state.counters.mongoWrites += 1;
      const key = `${query.userId}:${query.resumeFileId}:${query.resumeHash}:${query.analysisVersion}`;
      const row = { ...update.$set, analyzedAt: new Date() };
      state.mongo.set(key, row);
      return row;
    },
    async updateOne() {}
  };

  delete require.cache[servicePath];
  delete require.cache[redisPath];
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (String(request).includes('redisCacheService')) return redisService;
    if (String(request).includes('aiservice') || request === './aiservice') {
      return {
        async runAIAnalysis(_p, fallback, retries, options) {
          state.counters.ai += 1;
          await delay(5);
          return fallback;
        }
      };
    }
    if (String(request).includes('resumeAnalysisCache')) return ResumeAnalysisCache;
    return originalLoad.call(this, request, parent, isMain);
  };

  let service;
  try {
    service = require(servicePath);
  } finally {
    Module._load = originalLoad;
  }

  service.clearResumeAnalysisMemoryCache();
  const coldSamples = [];
  for (let i = 0; i < 12; i += 1) {
    service.clearResumeAnalysisMemoryCache();
    state.mongo.clear();
    state.redis.clear();
    const started = performance.now();
    await service.analyzeResume(SAMPLE, 'resume.pdf', 2048, {
      userId: `user-${i}`,
      resumeFileId: `file-${i}`,
      forceRefresh: true
    });
    coldSamples.push(performance.now() - started);
  }

  service.clearResumeAnalysisMemoryCache();
  state.mongo.clear();
  state.redis.clear();
  state.counters.ai = 0;
  const seeded = await service.analyzeResume(SAMPLE, 'resume.pdf', 2048, {
    userId: 'user-cache',
    resumeFileId: 'file-cache',
    forceRefresh: true
  });
  const hash = crypto.createHash('sha256').update(normalize(SAMPLE)).digest('hex');

  const memorySamples = [];
  for (let i = 0; i < 25; i += 1) {
    const started = performance.now();
    await service.findCachedResumeAnalysis({
      userId: 'user-cache',
      resumeFileId: 'file-cache',
      resumeHash: hash,
      analysisVersion: service.ANALYSIS_VERSION
    });
    memorySamples.push(performance.now() - started);
  }

  service.clearResumeAnalysisMemoryCache();
  const redisSamples = [];
  for (let i = 0; i < 20; i += 1) {
    service.clearResumeAnalysisMemoryCache();
    const started = performance.now();
    await service.findCachedResumeAnalysis({
      userId: 'user-cache',
      resumeFileId: 'file-cache',
      resumeHash: hash,
      analysisVersion: service.ANALYSIS_VERSION
    });
    redisSamples.push(performance.now() - started);
  }

  service.clearResumeAnalysisMemoryCache();
  state.redis.clear();
  const mongoSamples = [];
  for (let i = 0; i < 15; i += 1) {
    service.clearResumeAnalysisMemoryCache();
    state.redis.clear();
    const started = performance.now();
    await service.findCachedResumeAnalysis({
      userId: 'user-cache',
      resumeFileId: 'file-cache',
      resumeHash: hash,
      analysisVersion: service.ANALYSIS_VERSION
    });
    mongoSamples.push(performance.now() - started);
  }

  state.counters.ai = 0;
  state.counters.mongoWrites = 0;
  service.clearResumeAnalysisMemoryCache();
  state.mongo.clear();
  state.redis.clear();
  await Promise.all(Array.from({ length: 5 }, () => service.analyzeResume(SAMPLE, 'resume.pdf', 2048, {
    userId: 'user-conc',
    resumeFileId: 'file-conc',
    forceRefresh: true
  })));

  console.log('RESUME_PERF_AFTER', JSON.stringify({
    beforeBaseline: {
      cold: { p50: 15.51, p95: 61.64 },
      mongoOnlyHit: { p50: 0.01, p95: 0.15 },
      note: 'pre-change Mongo-only path; every hit paid Mongo read'
    },
    after: {
      cold: summarize('cold', coldSamples),
      memory: summarize('memory', memorySamples),
      redis: summarize('redis', redisSamples),
      mongo: summarize('mongo', mongoSamples)
    },
    concurrency: { callers: 5, ai: state.counters.ai, mongoWrites: state.counters.mongoWrites },
    seededScore: seeded.atsScore
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
