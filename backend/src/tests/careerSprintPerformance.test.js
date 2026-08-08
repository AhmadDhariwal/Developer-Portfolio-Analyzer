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
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

const BEFORE = {
  cold: { p50: 78.01, p95: 94.41 },
  memory: { p50: 0.08, p95: 0.14 },
  redis: { p50: null, p95: null },
  concurrent: { signalCalls: 1, mongoReads: 2, aiCalls: null }
};

const SIGNAL_DELAY_MS = 40;
const MONGO_DELAY_MS = 25;
const REDIS_DELAY_MS = 12;
const AI_DELAY_MS = 120;

const sampleSprint = (userId) => ({
  _id: '507f1f77bcf86cd799439011',
  userId,
  title: 'Career Sprint',
  weekStartDate: new Date('2026-08-03T00:00:00.000Z'),
  weekEndDate: new Date('2026-08-09T23:59:59.999Z'),
  sprintStartDate: new Date('2026-08-03T00:00:00.000Z'),
  sprintEndDate: new Date('2026-08-09T23:59:59.999Z'),
  weeklyGoal: 5,
  currentStreak: 2,
  longestStreak: 4,
  streak: 2,
  streakBroken: false,
  streakWarning: false,
  streakStatus: 'active',
  xpPoints: 30,
  level: 1,
  goalStack: 'Frontend',
  goalTechnology: 'React',
  goalExperienceLevel: 'Intern',
  tasks: [{
    _id: '507f1f77bcf86cd799439012',
    title: 'Learn React hooks',
    description: 'Practice hooks',
    points: 3,
    priority: 'high',
    category: 'learning',
    taskType: 'manual',
    isCompleted: false,
    completedAt: null,
    startDate: new Date('2026-08-03T00:00:00.000Z'),
    endDate: new Date('2026-08-05T23:59:59.999Z')
  }],
  aiPlans: []
});

const createQuery = (loader) => {
  const state = { lean: false };
  const api = {
    select() { return api; },
    sort() { return api; },
    limit() { return api; },
    lean() { state.lean = true; return api; },
    then(resolve, reject) { return loader(state).then(resolve, reject); }
  };
  return api;
};

const createHarness = () => {
  const counters = {
    mongoReads: 0,
    mongoWrites: 0,
    signalCalls: 0,
    aiCalls: 0,
    redisGets: 0,
    redisSets: 0,
    redisDeletes: 0
  };
  const shared = new Map();

  mock('services/developerSignalService.js', {
    getDeveloperSignals: async () => {
      counters.signalCalls += 1;
      await delay(SIGNAL_DELAY_MS);
      return {
        careerSprintSignal: { consistencyScore: 55, activeLearningFocus: 'React', streak: 2 },
        weeklyReportSignal: { status: 'Ready', weeklyProgressScore: 40, repeatedWeakAreas: ['Testing'] },
        portfolioSignal: { completenessScore: 50, projectPresentationQuality: 45 },
        integrationSignal: { usedProviders: ['GitHub'], strongestProof: ['GitHub'] }
      };
    }
  });

  mock('services/aiservice.js', {
    getSharedCache: async (key, namespace) => {
      counters.redisGets += 1;
      await delay(REDIS_DELAY_MS);
      return shared.get(`${namespace}:${key}`) || null;
    },
    setSharedCache: async (key, value, _ttl, namespace) => {
      counters.redisSets += 1;
      shared.set(`${namespace}:${key}`, value);
    },
    invalidateCacheKey: async (key, namespace) => {
      counters.redisDeletes += 1;
      shared.delete(`${namespace}:${key}`);
    },
    runAIAnalysis: async (_prompt, fallback, retries = 0, opts = {}) => {
      counters.aiCalls += 1;
      assert.equal(retries, 0);
      await delay(AI_DELAY_MS);
      const value = {
        tasks: Array.from({ length: 6 }, (_, index) => ({
          title: `Build React feature ${index + 1}`,
          description: `Deliver a measurable React Intern task number ${index + 1} with Frontend focus.`,
          category: index % 3 === 0 ? 'learning' : index % 3 === 1 ? 'project' : 'practice'
        }))
      };
      return opts.returnMeta ? { ok: true, value, reason: 'ok' } : value;
    }
  });

  mock('models/careerSprint.js', {
    findOne: (query) => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return sampleSprint(String(query.userId || 'u1'));
    }),
    findOneAndUpdate: async () => {
      counters.mongoWrites += 1;
      await delay(MONGO_DELAY_MS);
      return sampleSprint('u1');
    },
    updateOne: async () => {
      counters.mongoWrites += 1;
      await delay(MONGO_DELAY_MS);
      return { acknowledged: true };
    },
    find: () => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return [sampleSprint('u1')];
    }),
    create: async () => {
      counters.mongoWrites += 1;
      return sampleSprint('u1');
    },
    collection: {
      indexes: async () => [
        { name: '_id_', key: { _id: 1 } },
        { name: 'career_sprint_user_updated_at', key: { userId: 1, updatedAt: -1 } }
      ],
      createIndex: async () => 'ok'
    }
  });

  mock('models/user.js', {
    findById: () => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return { careerStack: 'Frontend', experienceLevel: 'Intern' };
    })
  });
  mock('models/recommendation.js', {
    find: () => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return [{ techStack: ['React'], isNewTech: ['TypeScript'] }];
    })
  });
  mock('models/analysisCache.js', {
    findOne: () => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return { analysisData: { skillGap: { missingSkills: ['Testing'] } } };
    })
  });
  mock('models/analysis.js', {
    findOne: () => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return { githubStats: { repos: 2 }, contributionActivity: [{ count: 20 }], githubScore: 70, readinessScore: 60 };
    })
  });
  mock('models/scenarioSimulation.js', {
    findOne: () => createQuery(async () => null)
  });

  Object.keys(require.cache).forEach((entry) => {
    if (entry.includes(`${path.sep}services${path.sep}careerSprintService`)
      || entry.includes(`${path.sep}services${path.sep}aiTaskService`)
      || entry.includes(`${path.sep}scripts${path.sep}ensureCareerSprintIndexes`)) {
      delete require.cache[entry];
    }
  });

  const sprintService = require('../services/careerSprintService');
  const aiTaskService = require('../services/aiTaskService');
  sprintService.clearCareerSprintMemoryCache();
  sprintService.resetCareerSprintRuntimeCounters();
  aiTaskService.clearCareerSprintPlanCaches();
  aiTaskService.resetCareerSprintPlanRuntimeCounters();
  return { sprintService, aiTaskService, counters, shared };
};

