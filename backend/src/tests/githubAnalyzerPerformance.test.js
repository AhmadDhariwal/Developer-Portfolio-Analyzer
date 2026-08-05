'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');

const servicePath = require.resolve('../services/githubservice');
const controllerPath = require.resolve('../controllers/githubcontroller');
const redisCachePath = require.resolve('../services/redisCacheService');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (value) => (value == null ? value : structuredClone(value));
const thenable = (value) => ({ lean: async () => copy(value) });
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

const createHarness = ({ redisDelayMs = 0, mongoDelayMs = 0 } = {}) => {
  const state = {
    counters: {
      github: { profile: 0, repositories: 0 },
      ai: 0,
      mongoReads: 0,
      mongoWrites: 0,
      redisGets: 0,
      redisSets: 0,
      persistence: { analysisSaves: 0, repositoryUpserts: 0 }
    },
    mongo: new Map(),
    redis: new Map(),
    memorySeeded: false,
    delays: { github: 3, ai: 3, persistence: 3, mongo: mongoDelayMs, redis: redisDelayMs }
  };

  const repos = Array.from({ length: 8 }, (_, index) => ({
    name: `perf-repo-${index + 1}`,
    description: 'React Node application',
    topics: ['react'],
    language: 'TypeScript',
    stargazers_count: 10 - index,
    forks_count: 1,
    pushed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fork: false,
    archived: false,
    size: 500
  }));

  const axios = {
    async get(url) {
      await delay(state.delays.github);
      if (/\/users\/[^/]+$/.test(url)) {
        state.counters.github.profile += 1;
        return { data: { login: 'perfuser', followers: 3, public_repos: 8, bio: 'dev' }, headers: {} };
      }
      if (url.endsWith('/repos')) {
        state.counters.github.repositories += 1;
        return { data: repos, headers: {} };
      }
      if (url.includes('/languages')) return { data: { TypeScript: 8000, JavaScript: 2000 }, headers: {} };
      if (url.includes('/contributors')) return { data: [{ contributions: 5 }], headers: {} };
      if (url.includes('/contents/')) {
        return { data: { encoding: 'base64', content: Buffer.from('# readme').toString('base64') }, headers: {} };
      }
      if (url.includes('/commits')) return { data: [], headers: {} };
      throw new Error(`unexpected url ${url}`);
    }
  };

  const redisStore = state.redis;
  const redisService = {
    isRedisCacheEnabled: () => true,
    async getCacheJsonWithMeta(key) {
      state.counters.redisGets += 1;
      await delay(state.delays.redis);
      const raw = redisStore.get(key);
      if (!raw) return { value: null, layer: 'miss', memoryMs: 0, redisMs: state.delays.redis };
      return { value: copy(raw), layer: 'redis', memoryMs: 0, redisMs: state.delays.redis };
    },
    async setCacheJson(key, payload) {
      state.counters.redisSets += 1;
      redisStore.set(key, copy(payload));
    },
    setMemoryCacheJson() {},
    async acquireCacheLock() { return true; },
    async releaseCacheLock() {}
  };

  const GitHubAnalysisCache = {
    collection: { async indexes() { return []; }, async dropIndex() {}, async createIndex() {} },
    findOne(query) {
      state.counters.mongoReads += 1;
      const key = `${query.normalizedUsername}:${query.analysisVersion}`;
      const chain = {
        select() { return chain; },
        lean: async () => {
          await delay(state.delays.mongo);
          return copy(state.mongo.get(key) || null);
        }
      };
      return chain;
    },
    findOneAndUpdate(query, update) {
      state.counters.mongoWrites += 1;
      const key = `${query.normalizedUsername}:${query.analysisVersion}`;
      const previous = state.mongo.get(key);
      const row = {
        ...(previous || {}),
        ...copy(update.$set),
        snapshots: [...(previous?.snapshots || []), ...copy(update.$push.snapshots.$each)].slice(-12),
        updatedAt: new Date(),
        createdAt: previous?.createdAt || new Date()
      };
      state.mongo.set(key, row);
      return thenable(row);
    }
  };

  const mocks = {
    axios,
    './aiservice': {
      async runAIAnalysis(_prompt, fallback, retries, options) {
        state.counters.ai += 1;
        assert.equal(retries, 0);
        assert.equal(options?.timeoutMs, 5000);
        await delay(state.delays.ai);
        return {
          strengths: ['Strong TypeScript delivery across active repositories', 'Clear full-stack project ownership'],
          weakAreas: ['Add more automated tests', 'Strengthen CI/CD signals'],
          summary: 'This profile shows durable full-stack delivery with production-ready repositories.',
          explanation: 'Deterministic drivers emphasize repository quality, activity depth, and technology coverage.'
        };
      },
      async invalidateCachePrefix() {}
    },
    '../prompts/githubPrompt': { getGitHubPrompt: () => 'prompt' },
    './platformSettingsService': { getIntegrationSecretsSync: () => ({ githubEnabled: true }) },
    './redisCacheService': redisService,
    '../services/redisCacheService': redisService,
    '../models/githubAnalysisCache': GitHubAnalysisCache,
    '../models/analysisCache': { async deleteMany() { return { deletedCount: 0 }; } },
    '../models/repository': {
      async bulkWrite(ops) { state.counters.persistence.repositoryUpserts += ops.length; await delay(state.delays.persistence); },
      async deleteMany() {}
    },
    '../models/analysis': class Analysis {
      constructor(data) { Object.assign(this, data, { githubAnalysisHistory: [], contributionActivity: [] }); }
      static findOne() { return Promise.resolve(null); }
      async save() { state.counters.persistence.analysisSaves += 1; await delay(state.delays.persistence); }
    },
    '../models/user': { async findByIdAndUpdate() {} },
    '../models/githubSaveLock': {
      findOneAndUpdate() { return thenable({ _id: 'lock' }); },
      async deleteOne() {}
    },
    '../services/notificationService': { async createNotification() {} },
    './dashboardcontroller': { invalidateDashboardSummaryCache() {} }
  };

  const load = () => {
    delete require.cache[servicePath];
    delete require.cache[controllerPath];
    delete require.cache[redisCachePath];
    const originalLoad = Module._load;
    Module._load = function mockedLoad(request, parent, isMain) {
      const req = String(request);
      if (req.includes('redisCacheService')) return redisService;
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      const service = require(servicePath);
      service.clearGitHubAnalysisMemoryCache?.();
      mocks['../services/githubservice'] = service;
      delete require.cache[controllerPath];
      const controller = require(controllerPath);
      return { service, controller, state };
    } finally {
      Module._load = originalLoad;
    }
  };

  return { load, state };
};

