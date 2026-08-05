'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const resolve = (relative) => require.resolve(path.join(root, relative));
const mock = (relative, exports) => {
  const filename = resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};
const chain = (value, ms = 0) => ({
  select() { return this; },
  sort() { return this; },
  lean: async () => {
    if (ms) await delay(ms);
    return value;
  }
});

const parseGitHubUsername = (raw = '') => {
  const trimmed = String(raw || '').trim().replace(/^@/, '');
  if (!trimmed) {
    const error = new Error('GitHub username is required.');
    error.status = 400;
    throw error;
  }
  return trimmed;
};

const BEFORE = {
  cold: { p50: 216, p95: 258 },
  redis: { p50: 79, p95: 109 },
  memory: { p50: null, p95: null },
  concurrencyGithub: '5x peek before inflight'
};

const createHarness = ({
  redisDelayMs = 8,
  mongoDelayMs = 20,
  githubDelayMs = 25,
  aiDelayMs = 40,
  resumeDelayMs = 18
} = {}) => {
  const shared = new Map();
  const deterministic = new Map();
  const mongo = new Map();
  const counters = {
    github: 0,
    ai: 0,
    resume: 0,
    private: 0,
    redisGets: 0,
    redisSets: 0,
    mongoReads: 0,
    mongoWrites: 0,
    notifications: 0
  };

  const githubPayload = {
    repoCount: 3,
    languageDistribution: [{ language: 'TypeScript' }],
    repositories: [{ name: 'app', description: 'React TypeScript', language: 'TypeScript' }],
    cache: { cachedAt: '2026-08-05T00:00:00.000Z', expiresAt: '2026-08-06T00:00:00.000Z', source: 'cache' }
  };

  mock('services/githubservice.js', {
    parseGitHubUsername,
    getCachedGitHubAnalysis: async () => {
      counters.github += 1;
      await delay(githubDelayMs);
      return { status: 'fresh', ageMs: 0, data: githubPayload };
    },
    refreshGitHubAnalysisInBackground: () => ({ queued: false, running: false }),
    analyzeGitHubProfile: async () => githubPayload
  });

  mock('services/aiservice.js', {
    getSharedCache: async (key, namespace) => {
      counters.redisGets += 1;
      await delay(redisDelayMs);
      return shared.get(`${namespace}:${key}`) || null;
    },
    setSharedCache: async (key, value, _ttl, namespace) => {
      counters.redisSets += 1;
      shared.set(`${namespace}:${key}`, value);
    },
    getDeterministicSummary: async (_scope, key) => deterministic.get(JSON.stringify(key)) || null,
    setDeterministicSummary: async (_scope, key, value) => deterministic.set(JSON.stringify(key), value),
    runAIAnalysis: async (_prompt, fallback, retries = 0, opts = {}) => {
      counters.ai += 1;
      assert.equal(retries, 0);
      assert.ok(Number(opts.timeoutMs || 0) <= 7000);
      await delay(aiDelayMs);
      const value = {
        analysisSummary: 'Frontend evidence for React and TypeScript is visible with Intern-level Testing gaps remaining.',
        levelAssessment: 'At Intern level for Frontend, prioritize Testing and CI/CD proof next.'
      };
      if (opts.returnMeta) return { ok: true, value };
      return value;
    },
    recordDeterministicSkip: () => {}
  });

  mock('models/analysisCache.js', {
    findOne: (query) => {
      counters.mongoReads += 1;
      const key = JSON.stringify(query);
      return chain(mongo.get(key) || null, mongoDelayMs);
    },
    findOneAndUpdate: async (query, update) => {
      counters.mongoWrites += 1;
      await delay(mongoDelayMs);
      const key = JSON.stringify(query);
      const row = { analysisData: update.$set.analysisData, updatedAt: new Date(), createdAt: new Date() };
      mongo.set(key, row);
      return row;
    }
  });

  mock('models/resumeAnalysis.js', {
    findOne: () => {
      counters.resume += 1;
      return chain({
        fileId: 'default',
        fileName: 'default.pdf',
        technicalSkills: ['React', 'TypeScript'],
        atsScore: 72,
        analyzedAt: new Date('2026-08-01')
      }, resumeDelayMs);
    }
  });

  mock('services/aiVersionService.js', { createVersion: async () => {} });
  mock('services/notificationService.js', {
    createNotification: async () => {
      counters.notifications += 1;
      await delay(30);
    }
  });
  mock('prompts/skillGapPrompt.js', { getSkillGapPrompt: () => 'prompt' });
  mock('services/promptBuilderService.js', {
    estimateTokens: () => 1,
    buildSkillGapPromptContext: () => ({ detectedSkills: [], resume: {}, github: {}, signals: {} })
  });
  mock('services/developerSignalService.js', {
    getDeveloperSignals: async () => {
      counters.private += 1;
      return {
        integrationSignal: { present: false, integrationScore: 0, detectedSkills: [], weakProof: [] },
        careerSprintSignal: { completedSkillSignals: [], repeatedIncompleteSkills: [] },
        weeklyReportSignal: { repeatedWeakAreas: [] },
        portfolioSignal: { portfolioSkills: [] },
        jobsDemandSignal: { present: false, sampledJobs: 0, topSkills: [] }
      };
    },
    buildSignalHash: () => 'signals',
    buildSignalsUsedSummary: () => ({}),
    buildResumeAnalysisSignals: (value, level) => ({
      ...(value || {}),
      skills: value?.technicalSkills || [],
      technicalSkills: value?.technicalSkills || [],
      atsScore: value?.atsScore || 0,
      experienceLevel: level,
      statusMessage: 'Saved resume'
    }),
    buildResumeCacheIdentity: () => ({ resumeHash: 'a'.repeat(64), resumeAnalysisId: 'default' }),
    buildAnalysisBasedOn: () => ({}),
    getPublicJobMarketSignal: async () => ({ present: false, sampledJobs: 0, topSkills: [] })
  });
  mock('services/previewResumeCacheService.js', {
    resolvePreviewResume: async () => ({ error: 'not used', status: 400 })
  });

  const controllerPath = resolve('controllers/skillgapcontroller.js');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);

  const call = async (body = {}, user) => {
    const out = { status: 200 };
    const res = {
      status: (code) => { out.status = code; return res; },
      json: (payload) => { out.body = payload; return res; }
    };
    await controller.analyzeSkillGap({
      body,
      user,
      skillGapRouteStartedAt: Date.now(),
      skillGapAuthCompletedAt: Date.now()
    }, res);
    return out;
  };

  return {
    call,
    counters,
    shared,
    mongo,
    controller,
    clearResultCaches() {
      shared.clear();
      deterministic.clear();
      mongo.clear();
      controller.clearSkillGapMemoryCache();
    }
  };
};

