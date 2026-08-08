const crypto = require('node:crypto');
const {
  buildCoursePoolWithMetadata,
  normaliseCourseFilters,
  isPersistableCoursePool,
  sanitizeSkillList
} = require('../services/courseService');
const AnalysisCache = require('../models/analysisCache');
const aiService = require('../services/aiservice');

const COURSE_POOL_VERSION = 'courses_pool_v5';
const SKILL_GAP_ANALYSIS_VERSION = 'v6-skill-intelligence';
const COURSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_COURSE_CACHE_VARIANTS = 40;
const COURSE_MEMORY_TTL_MS = Math.min(
  5 * 60 * 1000,
  Math.max(15_000, Number.parseInt(process.env.COURSES_MEMORY_TTL_MS || '60000', 10) || 60_000)
);
const COURSE_REDIS_LOOKUP_BUDGET_MS = Math.min(
  250,
  Math.max(40, Number.parseInt(process.env.COURSES_REDIS_LOOKUP_BUDGET_MS || '120', 10) || 120)
);
const COURSE_REDIS_TTL_SECONDS = Math.min(
  3600,
  Math.max(60, Number.parseInt(process.env.COURSES_REDIS_TTL_SECONDS || '900', 10) || 900)
);
const COURSE_SIGNAL_MEMORY_TTL_MS = Math.min(
  2 * 60 * 1000,
  Math.max(10_000, Number.parseInt(process.env.COURSES_SIGNAL_MEMORY_TTL_MS || '30000', 10) || 30_000)
);
const MAX_COURSE_MEMORY_ENTRIES = 80;
const VALID_CAREER_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const VALID_EXPERIENCE_LEVELS = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
const STAGE_TIMINGS_ENABLED = process.env.NODE_ENV !== 'production'
  || process.env.COURSES_STAGE_TIMINGS === 'true'
  || process.env.NODE_ENV === 'test';

const EMPTY_STAGE_TIMINGS = Object.freeze({
  cache: 0,
  Redis: 0,
  Mongo: 0,
  'external provider': 0,
  AI: 0,
  'deterministic processing': 0,
  validation: 0,
  persistence: 0
});

const coursePoolInflight = new Map();
const courseSignalInflight = new Map();
const courseMemoryCache = new Map();
const courseSignalMemoryCache = new Map();
const courseRuntimeCounters = {
  pipelineExecutions: 0,
  providerCalls: 0,
  aiCalls: 0,
  persistenceOperations: 0,
  memoryHits: 0,
  redisHits: 0,
  mongoHits: 0
};

const uniqueStrings = (values = [], limit = 8) => sanitizeSkillList(values, limit);

const createStageTimer = () => {
  const startedAt = process.hrtime.bigint();
  const stages = { ...EMPTY_STAGE_TIMINGS };
  return {
    async measure(name, work) {
      const stageStartedAt = process.hrtime.bigint();
      const value = await work();
      const elapsed = Number(process.hrtime.bigint() - stageStartedAt) / 1e6;
      stages[name] = Number(((Number(stages[name]) || 0) + elapsed).toFixed(4));
      return value;
    },
    mark(name, started) {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      stages[name] = Number(((Number(stages[name]) || 0) + elapsed).toFixed(4));
    },
    attach(result) {
      if (!STAGE_TIMINGS_ENABLED || !result || typeof result !== 'object') return result;
      const total = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        ...result,
        cacheMetadata: {
          ...(result.cacheMetadata || {}),
          stageTimingsMs: { ...stages, total: Number(total.toFixed(4)) },
          requestCounters: { ...courseRuntimeCounters }
        }
      };
    }
  };
};

const withBudget = async (promise, budgetMs, fallback = null) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), budgetMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolveCareerStack = (user, query = {}) => {
  const candidate = String(user?.careerStack || query.stack || 'Full Stack').trim();
  return VALID_CAREER_STACKS.includes(candidate) ? candidate : 'Full Stack';
};

const resolveExperienceLevel = (user, query = {}) => {
  const candidate = String(user?.experienceLevel || query.experience || 'Student').trim();
  return VALID_EXPERIENCE_LEVELS.includes(candidate) ? candidate : 'Student';
};