const measure = async (runs, fn) => {
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await fn(index);
    samples.push(performance.now() - started);
  }
  return {
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2))
  };
};

test('memory cache hits stay under 50ms p95 and skip mongo/signals', async () => {
  const harness = createHarness();
  await harness.sprintService.getCurrentSprint('u-mem', { forceRefresh: true });
  harness.counters.mongoReads = 0;
  harness.counters.signalCalls = 0;
  const stats = await measure(20, async () => {
    const result = await harness.sprintService.getCurrentSprint('u-mem');
    assert.ok(result.analytics);
    assert.ok(result.cacheMetadata?.stageTimingsMs);
  });
  assert.equal(harness.counters.mongoReads, 0);
  assert.equal(harness.counters.signalCalls, 0);
  assert.ok(stats.p95 < 50, `memory p95 ${stats.p95}`);
});

test('Redis hit path is bounded and skips cold pipeline work', async () => {
  const harness = createHarness();
  const cold = await harness.sprintService.getCurrentSprint('u-redis', { forceRefresh: true });
  await flushAsync();
  harness.sprintService.clearCareerSprintMemoryCache();
  harness.counters.mongoReads = 0;
  harness.counters.signalCalls = 0;
  harness.counters.redisGets = 0;

  const stats = await measure(12, async () => {
    harness.sprintService.clearCareerSprintMemoryCache();
    const result = await harness.sprintService.getCurrentSprint('u-redis');
    assert.equal(String(result._id), String(cold._id));
  });

  assert.ok(harness.counters.redisGets >= 12);
  assert.equal(harness.counters.mongoReads, 0);
  assert.equal(harness.counters.signalCalls, 0);
  assert.ok(stats.p95 < 250, `redis p95 ${stats.p95}`);
});

test('five identical callers share one expensive pipeline', async () => {
  const harness = createHarness();
  harness.sprintService.clearCareerSprintMemoryCache();
  const beforeSignals = harness.counters.signalCalls;
  const beforeMongo = harness.counters.mongoReads;
  await Promise.all(Array.from({ length: 5 }, () => harness.sprintService.getCurrentSprint('u-concurrent')));
  assert.equal(harness.counters.signalCalls - beforeSignals, 1);
  assert.ok(harness.counters.mongoReads - beforeMongo <= 2);
});