test('tiered cache paths and concurrency counts', async (t) => {
  process.env.NODE_ENV = 'test';
  const harness = createHarness({ redisDelayMs: 5, mongoDelayMs: 15 });
  const { service, state } = harness.load();

  service.clearGitHubAnalysisMemoryCache?.();

  const cold = await service.analyzeGitHubProfile('perfuser');
  assert.equal(state.counters.github.profile, 1);
  assert.equal(state.counters.ai, 1);
  assert.ok(state.counters.mongoWrites >= 1);
  if (!state.redis.size) {
    state.redis.set('github:analysis:github-v2:perfuser', {
      result: cold,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
      createdAt: new Date(),
      snapshots: [],
      githubUsername: 'perfuser',
      normalizedUsername: 'perfuser',
      analysisVersion: 'github-v2'
    });
  }

  const memoryHits = [];
  for (let i = 0; i < 20; i += 1) {
    const start = performance.now();
    const hit = await service.analyzeGitHubProfile('perfuser');
    memoryHits.push(performance.now() - start);
    assert.equal(hit.cache.hit, true);
  }
  assert.equal(state.counters.github.profile, 1);
  assert.equal(state.counters.ai, 1);

  service.clearGitHubAnalysisMemoryCache?.();
  assert.ok(state.redis.size >= 1, 'redis layer must contain cold analysis before redis-only benchmark');
  const mongoReadsBeforeRedisLoop = state.counters.mongoReads;
  const redisGetsBefore = state.counters.redisGets;
  const redisHits = [];
  for (let i = 0; i < 20; i += 1) {
    const start = performance.now();
    await service.analyzeGitHubProfile('perfuser');
    redisHits.push(performance.now() - start);
  }
  assert.equal(state.counters.github.profile, 1);
  assert.ok(state.counters.redisGets > redisGetsBefore);
  assert.equal(state.counters.mongoReads, mongoReadsBeforeRedisLoop);

  service.clearGitHubAnalysisMemoryCache?.();
  state.redis.clear();
  const mongoReadsBeforeMongoPath = state.counters.mongoReads;
  const mongoHits = [];
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now();
    await service.analyzeGitHubProfile('perfuser');
    mongoHits.push(performance.now() - start);
  }
  assert.equal(state.counters.github.profile, 1);
  assert.equal(state.counters.mongoReads, mongoReadsBeforeMongoPath + 1);

  const concurrent = await Promise.all(Array.from({ length: 5 }, () => service.analyzeGitHubProfile('perfuser2')));
  assert.equal(state.counters.github.profile, 2);
  assert.equal(state.counters.ai, 2);
  assert.ok(concurrent.every((row) => row === concurrent[0]));

  t.diagnostic(`MEMORY p50=${percentile(memoryHits, 50).toFixed(2)}ms p95=${percentile(memoryHits, 95).toFixed(2)}ms`);
  t.diagnostic(`REDIS p50=${percentile(redisHits, 50).toFixed(2)}ms p95=${percentile(redisHits, 95).toFixed(2)}ms`);
  t.diagnostic(`MONGO p50=${percentile(mongoHits, 50).toFixed(2)}ms p95=${percentile(mongoHits, 95).toFixed(2)}ms`);
  t.diagnostic(`COUNTS githubProfile=${state.counters.github.profile} ai=${state.counters.ai} redisGets=${state.counters.redisGets} mongoReads=${state.counters.mongoReads} mongoWrites=${state.counters.mongoWrites}`);

  assert.ok(percentile(memoryHits, 95) < 50);
  assert.ok(percentile(redisHits, 95) < 250);
});
