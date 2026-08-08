'use strict';

/**
 * Learning Hub performance probe (post-optimization).
 * Run: node src/scripts/coursesPerfMeasure.js
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
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const BEFORE = {
  cold: { p50: 255.23, p95: 318.11 },
  mongo_or_redis: { p50: 70.07, p95: 103.4 },
  memory: { p50: 69.4, p95: 100.7 },
  concurrent: { providerCalls: 1, mongoWrites: 5 }
};

const createHarness = ({
  mongoDelayMs = 25,
  youtubeDelayMs = 80,
  redisDelayMs = 12
} = {}) => {
  const mongo = new Map();
  const shared = new Map();
  const counters = {
    mongoReads: 0,
    mongoWrites: 0,
    providerCalls: 0,
    redisGets: 0,
    redisSets: 0,
    poolBuilds: 0,
    pruneCalls: 0
  };

  const sampleCourses = Array.from({ length: 24 }, (_, index) => ({
    id: `c_${index + 1}`,
    title: `Course ${index + 1}`,
    platform: index % 2 ? 'Udemy' : 'Coursera',
    url: `https://www.udemy.com/course/c-${index + 1}/`,
    topics: ['SQL'],
    rating: 4.5,
    popularity: 70,
    relevanceScore: 80,
    finalScore: 75,
    whyRecommended: 'Targets SQL'
  }));

  mock('services/courseService.js', {
    normaliseCourseFilters: (query = {}) => ({
      platform: query.platform || 'All',
      rating: query.rating || '',
      level: query.level || 'All',
      topic: query.topic || '',
      duration: query.duration || 'All',
      page: Math.max(1, Number.parseInt(query.page, 10) || 1),
      limit: Math.min(20, Math.max(1, Number.parseInt(query.limit, 10) || 10))
    }),
    sanitizeSkillList: (values = [], limit = 12) => (
      [...new Set((Array.isArray(values) ? values : String(values || '').split(','))
        .map((value) => String(value || '').trim())
        .filter(Boolean))].slice(0, limit)
    ),
    isPersistableCoursePool: (courses = []) => Array.isArray(courses) && courses.length > 0,
    buildCoursePoolWithMetadata: async () => {
      counters.poolBuilds += 1;
      counters.providerCalls += 1;
      await delay(youtubeDelayMs);
      return {
        courses: sampleCourses,
        sourceMetadata: { source: 'mixed', youtubeStatus: 'available', fallbackUsed: false, sourceMessage: '' }
      };
    }
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
    }
  });

  mock('models/analysisCache.js', {
    findOne: (query) => {
      if (query.analysisVersion === 'v6-skill-intelligence' || query['analysisData.missingSkills.0']) {
        return {
          sort() { return this; },
          select() { return this; },
          lean: async () => {
            counters.mongoReads += 1;
            await delay(mongoDelayMs);
            return {
              analysisData: {
                missingSkills: [{ name: 'SQL' }],
                yourSkills: [{ name: 'Node.js' }]
              },
              updatedAt: new Date()
            };
          }
        };
      }
      const key = JSON.stringify({
        userId: String(query.userId),
        githubUsername: query.githubUsername,
        careerStack: query.careerStack,
        experienceLevel: query.experienceLevel,
        analysisVersion: query.analysisVersion,
        resumeHash: query.resumeHash,
        signalHash: query.signalHash
      });
      return {
        sort() { return this; },
        select() { return this; },
        lean: async () => {
          counters.mongoReads += 1;
          await delay(mongoDelayMs);
          const row = mongo.get(key) || null;
          if (!row) return null;
          if (query.updatedAt?.$gte && row.updatedAt < query.updatedAt.$gte) return null;
          return row;
        }
      };
    },
    findOneAndUpdate: async (query, update) => {
      counters.mongoWrites += 1;
      await delay(mongoDelayMs);
      const key = JSON.stringify({
        userId: String(query.userId),
        githubUsername: query.githubUsername,
        careerStack: query.careerStack,
        experienceLevel: query.experienceLevel,
        analysisVersion: query.analysisVersion,
        resumeHash: query.resumeHash,
        signalHash: query.signalHash
      });
      const row = { ...query, ...update.$set, updatedAt: new Date() };
      mongo.set(key, row);
      return row;
    },
    find: () => ({
      sort() { return this; },
      skip() { return this; },
      select() { return this; },
      lean: async () => {
        counters.pruneCalls += 1;
        return [];
      }
    }),
    deleteMany: async () => {
      counters.pruneCalls += 1;
      return { deletedCount: 0 };
    }
  });

  Object.keys(require.cache).forEach((entry) => {
    if (entry.includes(`${path.sep}controllers${path.sep}courseController`)) {
      delete require.cache[entry];
    }
  });
  const controller = require('../controllers/courseController');
  controller.clearCourseMemoryCache();
  return { controller, counters, shared, mongo };
};

const invoke = async (controller) => {
  const req = {
    user: { _id: 'user-1', careerStack: 'Backend', experienceLevel: 'Intern' },
    query: {}
  };
  let body = null;
  const res = {
    status() { return this; },
    json(payload) { body = payload; return payload; }
  };
  await controller.fetchCourses(req, res);
  return body;
};

const measureSeries = async (label, runs, fn) => {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const maybeElapsed = await fn();
    times.push(typeof maybeElapsed === 'number' ? maybeElapsed : 0);
  }
  return {
    label,
    p50: Number(percentile(times, 50).toFixed(2)),
    p95: Number(percentile(times, 95).toFixed(2))
  };
};

(async () => {
  const coldHarness = createHarness();
  const cold = await measureSeries('cold', 8, async () => {
    await flushAsync();
    await delay(40);
    coldHarness.mongo.clear();
    coldHarness.shared.clear();
    coldHarness.controller.clearCourseMemoryCache();
    const started = performance.now();
    await invoke(coldHarness.controller);
    const elapsed = performance.now() - started;
    await flushAsync();
    await delay(40);
    return elapsed;
  });

  const redisHarness = createHarness();
  await invoke(redisHarness.controller);
  await flushAsync();
  await delay(40);
  const redisWarm = await measureSeries('redis_warm', 12, async () => {
    redisHarness.controller.clearCourseMemoryCache();
    const started = performance.now();
    await invoke(redisHarness.controller);
    return performance.now() - started;
  });

  const memoryHarness = createHarness();
  await invoke(memoryHarness.controller);
  await flushAsync();
  const memoryWarm = await measureSeries('memory_warm', 16, async () => {
    const started = performance.now();
    await invoke(memoryHarness.controller);
    return performance.now() - started;
  });

  const concurrentHarness = createHarness({ youtubeDelayMs: 120 });
  concurrentHarness.mongo.clear();
  concurrentHarness.shared.clear();
  concurrentHarness.controller.clearCourseMemoryCache();
  const before = { ...concurrentHarness.counters };
  await Promise.all(Array.from({ length: 5 }, () => invoke(concurrentHarness.controller)));
  await flushAsync();
  await flushAsync();
  const concurrent = {
    poolBuilds: concurrentHarness.counters.poolBuilds - before.poolBuilds,
    providerCalls: concurrentHarness.counters.providerCalls - before.providerCalls,
    mongoWrites: concurrentHarness.counters.mongoWrites - before.mongoWrites,
    redisSets: concurrentHarness.counters.redisSets - before.redisSets
  };

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    before: BEFORE,
    after: { cold, redisWarm, memoryWarm, concurrent }
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