test('AI generation uses one attempt, caches persistable plans, and concurrent callers share work', async () => {
  const harness = createHarness();
  const input = {
    userId: 'u-ai',
    stack: 'Frontend',
    technology: 'React',
    experienceLevel: 'Intern'
  };

  const first = await harness.aiTaskService.generateAiTasksWithLLM({ ...input, forceRefresh: true });
  assert.ok(first.tasks.length >= 6);
  assert.ok(first.cacheMetadata?.stageTimingsMs?.AI >= 0);

  await flushAsync();
  harness.aiTaskService.clearCareerSprintPlanCaches();
  harness.counters.aiCalls = 0;
  harness.counters.mongoReads = 0;
  harness.counters.signalCalls = 0;

  const redisHit = await harness.aiTaskService.generateAiTasksWithLLM(input);
  assert.equal(harness.counters.aiCalls, 0);
  assert.ok(redisHit.tasks.length >= 6);

  harness.aiTaskService.clearCareerSprintPlanCaches();
  harness.shared.clear();
  harness.counters.aiCalls = 0;
  await Promise.all(Array.from({ length: 5 }, () => harness.aiTaskService.generateAiTasksWithLLM(input)));
  assert.equal(harness.counters.aiCalls, 1);
});

test('non-AI current sprint cold path stays under 500ms p95', async () => {
  const harness = createHarness();
  const stats = await measure(10, async (index) => {
    harness.sprintService.clearCareerSprintMemoryCache();
    await harness.sprintService.getCurrentSprint(`u-cold-${index}`, { forceRefresh: true });
  });
  assert.ok(stats.p95 < 500, `cold p95 ${stats.p95}`);
});

test('index migration is idempotent and only creates missing indexes', async () => {
  const { ensureCareerSprintIndexes } = require('../scripts/ensureCareerSprintIndexes');
  const indexes = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'career_sprint_user_updated_at', key: { userId: 1, updatedAt: -1 } },
    { name: 'legacy_week', key: { userId: 1, weekStartDate: -1 } }
  ];
  const model = {
    collection: {
      indexes: async () => indexes,
      createIndex: async (key, options) => {
        indexes.push({ name: options.name, key });
        return options.name;
      }
    }
  };
  const first = await ensureCareerSprintIndexes(model);
  const second = await ensureCareerSprintIndexes(model);
  assert.ok(first.created.includes('career_sprint_user_sprint_window'));
  assert.equal(second.created.length, 0);
  assert.ok(second.skipped.length >= first.skipped.length);
});

test('after metrics improve or hold targets versus measured before snapshot', async () => {
  const harness = createHarness();
  await harness.sprintService.getCurrentSprint('u-after', { forceRefresh: true });
  const memory = await measure(15, async () => harness.sprintService.getCurrentSprint('u-after'));
  assert.ok(memory.p95 <= Math.max(BEFORE.memory.p95, 50));

  harness.sprintService.clearCareerSprintMemoryCache();
  await flushAsync();
  const redis = await measure(10, async () => {
    harness.sprintService.clearCareerSprintMemoryCache();
    await harness.sprintService.getCurrentSprint('u-after');
  });
  assert.ok(redis.p95 < 250);

  const cold = await measure(8, async (index) => {
    harness.sprintService.clearCareerSprintMemoryCache();
    await harness.sprintService.getCurrentSprint(`u-after-cold-${index}`, { forceRefresh: true });
  });
  assert.ok(cold.p95 <= Math.max(BEFORE.cold.p95 * 1.2, 500));
});

test('optimized paths keep versioned cache identity, lean lookups, and zero AI retries', () => {
  const fs = require('node:fs');
  const serviceSource = fs.readFileSync(path.join(__dirname, '../services/careerSprintService.js'), 'utf8');
  const aiServiceSource = fs.readFileSync(path.join(__dirname, '../services/aiTaskService.js'), 'utf8');
  assert.match(serviceSource, /overview_v2/);
  assert.match(serviceSource, /memoryOverviewKey/);
  assert.match(serviceSource, /sprintStartDate:\s*\{\s*\$lte:\s*now\s*\}/);
  assert.match(serviceSource, /\.sort\(\{\s*updatedAt:\s*-1\s*\}\)\.lean\(\)/);
  assert.match(serviceSource, /\.select\('tasks xpPoints currentStreak streak weekStartDate'\)/);
  assert.match(serviceSource, /withBudget\(/);
  assert.match(aiServiceSource, /plan_v2/);
  assert.match(aiServiceSource, /runAIAnalysis\(prompt, aiFallback, 0,/);
  assert.match(aiServiceSource, /setImmediate\(/);
});
