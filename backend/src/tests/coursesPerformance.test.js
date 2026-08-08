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
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const BEFORE = {
  cold: { p50: 255.23, p95: 318.11 },
  mongo_or_redis: { p50: 70.07, p95: 103.4 },
  memory: { p50: 69.4, p95: 100.7 },
  concurrent: { providerCalls: 1, poolBuilds: 1, mongoWrites: 5 }
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
    pruneCalls: 0,
    aiCalls: 0
  };

  const sampleCourses = Array.from({ length: 24 }, (_, index) => ({
    id: `c_${index + 1}`,
    title: `Course ${index + 1}`,
    platform: index % 2 ? 'Udemy' : 'Coursera',
    url: `https://www.udemy.com/course/c-${index + 1}/`,
    topics: ['SQL', 'Node.js'],
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
    sanitizeSkillList: (values = [], limit = 12) => {
      const list = Array.isArray(values) ? values : String(values || '').split(',');
      return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit);
    },
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
        select(projection) {
          this._projection = projection;
          return this;
        },
        lean: async () => {
          counters.mongoReads += 1;
          await delay(mongoDelayMs);
          const row = mongo.get(key) || null;
          if (!row) return null;
          if (query.updatedAt?.$gte && row.updatedAt < query.updatedAt.$gte) return null;
          if (this._projection?.['analysisData.allCourses'] === 1 || this._projection?.['analysisData.allCourses']) {
            return {
              analysisData: {
                allCourses: row.analysisData.allCourses,
                total: row.analysisData.total,
                sourceMetadata: row.analysisData.sourceMetadata
              },
              updatedAt: row.updatedAt
            };
          }
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
      const row = {
        ...query,
        ...update.$set,
        updatedAt: new Date()
      };
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

const invoke = async (controller, { userId = 'user-1', query = {} } = {}) => {
  const req = {
    user: { _id: userId, careerStack: 'Backend', experienceLevel: 'Intern' },
    query
  };
  let status = 200;
  let body = null;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return payload; }
  };
  await controller.fetchCourses(req, res);
  return { status, body };
};

const measureSeries = async (runs, fn) => {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const maybeElapsed = await fn();
    times.push(typeof maybeElapsed === 'number' ? maybeElapsed : performance.now() - started);
  }
  return {
    p50: Number(percentile(times, 50).toFixed(2)),
    p95: Number(percentile(times, 95).toFixed(2))
  };
};

test('Learning Hub memory path bypasses Redis, Mongo pool reads, and providers', async () => {
  const harness = createHarness();
  await invoke(harness.controller);
  await flushAsync();

  const before = { ...harness.counters };
  const memory = await measureSeries(16, async () => {
    const result = await invoke(harness.controller);
    assert.equal(result.body.fromCache, true);
    assert.equal(result.body.cacheMetadata?.cacheLayer, 'memory');
  });

  assert.equal(harness.counters.providerCalls, before.providerCalls);
  assert.equal(harness.counters.redisGets, before.redisGets);
  assert.equal(harness.counters.mongoWrites, before.mongoWrites);
  assert.ok(memory.p95 < 50, `memory p95 ${memory.p95} should be < 50`);
  assert.ok(memory.p95 < BEFORE.memory.p95);
});

test('Learning Hub Redis path skips provider and Mongo pool reads', async () => {
  const harness = createHarness({ redisDelayMs: 15 });
  await invoke(harness.controller);
  await flushAsync();
  harness.controller.clearCourseMemoryCache();

  const before = { ...harness.counters };
  const redis = await measureSeries(12, async () => {
    const result = await invoke(harness.controller);
    assert.equal(result.body.fromCache, true);
    assert.ok(['redis', 'memory'].includes(result.body.cacheMetadata?.cacheLayer));
  });

  assert.equal(harness.counters.providerCalls, before.providerCalls);
  assert.ok(harness.counters.redisGets > before.redisGets || harness.counters.memoryHits >= 0);
  assert.ok(redis.p95 < 250, `redis p95 ${redis.p95} should be < 250`);
});