const readCourseMemory = (key) => {
  if (!key) return null;
  const entry = courseMemoryCache.get(key);
  if (!entry) return null;
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    courseMemoryCache.delete(key);
    return null;
  }
  courseMemoryCache.delete(key);
  courseMemoryCache.set(key, entry);
  return entry;
};

const writeCourseMemory = (key, payload) => {
  if (!key || !payload || !Array.isArray(payload.allCourses) || !payload.allCourses.length) return;
  courseMemoryCache.set(key, {
    ...payload,
    expiresAt: Date.now() + COURSE_MEMORY_TTL_MS
  });
  while (courseMemoryCache.size > MAX_COURSE_MEMORY_ENTRIES) {
    const oldest = courseMemoryCache.keys().next().value;
    courseMemoryCache.delete(oldest);
  }
};

const readSignalMemory = (key) => {
  if (!key) return null;
  const entry = courseSignalMemoryCache.get(key);
  if (!entry) return null;
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    courseSignalMemoryCache.delete(key);
    return null;
  }
  return entry.value;
};

const writeSignalMemory = (key, value) => {
  if (!key || !value) return;
  courseSignalMemoryCache.set(key, {
    value,
    expiresAt: Date.now() + COURSE_SIGNAL_MEMORY_TTL_MS
  });
  while (courseSignalMemoryCache.size > MAX_COURSE_MEMORY_ENTRIES) {
    const oldest = courseSignalMemoryCache.keys().next().value;
    courseSignalMemoryCache.delete(oldest);
  }
};

const clearCourseMemoryCache = () => {
  courseMemoryCache.clear();
  courseSignalMemoryCache.clear();
};

const getCourseMemoryCacheSize = () => courseMemoryCache.size;

const buildRedisResultKey = ({ userId, poolHash }) => `${userId}:${poolHash}:${COURSE_POOL_VERSION}`;

const resolveSkillSignals = async (userId, careerStack, experienceLevel, stageTimer) => {
  if (!userId) return { skillGaps: [], knownSkills: [] };

  const signalKey = `${userId}:${careerStack}:${experienceLevel}:${SKILL_GAP_ANALYSIS_VERSION}`;
  const cached = readSignalMemory(signalKey);
  if (cached) return cached;

  const existing = courseSignalInflight.get(signalKey);
  if (existing) return existing;

  const measure = stageTimer
    ? (work) => stageTimer.measure('Mongo', work)
    : (work) => work();

  const workPromise = (async () => {
    try {
      const latestSkillGap = await measure(() => AnalysisCache.findOne({
        userId,
        careerStack,
        experienceLevel,
        analysisVersion: SKILL_GAP_ANALYSIS_VERSION,
        'analysisData.missingSkills.0': { $exists: true }
      })
        .sort({ updatedAt: -1 })
        .select({ 'analysisData.missingSkills': 1, 'analysisData.yourSkills': 1 })
        .lean());

      const missingSkills = Array.isArray(latestSkillGap?.analysisData?.missingSkills)
        ? latestSkillGap.analysisData.missingSkills.map((item) => item?.name || item)
        : [];
      const knownSkills = Array.isArray(latestSkillGap?.analysisData?.yourSkills)
        ? latestSkillGap.analysisData.yourSkills.map((item) => item?.name || item)
        : [];

      const resolved = {
        skillGaps: uniqueStrings(missingSkills, 12),
        knownSkills: uniqueStrings(knownSkills, 20)
      };
      writeSignalMemory(signalKey, resolved);
      return resolved;
    } finally {
      if (courseSignalInflight.get(signalKey) === workPromise) {
        courseSignalInflight.delete(signalKey);
      }
    }
  })();

  courseSignalInflight.set(signalKey, workPromise);
  return workPromise;
};

