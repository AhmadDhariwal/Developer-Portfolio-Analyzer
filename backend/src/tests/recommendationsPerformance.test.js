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
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => {
    if (ms) await delay(ms);
    return value;
  },
});

const BEFORE = {
  cold: { p50: 295.76, p95: 331.51 },
  redis_or_mongo: { p50: 170.84, p95: 173.09 },
  memory: { p50: 170.92, p95: 173.49 },
  concurrent: { github: 5, ai: 1, signals: 5 },
};

const parseGitHubUsername = (raw = '') => {
  const trimmed = String(raw || '')
    .trim()
    .replace(/^@/, '');
  if (!trimmed) {
    const error = new Error('GitHub username is required.');
    error.status = 400;
    throw error;
  }
  return trimmed;
};

const createHarness = ({
  redisDelayMs = 8,
  mongoDelayMs = 20,
  githubDelayMs = 35,
  aiDelayMs = 45,
  resumeDelayMs = 18,
  signalsDelayMs = 40,
  notificationDelayMs = 25,
} = {}) => {
  const shared = new Map();
  const mongo = new Map();
  const counters = {
    github: 0,
    ai: 0,
    resume: 0,
    signals: 0,
    redisGets: 0,
    redisSets: 0,
    mongoReads: 0,
    mongoWrites: 0,
    notifications: 0,
    persistence: 0,
  };

  const githubPayload = {
    repoCount: 4,
    developerLevel: 'Junior',
    strengths: ['Node.js'],
    weakAreas: ['SQL'],
    languageDistribution: [{ language: 'JavaScript', percentage: 80 }],
    repositories: [{ name: 'api', description: 'Node SQL API', language: 'JavaScript' }],
    scores: { healthScore: 70, activity: 65 },
  };

  mock('services/githubservice.js', {
    parseGitHubUsername,
    analyzeGitHubProfile: async () => {
      counters.github += 1;
      await delay(githubDelayMs);
      return githubPayload;
    },
  });

  mock('services/aiservice.js', {
    getSharedCache: async (key, namespace) => {
      counters.redisGets += 1;
      await delay(redisDelayMs);
      return shared.get(`${namespace}:${key}`) || null;
    },
    setSharedCache: async (key, value, _ttl, namespace) => {
      counters.redisSets += 1;
      counters.persistence += 1;
      shared.set(`${namespace}:${key}`, value);
    },
    runAIAnalysis: async (_prompt, fallback, retries = 0, opts = {}) => {
      counters.ai += 1;
      assert.equal(retries, 0);
      assert.ok(Number(opts.timeoutMs || 0) <= 7000);
      await delay(aiDelayMs);
      const value = {
        analysisSummary:
          'Backend Intern progress should prioritize SQL proof through a focused Node.js project.',
        projectNarratives: [],
        technologyNarratives: [],
        careerPathNarratives: [],
        portfolioRecommendations: [],
        resumeRecommendations: [],
        learningActions: [],
        interviewReadinessActions: [],
      };
      if (opts.returnMeta) return { ok: true, value };
      return value;
    },
  });

  mock('models/analysisCache.js', {
    findOne: (query) => {
      counters.mongoReads += 1;
      const exact = mongo.get(JSON.stringify(query));
      if (exact) return chain(exact, mongoDelayMs);
      for (const [key, row] of mongo.entries()) {
        try {
          const parsed = JSON.parse(key);
          if (
            String(parsed.userId) === String(query.userId) &&
            parsed.analysisVersion === query.analysisVersion &&
            (!query.signalHash || parsed.signalHash === query.signalHash) &&
            (!query.resumeHash || parsed.resumeHash === query.resumeHash) &&
            (!query.githubUsername || parsed.githubUsername === query.githubUsername) &&
            (!query.careerStack || parsed.careerStack === query.careerStack) &&
            (!query.experienceLevel || parsed.experienceLevel === query.experienceLevel) &&
            (!query.resumeAnalysisId || parsed.resumeAnalysisId === query.resumeAnalysisId)
          ) {
            return chain(row, mongoDelayMs);
          }
        } catch (_) {
          /* ignore */
        }
      }
      return chain(null, mongoDelayMs);
    },
    findOneAndUpdate: async (query, update) => {
      counters.mongoWrites += 1;
      counters.persistence += 1;
      await delay(mongoDelayMs);
      const key = JSON.stringify(query);
      const row = {
        ...query,
        analysisData: update.$set.analysisData,
        userId: update.$set.userId || query.userId,
        updatedAt: new Date(),
        createdAt: new Date(),
      };
      mongo.set(key, row);
      return row;
    },
    collection: {
      indexes: async () => [],
      createIndex: async () => 'ok',
      dropIndex: async () => {},
    },
  });
  mock('models/recommendation.js', { findOneAndUpdate: async () => ({}) });

  mock('models/resumeAnalysis.js', {
    findOne: () => {
      counters.resume += 1;
      return chain(
        {
          fileId: 'default',
          fileName: 'default.pdf',
          technicalSkills: ['Node.js', 'JavaScript'],
          skills: ['Node.js', 'JavaScript'],
          atsScore: 72,
          keywordDensity: 60,
          formatScore: 70,
          contentQuality: 68,
          analyzedAt: new Date('2026-08-01'),
        },
        resumeDelayMs,
      );
    },
  });
  mock('models/resumeFile.js', { findOne: () => chain({ _id: 'default', userId: 'u-perf-1' }) });
  mock('models/githubAnalysisCache.js', { findOne: () => chain(null, 2) });
  mock('models/user.js', {
    findById: () => ({
      select() {
        return this;
      },
      lean: async () => ({ defaultResumeFileId: 'default' }),
    }),
  });
  mock('models/savedPreview.js', {
    find: () => ({
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => [],
    }),
    findOneAndUpdate: async () => ({}),
    findOne: () => ({ lean: async () => null }),
    findOneAndDelete: async () => null,
  });
  mock('services/aiVersionService.js', { createVersion: async () => {} });
  mock('services/notificationPersistenceService.js', {
    commit: async (_owner, work) => {
      const result = await work(null);
      counters.notifications += 1;
      await delay(notificationDelayMs);
      return result;
    },
  });
  mock('prompts/recommendationPrompt.js', { getRecommendationPrompt: () => 'prompt' });
  mock('services/developerSignalService.js', {
    getDeveloperSignals: async () => {
      counters.signals += 1;
      await delay(signalsDelayMs);
      return {
        githubSignals: { present: false, repoCount: 0 },
        resumeSignals: {
          analyzed: true,
          atsScore: 72,
          skills: ['Node.js'],
          weaknesses: [],
          missingSections: [],
        },
        skillGapSignals: {
          present: true,
          coverage: 55,
          knownSkills: ['Node.js'],
          missingSkills: ['SQL'],
          weakSkills: ['SQL'],
          highDemandSkills: ['SQL'],
          immediateSkills: ['SQL'],
        },
        careerSprintSignal: {
          present: false,
          consistencyScore: 40,
          completedSkillSignals: [],
          repeatedIncompleteSkills: [],
        },
        weeklyReportSignal: {
          present: false,
          weeklyProgressScore: 40,
          skillsImprovedThisWeek: [],
          repeatedWeakAreas: [],
        },
        portfolioSignal: {
          present: false,
          completenessScore: 40,
          listedProjects: 0,
          liveLinks: 0,
          githubLinks: 0,
          portfolioSkills: [],
        },
        integrationSignal: {
          present: false,
          usedProviders: [],
          integrationScore: 20,
          detectedSkills: [],
          certifications: [],
          strongestProof: [],
          weakProof: [],
        },
        careerProfileSignal: { present: true, careerStack: 'Backend', experienceLevel: 'Intern' },
        jobsDemandSignal: {
          present: true,
          sampledJobs: 12,
          topSkills: [{ name: 'SQL', demandScore: 80, postings: 10 }],
        },
      };
    },
    buildSignalHash: (signals) => `hash-${signals?.skillGapSignals?.coverage || 0}`,
    buildSignalsUsedSummary: () => ({
      github: { connected: true, repoCount: 0 },
      resume: { analyzed: true, atsScore: 72 },
      skillGap: { present: true },
    }),
    buildResumeAnalysisSignals: (value, level) => ({
      analyzed: true,
      skills: value?.technicalSkills || [],
      technicalSkills: value?.technicalSkills || [],
      atsScore: value?.atsScore || 0,
      keywordDensity: value?.keywordDensity || 0,
      formatScore: value?.formatScore || 0,
      contentQuality: value?.contentQuality || 0,
      experienceLevel: level,
      statusMessage: 'Saved resume',
      weaknesses: [],
      missingSections: [],
      keyAchievements: [],
    }),
    buildResumeCacheIdentity: () => ({ resumeHash: 'a'.repeat(64), resumeAnalysisId: 'default' }),
    buildAnalysisBasedOn: () => ({
      githubUsername: 'backend-dev',
      resumeAnalyzed: true,
      resumeStatus: 'ok',
      careerStack: 'Backend',
      experienceLevel: 'Intern',
    }),
    getPublicJobMarketSignal: async () => ({
      present: true,
      sampledJobs: 12,
      topSkills: [{ name: 'SQL', demandScore: 80 }],
    }),
  });
  mock('services/previewResumeCacheService.js', {
    resolvePreviewResume: async () => ({
      resumeInsights: {
        analyzed: true,
        skills: ['React'],
        technicalSkills: ['React'],
        atsScore: 60,
        statusMessage: 'Preview resume',
        weaknesses: [],
        missingSections: [],
        keyAchievements: [],
      },
      resumeCacheIdentity: { resumeHash: 'b'.repeat(64), resumeAnalysisId: 'preview' },
    }),
  });
  mock('utils/skilldetector.js', {
    ...require('../utils/skilldetector'),
    extractSkillsFromRepositories: () => ['JavaScript', 'Node.js'],
    canonicalizeSkillName: (value) => String(value || '').trim(),
    detectSkillGaps: (known) => ({
      currentSkills: known.map((name) => ({ name })),
      missingSkills: [
        { name: 'SQL', priority: 'High' },
        { name: 'Docker', priority: 'High' },
      ],
    }),
  });

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}controllers${path.sep}recommendationscontroller`)) {
      delete require.cache[key];
    }
  }
  const controller = require(resolve('controllers/recommendationscontroller.js'));
  controller.clearRecommendationMemoryCache();

  const callProfile = async ({ forceRefresh = false } = {}) => {
    const out = { status: 200 };
    const res = {
      status: (code) => {
        out.status = code;
        return res;
      },
      json: (payload) => {
        out.body = payload;
        out.timings = payload?.cacheMetadata?.stageTimingsMs || {};
        return res;
      },
    };
    await controller.getRecommendations(
      {
        body: { forceRefresh },
        user: {
          _id: 'u-perf-1',
          activeGithubUsername: 'backend-dev',
          careerStack: 'Backend',
          experienceLevel: 'Intern',
          defaultResumeFileId: 'default',
        },
      },
      res,
    );
    return out;
  };

  return { callProfile, counters, controller, shared };
};

const measure = async (fn, runs = 8) => {
  const samples = [];
  let last;
  for (let i = 0; i < runs; i += 1) {
    const at = performance.now();
    last = await fn();
    samples.push(performance.now() - at);
  }
  return {
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2)),
    last,
  };
};

test('recommendations cache hierarchy and concurrency meet production targets', async () => {
  const h = createHarness();

  const cold = await measure(() => h.callProfile({ forceRefresh: true }), 5);
  assert.equal(cold.last.status, 200);
  assert.ok(cold.last.body.projects.length > 0);
  assert.ok(cold.p95 < 5000, `cold p95 ${cold.p95}`);

  await delay(30); // allow setImmediate redis warm
  const redisSamples = [];
  let redisLast;
  for (let i = 0; i < 8; i += 1) {
    h.controller.clearRecommendationMemoryCache();
    const at = performance.now();
    redisLast = await h.callProfile({ forceRefresh: false });
    redisSamples.push(performance.now() - at);
  }
  const redis = {
    p50: Number(percentile(redisSamples, 50).toFixed(2)),
    p95: Number(percentile(redisSamples, 95).toFixed(2)),
    last: redisLast,
  };
  assert.ok(redis.last.body.fromCache || redis.last.body.cacheMetadata?.loadedFromCache);
  assert.ok(
    ['redis', 'mongo'].includes(redis.last.body.cacheMetadata?.cacheLayer),
    `expected redis/mongo layer, got ${redis.last.body.cacheMetadata?.cacheLayer}`,
  );
  assert.ok(redis.p95 < 250, `redis/mongo hit p95 ${redis.p95}`);
  assert.equal(redis.last.timings['external provider'] || 0, 0);
  assert.equal(redis.last.timings.AI || 0, 0);

  // Warm memory from the redis/mongo payload, then measure pure memory hits.
  await h.callProfile({ forceRefresh: false });
  const memory = await measure(() => h.callProfile({ forceRefresh: false }), 10);
  assert.equal(memory.last.body.cacheMetadata?.cacheLayer, 'memory');
  assert.ok(memory.p95 < 50, `memory p95 ${memory.p95}`);
  assert.ok((memory.last.timings.total || 0) < 50);

  const before = { ...h.counters };
  await Promise.all(Array.from({ length: 5 }, () => h.callProfile({ forceRefresh: true })));
  const delta = {
    github: h.counters.github - before.github,
    ai: h.counters.ai - before.ai,
    signals: h.counters.signals - before.signals,
    persistence: h.counters.persistence - before.persistence,
  };
  assert.equal(delta.github, 1);
  assert.equal(delta.ai, 1);
  assert.equal(delta.signals, 1);
  assert.ok(delta.persistence <= 2);

  const stages = Object.keys(cold.last.timings || {});
  for (const required of [
    'validation',
    'cache',
    'Redis',
    'Mongo',
    'external provider',
    'AI',
    'deterministic processing',
    'persistence',
    'total',
  ]) {
    assert.ok(required in (cold.last.timings || {}), `missing stage ${required}`);
  }

  console.log(
    JSON.stringify({
      before: BEFORE,
      after: { cold, redis, memory, concurrentDelta: delta, stages },
    }),
  );
});

test('recommendation index migration is idempotent', async () => {
  const {
    migrateRecommendationIndexes,
    INDEXES,
  } = require('../scripts/migrateRecommendationIndexes');
  const created = [];
  const AnalysisCache = {
    collection: {
      indexes: async () => created.map((item) => ({ name: item.name, key: item.keys })),
      createIndex: async (keys, options) => {
        created.push({ name: options.name, keys });
        return options.name;
      },
      dropIndex: async () => {},
    },
  };
  const first = await migrateRecommendationIndexes(AnalysisCache);
  const second = await migrateRecommendationIndexes(AnalysisCache);
  assert.equal(first.indexes.length, INDEXES.length);
  assert.equal(
    second.indexes.every((item) => item.action === 'exists'),
    true,
  );
});
