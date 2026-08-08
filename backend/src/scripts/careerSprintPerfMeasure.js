'use strict';

/**
 * Career Sprint performance probe (post-optimization).
 * Run: node src/scripts/careerSprintPerfMeasure.js
 */
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
  concurrent: { signalCalls: 1, mongoReads: 2 }
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
  const api = {
    select() { return api; },
    sort() { return api; },
    limit() { return api; },
    lean() { return api; },
    then(resolve, reject) { return loader().then(resolve, reject); }
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
    redisSets: 0
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
      shared.delete(`${namespace}:${key}`);
    },
    runAIAnalysis: async (_prompt, _fallback, retries = 0, opts = {}) => {
      counters.aiCalls += 1;
      await delay(AI_DELAY_MS);
      const value = {
        tasks: Array.from({ length: 6 }, (_, index) => ({
          title: `Build React feature ${index + 1}`,
          description: `Deliver a measurable React Intern task number ${index + 1} with Frontend focus.`,
          category: index % 3 === 0 ? 'learning' : index % 3 === 1 ? 'project' : 'practice'
        }))
      };
      return opts.returnMeta ? { ok: true, value, reason: 'ok', retries } : value;
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
      return { acknowledged: true };
    },
    find: () => createQuery(async () => {
      counters.mongoReads += 1;
      await delay(MONGO_DELAY_MS);
      return [sampleSprint('u1')];
    }),
    create: async () => sampleSprint('u1')
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
  mock('models/scenarioSimulation.js', { findOne: () => createQuery(async () => null) });

  Object.keys(require.cache).forEach((entry) => {
    if (entry.includes(`${path.sep}services${path.sep}careerSprintService`)
      || entry.includes(`${path.sep}services${path.sep}aiTaskService`)) {
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

const measure = async (label, runs, fn) => {
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await fn(index);
    samples.push(performance.now() - started);
  }
  return {
    label,
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2))
  };
};

(async () => {
  const coldHarness = createHarness();
  const cold = await measure('cold_after', 12, async (index) => {
    coldHarness.sprintService.clearCareerSprintMemoryCache();
    await coldHarness.sprintService.getCurrentSprint(`u-cold-${index}`, { forceRefresh: true });
  });

  const memHarness = createHarness();
  await memHarness.sprintService.getCurrentSprint('u1', { forceRefresh: true });
  const memory = await measure('memory_after', 20, async () => {
    await memHarness.sprintService.getCurrentSprint('u1');
  });

  const redisHarness = createHarness();
  await redisHarness.sprintService.getCurrentSprint('u-redis', { forceRefresh: true });
  await flushAsync();
  const redis = await measure('redis_after', 12, async () => {
    redisHarness.sprintService.clearCareerSprintMemoryCache();
    await redisHarness.sprintService.getCurrentSprint('u-redis');
  });

  const planHarness = createHarness();
  const deterministic = await measure('deterministic_plan_after', 8, async (index) => {
    await planHarness.aiTaskService.generateTasks({
      userId: 'u1',
      stack: 'Frontend',
      technology: 'React',
      experienceLevel: 'Intern',
      forceRefresh: index === 0
    });
  });

  const aiHarness = createHarness();
  const ai = await measure('ai_plan_after', 6, async () => {
    await aiHarness.aiTaskService.generateAiTasksWithLLM({
      userId: 'u1',
      stack: 'Frontend',
      technology: 'React',
      experienceLevel: 'Intern',
      forceRefresh: true
    });
  });

  const concurrentHarness = createHarness();
  const beforeSignals = concurrentHarness.counters.signalCalls;
  const beforeMongo = concurrentHarness.counters.mongoReads;
  await Promise.all(Array.from({ length: 5 }, () => concurrentHarness.sprintService.getCurrentSprint('u-concurrent')));

  console.log(JSON.stringify({
    phase: 'AFTER',
    BEFORE,
    cold,
    memory,
    redis,
    deterministic,
    ai,
    concurrent: {
      signalCalls: concurrentHarness.counters.signalCalls - beforeSignals,
      mongoReads: concurrentHarness.counters.mongoReads - beforeMongo
    },
    counters: {
      cold: coldHarness.counters,
      memory: memHarness.counters,
      redis: redisHarness.counters,
      plan: planHarness.counters,
      ai: aiHarness.counters
    }
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