const buildPoolCacheKey = ({ userId, careerStack, experienceLevel, skillGaps, knownSkills, filters }) => {
  const poolSeed = JSON.stringify({
    careerStack,
    experienceLevel,
    skillGaps: uniqueStrings(skillGaps, 6),
    knownSkills: uniqueStrings(knownSkills, 10),
    platform: filters.platform,
    rating: filters.rating,
    level: filters.level,
    topic: filters.topic,
    duration: filters.duration
  });
  const hash = crypto.createHash('sha256').update(poolSeed).digest('hex').slice(0, 20);

  return {
    poolHash: hash,
    memoryKey: `courses:pool:${userId}:${hash}:${COURSE_POOL_VERSION}`,
    redisKey: buildRedisResultKey({ userId, poolHash: hash }),
    cacheLookup: {
      userId,
      githubUsername: `courses_pool_${hash}`,
      careerStack,
      experienceLevel,
      analysisVersion: COURSE_POOL_VERSION,
      resumeHash: 'no-resume',
      signalHash: hash
    }
  };
};

const buildRecommendedBasedOn = ({
  careerStack,
  experienceLevel,
  skillGaps,
  filters,
  fromCache,
  sourceMetadata = {}
}) => {
  const skillGapsUsed = uniqueStrings(skillGaps, 4);
  const activeFilters = {
    platform: filters.platform,
    rating: filters.rating,
    level: filters.level,
    duration: filters.duration,
    topic: filters.topic
  };
  const activeFilterParts = [];
  if (filters.platform !== 'All') activeFilterParts.push(filters.platform);
  if (filters.rating) activeFilterParts.push(`${filters.rating}+ rating`);
  if (filters.level !== 'All') activeFilterParts.push(filters.level);
  if (filters.duration !== 'All') activeFilterParts.push(`${filters.duration} hours`);
  if (filters.topic) activeFilterParts.push(`topic: ${filters.topic}`);

  const summary = [
    `Courses are recommended for your ${careerStack} profile at ${experienceLevel} level.`,
    skillGapsUsed.length
      ? `Top skill gaps used: ${skillGapsUsed.join(', ')}.`
      : 'Skill gap evidence is limited, so broader stack matching was used.',
    activeFilterParts.length
      ? `Active filters: ${activeFilterParts.join(', ')}.`
      : 'No extra filters are active right now.'
  ].join(' ');

  return {
    careerStack,
    experienceLevel,
    skillGapsUsed,
    activeFilters,
    fromCache,
    summary,
    ...sourceMetadata
  };
};

const paginatePool = (pool, filters) => {
  const allCourses = Array.isArray(pool?.allCourses) ? pool.allCourses : [];
  const total = Number.isFinite(pool?.total) ? pool.total : allCourses.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit) || 1);
  const safePage = Math.min(filters.page, totalPages);
  const startIndex = (safePage - 1) * filters.limit;
  return {
    courses: allCourses.slice(startIndex, startIndex + filters.limit),
    total,
    page: safePage,
    totalPages,
    sourceMetadata: pool?.sourceMetadata || {}
  };
};

const readFullPoolFromMongo = async (cacheLookup) => {
  const cached = await AnalysisCache.findOne({
    ...cacheLookup,
    updatedAt: { $gte: new Date(Date.now() - COURSE_CACHE_TTL_MS) }
  })
    .select({
      'analysisData.allCourses': 1,
      'analysisData.total': 1,
      'analysisData.sourceMetadata': 1,
      updatedAt: 1
    })
    .lean();

  if (!Number.isFinite(cached?.analysisData?.total) || cached.analysisData.total <= 0) return null;
  if (!Array.isArray(cached.analysisData.allCourses) || !cached.analysisData.allCourses.length) return null;

  return {
    allCourses: cached.analysisData.allCourses,
    total: cached.analysisData.total,
    sourceMetadata: cached.analysisData.sourceMetadata || {},
    updatedAt: cached.updatedAt || new Date()
  };
};

const pruneCourseCache = async (userId) => {
  const cutoff = new Date(Date.now() - COURSE_CACHE_TTL_MS);
  await AnalysisCache.deleteMany({
    userId,
    githubUsername: /^courses_pool_/,
    $or: [
      { analysisVersion: { $ne: COURSE_POOL_VERSION } },
      { updatedAt: { $lt: cutoff } }
    ]
  });

  const overflow = await AnalysisCache.find({
    userId,
    analysisVersion: COURSE_POOL_VERSION,
    githubUsername: /^courses_pool_/
  })
    .sort({ updatedAt: -1 })
    .skip(MAX_COURSE_CACHE_VARIANTS)
    .select({ _id: 1 })
    .lean();

  if (overflow.length) {
    await AnalysisCache.deleteMany({ _id: { $in: overflow.map((entry) => entry._id) } });
  }
};

