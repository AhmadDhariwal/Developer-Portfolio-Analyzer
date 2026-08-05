'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');

const servicePath = require.resolve('../services/resumeservice');
const redisPath = require.resolve('../services/redisCacheService');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (value) => (value == null ? value : structuredClone(value));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] || 0;
};

const SAMPLE = [
  'Jane Developer',
  'jane@example.com',
  'EXPERIENCE',
  'Built Node.js APIs and reduced latency by 30% for 100 users.',
  'PROJECTS',
  'Created an Angular dashboard with TypeScript.',
  'SKILLS',
  'Node.js, Angular, TypeScript'
].join('\n');

const normalize = (text) => String(text || '')
  .replace(/\r/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const createHarness = ({ redisDelayMs = 0, mongoDelayMs = 0 } = {}) => {
  const state = {
    counters: {
      ai: 0,
      mongoReads: 0,
      mongoWrites: 0,
      redisGets: 0,
      redisSets: 0
    },
    mongo: new Map(),
    redis: new Map(),
    delays: { ai: 4, mongo: mongoDelayMs, redis: redisDelayMs }
  };

  const redisService = {
    isRedisCacheEnabled: () => true,
    async getCacheJsonWithMeta(key) {
      state.counters.redisGets += 1;
      await delay(state.delays.redis);
      const raw = state.redis.get(key);
      if (!raw) return { value: null, layer: 'miss', memoryMs: 0, redisMs: state.delays.redis };
      return { value: copy(raw), layer: 'redis', memoryMs: 0, redisMs: state.delays.redis };
    },
    async setCacheJson(key, payload) {
      state.counters.redisSets += 1;
      state.redis.set(key, copy(payload));
    },
    setMemoryCacheJson() {}
  };

  const ResumeAnalysisCache = {
    findOne(query) {
      state.counters.mongoReads += 1;
      const key = `${query.userId}:${query.resumeFileId}:${query.resumeHash}:${query.analysisVersion}`;
      const chain = {
        select() { return chain; },
        lean: async () => {
          await delay(state.delays.mongo);
          return copy(state.mongo.get(key) || null);
        }
      };
      return chain;
    },
    async findOneAndUpdate(query, update) {
      state.counters.mongoWrites += 1;
      await delay(state.delays.mongo);
      const key = `${query.userId}:${query.resumeFileId}:${query.resumeHash}:${query.analysisVersion}`;
      const row = { ...copy(update.$set), analyzedAt: new Date() };
      state.mongo.set(key, row);
      return row;
    },
    async updateOne() {}
  };

  const load = () => {
    delete require.cache[servicePath];
    delete require.cache[redisPath];
    const originalLoad = Module._load;
    Module._load = function mockedLoad(request, parent, isMain) {
      if (String(request).includes('redisCacheService')) return redisService;
      if (String(request).includes('aiservice') || request === './aiservice') {
        return {
          async runAIAnalysis(_prompt, fallback, retries, options) {
            state.counters.ai += 1;
            assert.equal(retries, 0);
            assert.equal(options?.timeoutMs, 5000);
            await delay(state.delays.ai);
            return { focusAreas: ['quantified_impact'] };
          }
        };
      }
      if (String(request).includes('resumeAnalysisCache') || request === '../models/resumeAnalysisCache') {
        return ResumeAnalysisCache;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      const service = require(servicePath);
      service.clearResumeAnalysisMemoryCache?.();
      return { service, state };
    } finally {
      Module._load = originalLoad;
    }
  };

  return { load, state };
};

test('resume tiered cache paths and five-way concurrency', async () => {
  process.env.NODE_ENV = 'test';
  const harness = createHarness({ redisDelayMs: 5, mongoDelayMs: 12 });
  const { service, state } = harness.load();
  service.clearResumeAnalysisMemoryCache?.();

  const coldSamples = [];
  for (let i = 0; i < 8; i += 1) {
    service.clearResumeAnalysisMemoryCache?.();
    state.mongo.clear();
    state.redis.clear();
    const started = performance.now();
    await service.analyzeResume(SAMPLE, 'resume.pdf', 1024, {
      userId: `u${i}`,
      resumeFileId: `f${i}`,
      forceRefresh: true
    });
    coldSamples.push(performance.now() - started);
  }

  service.clearResumeAnalysisMemoryCache?.();
  state.mongo.clear();
  state.redis.clear();
  state.counters.ai = 0;
  state.counters.mongoReads = 0;
  state.counters.mongoWrites = 0;
  state.counters.redisGets = 0;
  state.counters.redisSets = 0;

  const cold = await service.analyzeResume(SAMPLE, 'resume.pdf', 1024, {
    userId: 'user-perf',
    resumeFileId: 'file-perf',
    forceRefresh: true
  });
  assert.equal(typeof cold.atsScore, 'number');
  assert.equal(state.counters.ai, 1);
  assert.ok(state.counters.mongoWrites >= 1);
  assert.ok(state.counters.redisSets >= 1);

  const hash = crypto.createHash('sha256').update(normalize(SAMPLE)).digest('hex');
  const redisKey = `resume:analysis:${service.ANALYSIS_VERSION}:user-perf:file-perf:${hash}`;
  if (!state.redis.has(redisKey)) {
    state.redis.set(redisKey, {
      result: cold,
      analyzedAt: new Date(),
      analysisVersion: service.ANALYSIS_VERSION,
      resumeHash: hash
    });
  }

  // Memory path
  const memorySamples = [];
  for (let i = 0; i < 20; i += 1) {
    const started = performance.now();
    const hit = await service.findCachedResumeAnalysis({
      userId: 'user-perf',
      resumeFileId: 'file-perf',
      resumeHash: hash,
      analysisVersion: service.ANALYSIS_VERSION
    });
    memorySamples.push(performance.now() - started);
    assert.equal(hit.cacheMetadata.cacheHit, true);
  }

  // Redis path
  service.clearResumeAnalysisMemoryCache?.();
  const redisBefore = state.counters.redisGets;
  const redisSamples = [];
  for (let i = 0; i < 15; i += 1) {
    service.clearResumeAnalysisMemoryCache?.();
    const started = performance.now();
    const hit = await service.findCachedResumeAnalysis({
      userId: 'user-perf',
      resumeFileId: 'file-perf',
      resumeHash: hash,
      analysisVersion: service.ANALYSIS_VERSION
    });
    redisSamples.push(performance.now() - started);
    assert.equal(hit.cacheMetadata.cacheHit, true);
  }
  assert.ok(state.counters.redisGets > redisBefore);

  // Mongo path
  service.clearResumeAnalysisMemoryCache?.();
  state.redis.clear();
  const mongoSamples = [];
  for (let i = 0; i < 10; i += 1) {
    service.clearResumeAnalysisMemoryCache?.();
    state.redis.clear();
    const started = performance.now();
    const hit = await service.findCachedResumeAnalysis({
      userId: 'user-perf',
      resumeFileId: 'file-perf',
      resumeHash: hash,
      analysisVersion: service.ANALYSIS_VERSION
    });
    mongoSamples.push(performance.now() - started);
    assert.equal(hit.cacheMetadata.cacheHit, true);
  }

  // Concurrency: five identical analyze calls share one AI + one persistence sequence
  service.clearResumeAnalysisMemoryCache?.();
  state.mongo.clear();
  state.redis.clear();
  state.counters.ai = 0;
  state.counters.mongoWrites = 0;
  const concurrent = await Promise.all(Array.from({ length: 5 }, () =>
    service.analyzeResume(SAMPLE, 'resume.pdf', 1024, {
      userId: 'user-conc',
      resumeFileId: 'file-conc',
      forceRefresh: true
    })
  ));
  assert.equal(concurrent.length, 5);
  assert.equal(state.counters.ai, 1);
  assert.equal(state.counters.mongoWrites, 1);
  assert.equal(concurrent[0].atsScore, concurrent[4].atsScore);

  const report = {
    cold: { p50: percentile(coldSamples, 50), p95: percentile(coldSamples, 95) },
    memory: { p50: percentile(memorySamples, 50), p95: percentile(memorySamples, 95) },
    redis: { p50: percentile(redisSamples, 50), p95: percentile(redisSamples, 95) },
    mongo: { p50: percentile(mongoSamples, 50), p95: percentile(mongoSamples, 95) },
    counts: {
      ai: state.counters.ai,
      mongoReads: state.counters.mongoReads,
      mongoWrites: state.counters.mongoWrites,
      redisGets: state.counters.redisGets,
      redisSets: state.counters.redisSets
    }
  };
  console.log('RESUME_PERF', JSON.stringify(report));

  assert.ok(report.memory.p95 < 50, `memory p95 ${report.memory.p95}`);
  assert.ok(report.redis.p95 < 250, `redis p95 ${report.redis.p95}`);
});

test('resume cache index supports exact hashed lookup', () => {
  const ResumeAnalysisCache = require('../models/resumeAnalysisCache');
  const indexes = ResumeAnalysisCache.schema.indexes().map(([fields]) => fields);
  assert.ok(indexes.some((fields) => JSON.stringify(fields) === JSON.stringify({
    userId: 1,
    resumeFileId: 1,
    resumeHash: 1,
    analysisVersion: 1
  })));
});