const user = {
  _id: 'perf-user',
  activeGithubUsername: 'perfdev',
  activeCareerStack: 'Frontend',
  activeExperienceLevel: 'Intern',
  defaultResumeFileId: 'default'
};

test('skill-gap memory/redis/cold/concurrency performance', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.SKILL_GAP_STAGE_TIMINGS = '1';

  const harness = createHarness();
  harness.clearResultCaches();

  const coldSamples = [];
  for (let i = 0; i < 6; i += 1) {
    harness.clearResultCaches();
    const started = performance.now();
    const result = await harness.call({ forceRefresh: true }, { ...user, _id: `cold-${i}`, activeGithubUsername: `cold${i}` });
    assert.equal(result.status, 200);
    assert.ok(result.body.cacheMetadata?.stageTimings?.totalMs >= 0);
    coldSamples.push(performance.now() - started);
  }

  harness.clearResultCaches();
  harness.counters.ai = 0;
  harness.counters.github = 0;
  harness.counters.resume = 0;
  harness.counters.redisGets = 0;
  harness.counters.redisSets = 0;
  harness.counters.mongoReads = 0;
  harness.counters.mongoWrites = 0;
  harness.counters.notifications = 0;

  const cold = await harness.call({ forceRefresh: true }, user);
  assert.equal(cold.status, 200);
  assert.equal(harness.counters.ai, 1);
  assert.ok(harness.counters.mongoWrites >= 1);
  // Allow redis set to flush from setImmediate
  await delay(20);
  assert.ok(harness.counters.redisSets >= 1);
  const coldCounts = {
    ai: harness.counters.ai,
    github: harness.counters.github,
    resume: harness.counters.resume,
    mongoWrites: harness.counters.mongoWrites,
    redisSets: harness.counters.redisSets,
    notifications: harness.counters.notifications
  };

  // Memory hits: zero provider/AI/redis/mongo
  harness.counters.ai = 0;
  harness.counters.github = 0;
  harness.counters.resume = 0;
  harness.counters.redisGets = 0;
  harness.counters.mongoReads = 0;
  harness.counters.mongoWrites = 0;
  const memorySamples = [];
  for (let i = 0; i < 20; i += 1) {
    const started = performance.now();
    const hit = await harness.call({}, user);
    assert.equal(hit.status, 200);
    assert.equal(hit.body.fromCache, true);
    assert.equal(hit.body.cacheMetadata?.cacheLayer, 'memory');
    memorySamples.push(performance.now() - started);
  }
  assert.equal(harness.counters.ai, 0);
  assert.equal(harness.counters.github, 0);
  assert.equal(harness.counters.resume, 0);
  assert.equal(harness.counters.redisGets, 0);
  assert.equal(harness.counters.mongoReads, 0);
  assert.equal(harness.counters.mongoWrites, 0);

  // Redis path: clear memory only
  harness.controller.clearSkillGapMemoryCache();
  harness.counters.ai = 0;
  harness.counters.github = 0;
  harness.counters.resume = 0;
  harness.counters.mongoWrites = 0;
  const redisSamples = [];
  for (let i = 0; i < 12; i += 1) {
    harness.controller.clearSkillGapMemoryCache();
    const started = performance.now();
    const hit = await harness.call({}, user);
    assert.equal(hit.status, 200);
    assert.equal(hit.body.fromCache, true);
    redisSamples.push(performance.now() - started);
  }
  assert.equal(harness.counters.ai, 0);
  assert.equal(harness.counters.mongoWrites, 0);

  // Concurrency
  harness.clearResultCaches();
  harness.counters.ai = 0;
  harness.counters.github = 0;
  harness.counters.resume = 0;
  harness.counters.mongoWrites = 0;
  const concurrentUser = { ...user, _id: 'concurrent-user', activeGithubUsername: 'concurrentdev' };
  const startedConcurrent = performance.now();
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => harness.call({ forceRefresh: true }, concurrentUser)));
  const concurrentMs = performance.now() - startedConcurrent;
  assert.ok(concurrent.every((item) => item.status === 200));
  assert.equal(harness.counters.ai, 1);
  assert.ok(harness.counters.mongoWrites <= 1);
  assert.ok(harness.counters.github <= 2, `expected <=2 github calls after early inflight, got ${harness.counters.github}`);
  assert.ok(harness.counters.resume <= 1, `expected <=1 resume fetch after early inflight, got ${harness.counters.resume}`);

  const after = {
    cold: { p50: percentile(coldSamples, 50), p95: percentile(coldSamples, 95) },
    redis: { p50: percentile(redisSamples, 50), p95: percentile(redisSamples, 95) },
    memory: { p50: percentile(memorySamples, 50), p95: percentile(memorySamples, 95) },
    concurrency: {
      callers: 5,
      ai: harness.counters.ai,
      github: harness.counters.github,
      resume: harness.counters.resume,
      mongoWrites: harness.counters.mongoWrites,
      elapsedMs: Math.round(concurrentMs)
    },
    coldCounts,
    before: BEFORE
  };

  t.diagnostic(JSON.stringify({ skillGapPerfAfter: after }));

  assert.ok(after.memory.p95 < 50, `memory p95 ${after.memory.p95}`);
  assert.ok(after.redis.p95 < 250, `redis p95 ${after.redis.p95}`);
  assert.ok(after.cold.p95 < 5000, `cold p95 ${after.cold.p95}`);
  assert.equal(after.concurrency.ai, 1);
});

test('analysis cache exact lookup uses compound index fields', () => {
  const modelPath = resolve('models/analysisCache.js');
  delete require.cache[modelPath];
  const AnalysisCache = require(modelPath);
  const indexes = AnalysisCache.schema.indexes();
  assert.ok(indexes.some(([keys]) => (
    keys.userId === 1
    && keys.githubUsername === 1
    && keys.careerStack === 1
    && keys.experienceLevel === 1
    && keys.analysisVersion === 1
    && keys.resumeHash === 1
    && keys.resumeAnalysisId === 1
    && keys.signalHash === 1
  )));
});