const persistCoursePoolAsync = ({ cacheLookup, redisKey, allCourses, total, sourceMetadata, userId }) => {
  setImmediate(() => {
    courseRuntimeCounters.persistenceOperations += 1;
    AnalysisCache.findOneAndUpdate(
      cacheLookup,
      {
        $set: {
          ...cacheLookup,
          analysisData: {
            allCourses,
            total,
            sourceMetadata
          }
        }
      },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch(() => null);

    aiService.setSharedCache(redisKey, {
      allCourses,
      total,
      sourceMetadata,
      updatedAt: new Date().toISOString()
    }, COURSE_REDIS_TTL_SECONDS, 'courses:result').catch(() => {});

    pruneCourseCache(userId).catch(() => null);
  });
};

const buildOrShareCoursePool = async (inflightKey, buildFn) => {
  const existing = coursePoolInflight.get(inflightKey);
  if (existing) return existing;

  const workPromise = Promise.resolve()
    .then(buildFn)
    .finally(() => {
      if (coursePoolInflight.get(inflightKey) === workPromise) {
        coursePoolInflight.delete(inflightKey);
      }
    });

  coursePoolInflight.set(inflightKey, workPromise);
  return workPromise;
};

const buildResponsePayload = ({
  pageResult,
  fromCache,
  cacheLayer,
  careerStack,
  experienceLevel,
  skillGaps,
  filters,
  poolHash
}) => ({
  courses: pageResult.courses,
  total: pageResult.total,
  page: pageResult.page,
  totalPages: pageResult.totalPages,
  hasMore: pageResult.page < pageResult.totalPages,
  fromCache,
  recommendedBasedOn: buildRecommendedBasedOn({
    careerStack,
    experienceLevel,
    skillGaps,
    filters,
    fromCache,
    sourceMetadata: pageResult.sourceMetadata
  }),
  cacheMetadata: {
    loadedFromCache: fromCache,
    cacheLayer,
    signalHash: poolHash,
    analysisVersion: COURSE_POOL_VERSION
  }
});

const fetchCourses = async (req, res) => {
  const stageTimer = createStageTimer();
  try {
    const validationStarted = process.hrtime.bigint();
    const userId = req.user?._id;
    if (!userId) {
      stageTimer.mark('validation', validationStarted);
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const careerStack = resolveCareerStack(req.user, req.query);
    const experienceLevel = resolveExperienceLevel(req.user, req.query);
    const filters = normaliseCourseFilters(req.query);
    stageTimer.mark('validation', validationStarted);

    const skillSignals = await resolveSkillSignals(userId, careerStack, experienceLevel, stageTimer);
    let skillGaps = skillSignals.skillGaps;

    if (Object.prototype.hasOwnProperty.call(req.query, 'skillGaps')) {
      skillGaps = sanitizeSkillList(req.query.skillGaps, 12);
    }

    const { cacheLookup, poolHash, memoryKey, redisKey } = buildPoolCacheKey({
      userId,
      careerStack,
      experienceLevel,
      skillGaps,
      knownSkills: skillSignals.knownSkills,
      filters
    });

    const memoryHit = await stageTimer.measure('cache', () => Promise.resolve(readCourseMemory(memoryKey)));
    if (memoryHit?.allCourses?.length) {
      courseRuntimeCounters.memoryHits += 1;
      const pageResult = paginatePool(memoryHit, filters);
      return res.json(stageTimer.attach(buildResponsePayload({
        pageResult,
        fromCache: true,
        cacheLayer: 'memory',
        careerStack,
        experienceLevel,
        skillGaps,
        filters,
        poolHash
      })));
    }

    const redisPromise = withBudget(
      aiService.getSharedCache(redisKey, 'courses:result'),
      COURSE_REDIS_LOOKUP_BUDGET_MS,
      null
    );
    const mongoPromise = readFullPoolFromMongo(cacheLookup);

    const redisCached = await stageTimer.measure('Redis', () => redisPromise);
    if (redisCached?.allCourses?.length && Number(redisCached.total) > 0) {
      courseRuntimeCounters.redisHits += 1;
      mongoPromise.catch(() => null);
      writeCourseMemory(memoryKey, {
        allCourses: redisCached.allCourses,
        total: redisCached.total,
        sourceMetadata: redisCached.sourceMetadata || {}
      });
      const pageResult = paginatePool(redisCached, filters);
      return res.json(stageTimer.attach(buildResponsePayload({
        pageResult,
        fromCache: true,
        cacheLayer: 'redis',
        careerStack,
        experienceLevel,
        skillGaps,
        filters,
        poolHash
      })));
    }

    const mongoPool = await stageTimer.measure('Mongo', () => mongoPromise);
    if (mongoPool?.allCourses?.length) {
      courseRuntimeCounters.mongoHits += 1;
      writeCourseMemory(memoryKey, mongoPool);
      setImmediate(() => {
        aiService.setSharedCache(redisKey, {
          allCourses: mongoPool.allCourses,
          total: mongoPool.total,
          sourceMetadata: mongoPool.sourceMetadata || {},
          updatedAt: (mongoPool.updatedAt || new Date()).toISOString?.() || new Date().toISOString()
        }, COURSE_REDIS_TTL_SECONDS, 'courses:result').catch(() => {});
      });
      const pageResult = paginatePool(mongoPool, filters);
      return res.json(stageTimer.attach(buildResponsePayload({
        pageResult,
        fromCache: true,
        cacheLayer: 'mongo',
        careerStack,
        experienceLevel,
        skillGaps,
        filters,
        poolHash
      })));
    }

    const inflightKey = `${userId}:${poolHash}`;
    const built = await buildOrShareCoursePool(inflightKey, async () => {
      courseRuntimeCounters.pipelineExecutions += 1;
      courseRuntimeCounters.providerCalls += 1;
      const providerStarted = process.hrtime.bigint();
      const result = await buildCoursePoolWithMetadata({
        careerStack,
        experienceLevel,
        skillGaps,
        knownSkills: skillSignals.knownSkills,
        ...filters
      });
      // Only the winning request owns this timer; waiters still share the pool result.
      stageTimer.mark('external provider', providerStarted);

      const allCourses = Array.isArray(result.courses) ? result.courses : [];
      const total = allCourses.length;
      const sourceMetadata = result.sourceMetadata || {};

      if (isPersistableCoursePool(allCourses)) {
        writeCourseMemory(memoryKey, { allCourses, total, sourceMetadata });
        stageTimer.mark('persistence', process.hrtime.bigint());
        persistCoursePoolAsync({
          cacheLookup,
          redisKey,
          allCourses,
          total,
          sourceMetadata,
          userId
        });
      }

      return { allCourses, total, sourceMetadata };
    });

    const pageResult = await stageTimer.measure('deterministic processing', async () => paginatePool(built, filters));

    return res.json(stageTimer.attach(buildResponsePayload({
      pageResult,
      fromCache: false,
      cacheLayer: 'miss',
      careerStack,
      experienceLevel,
      skillGaps,
      filters,
      poolHash
    })));
  } catch (error) {
    console.error('[CourseController] Unhandled error:', error.message);
    return res.status(500).json({
      message: 'Failed to fetch course recommendations. Please try again.'
    });
  }
};

module.exports = {
  fetchCourses,
  resolveSkillSignals,
  resolveCareerStack,
  resolveExperienceLevel,
  buildPoolCacheKey,
  buildOrShareCoursePool,
  clearCourseMemoryCache,
  getCourseMemoryCacheSize,
  COURSE_POOL_VERSION,
  SKILL_GAP_ANALYSIS_VERSION,
  COURSE_REDIS_LOOKUP_BUDGET_MS,
  COURSE_MEMORY_TTL_MS
};