test('Learning Hub cold path stays under non-AI budget and records stage timings', async () => {
  const harness = createHarness({ youtubeDelayMs: 90, mongoDelayMs: 20 });
  const drainPersistence = async () => {
    await flushAsync();
    await delay(60);
  };

  const cold = await measureSeries(8, async () => {
    await drainPersistence();
    harness.mongo.clear();
    harness.shared.clear();
    harness.controller.clearCourseMemoryCache();
    const started = performance.now();
    const result = await invoke(harness.controller);
    const elapsed = performance.now() - started;
    assert.equal(result.status, 200);
    assert.equal(result.body.fromCache, false);
    assert.equal(result.body.cacheMetadata?.cacheLayer, 'miss');
    assert.ok(result.body.cacheMetadata?.stageTimingsMs?.total > 0);
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'cache'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'Redis'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'Mongo'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'external provider'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'AI'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'deterministic processing'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'validation'));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body.cacheMetadata.stageTimingsMs, 'persistence'));
    await drainPersistence();
    return elapsed;
  });

  assert.ok(cold.p95 < 500, `cold p95 ${cold.p95} should be < 500`);
  assert.ok(cold.p95 <= BEFORE.cold.p95 + 80);
});

test('five identical Learning Hub callers share one provider pipeline and one persistence sequence', async () => {
  const harness = createHarness({ youtubeDelayMs: 120 });
  harness.mongo.clear();
  harness.shared.clear();
  harness.controller.clearCourseMemoryCache();

  const before = { ...harness.counters };
  const results = await Promise.all(Array.from({ length: 5 }, () => invoke(harness.controller)));
  await flushAsync();
  await flushAsync();

  assert.equal(results.length, 5);
  assert.equal(harness.counters.poolBuilds - before.poolBuilds, 1);
  assert.equal(harness.counters.providerCalls - before.providerCalls, 1);
  assert.equal(harness.counters.aiCalls - before.aiCalls, 0);
  assert.equal(harness.counters.mongoWrites - before.mongoWrites, 1);
  assert.equal(harness.counters.redisSets - before.redisSets, 1);
});

test('different users remain independent under concurrency', async () => {
  const harness = createHarness({ youtubeDelayMs: 60 });
  harness.controller.clearCourseMemoryCache();

  const before = { ...harness.counters };
  await Promise.all([
    invoke(harness.controller, { userId: 'user-a' }),
    invoke(harness.controller, { userId: 'user-b' })
  ]);
  await flushAsync();

  assert.equal(harness.counters.poolBuilds - before.poolBuilds, 2);
  assert.equal(harness.counters.providerCalls - before.providerCalls, 2);
});

test('failed or empty pools are not cached in memory or Redis', async () => {
  const harness = createHarness();
  mock('services/courseService.js', {
    normaliseCourseFilters: (query = {}) => ({
      platform: query.platform || 'All',
      rating: '',
      level: 'All',
      topic: '',
      duration: 'All',
      page: 1,
      limit: 10
    }),
    sanitizeSkillList: (values = [], limit = 12) => (
      [...new Set((Array.isArray(values) ? values : String(values || '').split(','))
        .map((value) => String(value || '').trim())
        .filter(Boolean))].slice(0, limit)
    ),
    isPersistableCoursePool: () => false,
    buildCoursePoolWithMetadata: async () => {
      harness.counters.poolBuilds += 1;
      harness.counters.providerCalls += 1;
      return { courses: [], sourceMetadata: { source: 'curated', fallbackUsed: false } };
    }
  });

  Object.keys(require.cache).forEach((entry) => {
    if (entry.includes(`${path.sep}controllers${path.sep}courseController`)) {
      delete require.cache[entry];
    }
  });
  const controller = require('../controllers/courseController');
  controller.clearCourseMemoryCache();

  const beforeSets = harness.counters.redisSets;
  const beforeWrites = harness.counters.mongoWrites;
  await invoke(controller);
  await flushAsync();

  assert.equal(controller.getCourseMemoryCacheSize(), 0);
  assert.equal(harness.counters.redisSets, beforeSets);
  assert.equal(harness.counters.mongoWrites, beforeWrites);
});
