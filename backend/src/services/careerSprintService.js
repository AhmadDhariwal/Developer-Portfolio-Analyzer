const CareerSprint = require('../models/careerSprint');
const ScenarioSimulation = require('../models/scenarioSimulation');
const mongoose = require('mongoose');
const aiService = require('./aiservice');
const { getDeveloperSignals } = require('./developerSignalService');
const { recordActivity, checkInactivity, restoreStreak: restoreStreakFn, canRestore, MAX_RESTORE_DAYS } = require('./streakService');
const { startOfDay, endOfDay, addDays, daysBetween } = require('../utils/dateUtils');

const CAREER_SPRINT_OVERVIEW_VERSION = 'overview_v2';
const SPRINT_CACHE_TTL_MS = Math.max(1_000, Number(process.env.CAREER_SPRINT_CACHE_TTL_MS) || 60_000);
const SPRINT_CACHE_MAX_SIZE = Math.max(10, Number(process.env.CAREER_SPRINT_CACHE_MAX_SIZE) || 500);
const SPRINT_REDIS_BUDGET_MS = Math.max(20, Number(process.env.CAREER_SPRINT_REDIS_BUDGET_MS) || 120);
const SPRINT_REDIS_TTL_SECONDS = Math.max(30, Number(process.env.CAREER_SPRINT_REDIS_TTL_SECONDS) || 120);
const STAGE_TIMINGS_ENABLED = process.env.CAREER_SPRINT_STAGE_TIMINGS === '1'
  || process.env.NODE_ENV !== 'production';
const OVERVIEW_REDIS_NAMESPACE = 'career_sprint:overview';

const sprintOverviewCache = new Map();
const sprintOverviewInflight = new Map();
const sprintCacheEpoch = new Map();
const runtimeCounters = {
  pipelineExecutions: 0,
  memoryHits: 0,
  redisHits: 0,
  mongoHits: 0,
  signalCalls: 0,
  persistenceOperations: 0,
  redisWrites: 0
};

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

const LIMITS = {
  title: 120,
  description: 1000,
  goalField: 80,
  planName: 120,
  summary: 500,
  signalsUsed: 12,
  tasksPerPlan: 20,
  tasksPerCreate: 30
};

const userCacheKey = (userId) => String(userId || '');
const overviewWeekKey = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};
const overviewIdentityKey = (userId, weekStartIso = overviewWeekKey()) => (
  `${CAREER_SPRINT_OVERVIEW_VERSION}:${userCacheKey(userId)}:${weekStartIso}`
);
const memoryOverviewKey = (userId) => `${userCacheKey(userId)}:${overviewWeekKey()}`;
const cloneCached = (value) => JSON.parse(JSON.stringify(value));

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
    attach(result) {
      if (!STAGE_TIMINGS_ENABLED || !result || typeof result !== 'object' || Array.isArray(result)) return result;
      const total = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        ...result,
        cacheMetadata: {
          ...(result.cacheMetadata || {}),
          stageTimingsMs: { ...stages, total: Number(total.toFixed(4)) },
          requestCounters: { ...runtimeCounters }
        }
      };
    }
  };
};

const setBoundedCache = (cache, key, value) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > SPRINT_CACHE_MAX_SIZE) cache.delete(cache.keys().next().value);
};

const isPersistableOverview = (value) => Boolean(
  value
  && value._id
  && Array.isArray(value.tasks)
  && value.analytics
  && Number.isFinite(Number(value.analytics.progressPercent))
);

const stripTimingMetadata = (value) => {
  if (!value || typeof value !== 'object') return value;
  const cloned = cloneCached(value);
  if (cloned && Object.prototype.hasOwnProperty.call(cloned, 'cacheMetadata')) {
    delete cloned.cacheMetadata;
  }
  return cloned;
};

const persistOverviewAsync = (userId, value) => {
  if (!isPersistableOverview(value)) return;
  const payload = stripTimingMetadata(value);
  setImmediate(() => {
    runtimeCounters.redisWrites += 1;
    aiService.setSharedCache(
      overviewIdentityKey(userId),
      payload,
      SPRINT_REDIS_TTL_SECONDS,
      OVERVIEW_REDIS_NAMESPACE
    ).catch(() => {});
  });
};

const invalidateCareerSprintCache = (userId) => {
  const key = memoryOverviewKey(userId);
  sprintOverviewCache.delete(key);
  sprintCacheEpoch.set(key, (sprintCacheEpoch.get(key) || 0) + 1);
  // Also clear legacy user-only key if present.
  sprintOverviewCache.delete(userCacheKey(userId));
  setImmediate(() => {
    aiService.invalidateCacheKey(overviewIdentityKey(userId), OVERVIEW_REDIS_NAMESPACE).catch(() => {});
  });
};

const clearCareerSprintMemoryCache = () => {
  sprintOverviewCache.clear();
  sprintOverviewInflight.clear();
  sprintCacheEpoch.clear();
};

const getCareerSprintRuntimeCounters = () => ({ ...runtimeCounters });
const resetCareerSprintRuntimeCounters = () => {
  Object.keys(runtimeCounters).forEach((key) => {
    runtimeCounters[key] = 0;
  });
};

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const createHttpError = (statusCode, message, details = []) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details.length) error.details = details;
  return error;
};

const assertObjectId = (id, label = 'Resource') => {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) {
    throw createHttpError(404, `${label} not found.`);
  }
};

const sanitizeBoundedText = (value, max, field, { required = false } = {}) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (required && !text) throw createHttpError(400, `${field} is required.`);
  if (text.length > max) throw createHttpError(413, `${field} is too large.`);
  return text;
};

const parseDateOrNull = (value) => {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw createHttpError(400, 'Invalid date value.');
  return parsed;
};

const assertDateRange = (start, end) => {
  if (start && end && startOfDay(start).getTime() > startOfDay(end).getTime()) {
    throw createHttpError(400, 'Sprint end date must be on or after the start date.');
  }
};

const startOfWeek = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfWeek = (start) => {
  const d = new Date(start);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
};

const POINTS_TO_XP = { high: 15, medium: 10, low: 5 };

const xpForTask = (task) => {
  const base = POINTS_TO_XP[task.priority] || 10;
  return base + Number(task.points || 0);
};

const levelFromXp = (xp) => Math.max(1, Math.floor(Number(xp || 0) / 100) + 1);

const calcWeightedProgress = (tasks) => {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  const totalPts = tasks.reduce((sum, task) => sum + (Number(task.points) || 1), 0);
  const donePts = tasks.filter((task) => task.isCompleted).reduce((sum, task) => sum + (Number(task.points) || 1), 0);
  return totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;
};

const normalizeTitle = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const normalizeTask = (task, taskTypeDefault = 'manual') => {
  const title = sanitizeBoundedText(task?.title, LIMITS.title, 'Task title', { required: true });
  const description = sanitizeBoundedText(task?.description || '', LIMITS.description, 'Task description');
  const pointsRaw = Number(task?.points);
  return {
    title,
    description,
    points: clamp(Number.isFinite(pointsRaw) ? pointsRaw : 3, 1, 10),
    priority: ['high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
    category: ['learning', 'project', 'practice'].includes(task?.category) ? task.category : 'learning',
    taskType: task?.taskType === 'ai' ? 'ai' : taskTypeDefault,
    startDate: task?.startDate ? startOfDay(parseDateOrNull(task.startDate)) : null,
    endDate: task?.endDate ? endOfDay(parseDateOrNull(task.endDate)) : null,
    isCompleted: Boolean(task?.isCompleted),
    sourceScenarioId: task?.sourceScenarioId || null,
    sourceScenarioHash: String(task?.sourceScenarioHash || '').trim().slice(0, 128)
  };
};

const dedupeTasks = (tasks = [], existingTitles = []) => {
  const seen = new Set(existingTitles.map((title) => normalizeTitle(title).toLowerCase()).filter(Boolean));
  const clean = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    let normalized;
    try {
      normalized = normalizeTask(task, task?.taskType === 'ai' ? 'ai' : 'manual');
    } catch {
      continue;
    }
    const key = normalized.title.toLowerCase();
    if (!normalized.title || seen.has(key)) continue;
    seen.add(key);
    clean.push(normalized);
  }

  return clean;
};

const buildSprintPayload = ({
  userId,
  title,
  weeklyGoal,
  tasks = [],
  goalStack,
  goalTechnology,
  goalTitle,
  goalExperienceLevel,
  sprintStartDate,
  sprintEndDate
}) => {
  const weekStart = startOfWeek();
  const weekEnd = endOfWeek(weekStart);
  const sprintStart = sprintStartDate ? startOfDay(parseDateOrNull(sprintStartDate)) : weekStart;
  const sprintEnd = sprintEndDate ? endOfDay(parseDateOrNull(sprintEndDate)) : weekEnd;
  assertDateRange(sprintStart, sprintEnd);

  if (Array.isArray(tasks) && tasks.length > LIMITS.tasksPerCreate) {
    throw createHttpError(413, 'Too many tasks in one request.');
  }

  return {
    userId,
    title: sanitizeBoundedText(title || 'Career Sprint', LIMITS.title, 'Sprint title') || 'Career Sprint',
    weeklyGoal: clamp(weeklyGoal || 5, 1, 20),
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    sprintStartDate: sprintStart,
    sprintEndDate: sprintEnd,
    goalStack: sanitizeBoundedText(goalStack || '', LIMITS.goalField, 'Goal stack'),
    goalTechnology: sanitizeBoundedText(goalTechnology || '', LIMITS.goalField, 'Goal technology'),
    goalTitle: sanitizeBoundedText(goalTitle || '', LIMITS.goalField, 'Goal title'),
    goalExperienceLevel: sanitizeBoundedText(goalExperienceLevel || '', LIMITS.goalField, 'Experience level'),
    tasks: dedupeTasks(tasks)
  };
};

const taskDueDate = (task) => {
  const candidate = task?.endDate || task?.deadline || task?.dueDate || null;
  return candidate ? new Date(candidate) : null;
};

const taskStartDate = (task) => {
  const candidate = task?.startDate || null;
  return candidate ? new Date(candidate) : null;
};

const buildDailyActivity = (sprint, days = 14) => {
  const today = startOfDay(new Date());
  const completedByDay = new Map();

  (sprint.tasks || [])
    .filter((task) => task.completedAt)
    .forEach((task) => {
      const key = startOfDay(new Date(task.completedAt)).toISOString().slice(0, 10);
      completedByDay.set(key, (completedByDay.get(key) || 0) + 1);
    });

  const calendar = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const key = date.toISOString().slice(0, 10);
    calendar.push({
      date,
      count: completedByDay.get(key) || 0,
      active: (completedByDay.get(key) || 0) > 0
    });
  }
  return calendar;
};

const buildRestoreMeta = (sprint) => {
  const broken = Boolean(sprint.streakBroken);
  const lastActive = sprint.lastActiveDate ? startOfDay(new Date(sprint.lastActiveDate)) : null;
  const missedDays = lastActive ? Math.max(0, daysBetween(lastActive, startOfDay(new Date())) - 1) : 0;
  const remainingRestoreDays = broken ? Math.max(0, MAX_RESTORE_DAYS - missedDays) : MAX_RESTORE_DAYS;

  return {
    canRestore: canRestore(sprint),
    remainingRestoreDays,
    reason: !broken
      ? 'Your streak is active.'
      : remainingRestoreDays > 0
        ? `Your streak broke after ${missedDays || 1} missed day${missedDays === 1 ? '' : 's'}. Restore is still available.`
        : 'The restore window has expired. Start a new streak today.'
  };
};

const buildInsights = ({ analytics, comparison, restoreMeta, signals }) => {
  const insights = [];

  if (analytics.progressPercent >= 85) {
    insights.push('Sprint execution is strong. You are close to clearing the current workload.');
  } else if (analytics.progressPercent >= 50) {
    insights.push('Progress is healthy, but there is still room to close remaining work faster.');
  } else {
    insights.push('Execution is still early. Focus on completing one high-value task today to build momentum.');
  }

  if (analytics.consistencyScore >= 75) {
    insights.push('Consistency is a strength right now. Your recent task completion pattern is stable.');
  } else if (analytics.consistencyScore < 45) {
    insights.push('Consistency is slipping. Smaller daily tasks or tighter task scope would improve follow-through.');
  }

  if (analytics.overdueTasks > 0) {
    insights.push(`There ${analytics.overdueTasks === 1 ? 'is' : 'are'} ${analytics.overdueTasks} overdue task${analytics.overdueTasks === 1 ? '' : 's'} affecting momentum.`);
  }

  if (comparison.progressDelta > 0) {
    insights.push(`Week-over-week progress improved by ${comparison.progressDelta} points compared with the previous sprint.`);
  } else if (comparison.progressDelta < 0) {
    insights.push(`Week-over-week progress is down by ${Math.abs(comparison.progressDelta)} points, so this sprint likely needs a narrower focus.`);
  }

  if (restoreMeta.canRestore) {
    insights.push(`Your streak can still be restored within ${restoreMeta.remainingRestoreDays} day${restoreMeta.remainingRestoreDays === 1 ? '' : 's'}.`);
  }

  if (signals?.careerSprint?.activeLearningFocus) {
    insights.push(`Current learning focus signal: ${signals.careerSprint.activeLearningFocus}.`);
  }

  return insights.slice(0, 6);
};

const serializeSprint = async (sprintDoc, options = {}) => {
  const sprint = typeof sprintDoc.toObject === 'function' ? sprintDoc.toObject() : { ...sprintDoc };
  const tasks = Array.isArray(sprint.tasks) ? sprint.tasks : [];
  const previousSprint = options.previousSprint || null;
  const signals = Object.prototype.hasOwnProperty.call(options, 'signals')
    ? (options.signals || {})
    : await getDeveloperSignals(sprint.userId);
  const totalPoints = tasks.reduce((sum, task) => sum + (Number(task.points) || 1), 0);
  const completedTasks = tasks.filter((task) => task.isCompleted);
  const completedPoints = completedTasks.reduce((sum, task) => sum + (Number(task.points) || 1), 0);
  const overdueTasks = tasks.filter((task) => !task.isCompleted && taskDueDate(task) && taskDueDate(task) < new Date()).length;
  const progressPercent = calcWeightedProgress(tasks);
  const currentStreak = Number(sprint.currentStreak || sprint.streak || 0);
  const activeWindowDays = sprint.sprintStartDate && sprint.sprintEndDate
    ? Math.max(1, daysBetween(startOfDay(sprint.sprintStartDate), startOfDay(sprint.sprintEndDate)) + 1)
    : 7;
  const completedInLastSevenDays = buildDailyActivity(sprint, 7).reduce((sum, day) => sum + day.count, 0);
  const consistencyScore = clamp((progressPercent * 0.62) + (Math.min(currentStreak, 14) / 14 * 23) + (Math.min(completedInLastSevenDays, 10) * 1.5));
  const productivityScore = clamp((completedPoints * 4) + (completedTasks.length * 5) - (overdueTasks * 6), 0, 100);
  const previousProgress = previousSprint ? calcWeightedProgress(previousSprint.tasks || []) : 0;
  const previousCompleted = previousSprint ? (previousSprint.tasks || []).filter((task) => task.isCompleted).length : 0;
  const previousXp = Number(previousSprint?.xpPoints || 0);
  const restoreMeta = buildRestoreMeta(sprint);

  sprint._canRestore = restoreMeta.canRestore;
  sprint.analytics = {
    totalTasks: tasks.length,
    completedTasks: completedTasks.length,
    pendingTasks: Math.max(0, tasks.length - completedTasks.length),
    overdueTasks,
    totalPoints,
    completedPoints,
    progressPercent,
    consistencyScore,
    productivityScore,
    activeWindowDays,
    aiTaskCount: tasks.filter((task) => task.taskType === 'ai').length,
    manualTaskCount: tasks.filter((task) => task.taskType !== 'ai').length,
    completedInLastSevenDays,
    dailyActivity: buildDailyActivity(sprint, 14)
  };
  sprint.comparison = {
    progressDelta: progressPercent - previousProgress,
    completedTasksDelta: completedTasks.length - previousCompleted,
    streakDelta: currentStreak - Number(previousSprint?.currentStreak || previousSprint?.streak || 0),
    xpDelta: Number(sprint.xpPoints || 0) - previousXp
  };
  sprint.restoreMeta = restoreMeta;
  sprint.signalsUsed = {
    careerSprint: {
      consistencyScore: Number(signals?.careerSprintSignal?.consistencyScore || consistencyScore),
      activeLearningFocus: String(signals?.careerSprintSignal?.activeLearningFocus || sprint.goalTechnology || sprint.goalStack || '').trim(),
      streak: Number(signals?.careerSprintSignal?.streak || currentStreak)
    },
    weeklyReport: {
      status: String(signals?.weeklyReportSignal?.status || 'Unavailable'),
      weeklyProgressScore: Number(signals?.weeklyReportSignal?.weeklyProgressScore || 0),
      repeatedWeakAreas: signals?.weeklyReportSignal?.repeatedWeakAreas || []
    },
    portfolio: {
      completenessScore: Number(signals?.portfolioSignal?.completenessScore || 0),
      projectPresentationQuality: Number(signals?.portfolioSignal?.projectPresentationQuality || 0)
    },
    integrations: {
      usedProviders: signals?.integrationSignal?.usedProviders || [],
      strongestProof: signals?.integrationSignal?.strongestProof || []
    }
  };
  sprint.insights = buildInsights({
    analytics: sprint.analytics,
    comparison: sprint.comparison,
    restoreMeta,
    signals: sprint.signalsUsed
  });

  // Normalize ids to stable strings so cache clones and API clients never see ObjectId artifacts.
  sprint._id = sprint._id != null ? String(sprint._id) : sprint._id;
  sprint.userId = sprint.userId != null ? String(sprint.userId) : sprint.userId;
  sprint.tasks = tasks.map((task) => ({
    ...task,
    _id: task?._id != null ? String(task._id) : task?._id
  }));
  if (Array.isArray(sprint.aiPlans)) {
    sprint.aiPlans = sprint.aiPlans.map((plan) => ({
      ...plan,
      _id: plan?._id != null ? String(plan._id) : plan?._id
    }));
  }

  return sprint;
};

const createSprint = async (opts) => {
  const payload = buildSprintPayload(opts);
  const sprint = await CareerSprint.create(payload);
  invalidateCareerSprintCache(opts.userId);
  return serializeSprint(sprint);
};

const findPreviousSprint = async (userId, sprint) => {
  const pivotDate = sprint.weekStartDate || sprint.createdAt || new Date();
  return CareerSprint.findOne({
    userId,
    _id: { $ne: sprint._id },
    weekStartDate: { $lt: pivotDate }
  })
    .select('tasks xpPoints currentStreak streak weekStartDate')
    .sort({ weekStartDate: -1 })
    .lean();
};

const loadCurrentSprint = async (userId, timer = createStageTimer()) => {
  const now = new Date();
  const weekStart = startOfWeek();
  const weekEnd = endOfWeek(weekStart);
  runtimeCounters.mongoHits += 1;

  let sprint = await timer.measure('Mongo', () => CareerSprint.findOne({
    userId,
    sprintStartDate: { $lte: now },
    sprintEndDate: { $gte: now }
  }).sort({ updatedAt: -1 }).lean());

  if (!sprint) {
    sprint = await timer.measure('Mongo', () => CareerSprint.findOne({
      userId,
      weekStartDate: { $lte: now },
      weekEndDate: { $gte: now }
    }).sort({ updatedAt: -1 }).lean());
  }

  if (!sprint) {
    try {
      const created = await timer.measure('persistence', async () => {
        runtimeCounters.persistenceOperations += 1;
        return CareerSprint.findOneAndUpdate(
          { userId, weekStartDate: weekStart, weekEndDate: weekEnd },
          {
            $setOnInsert: {
              ...buildSprintPayload({ userId }),
              weekStartDate: weekStart,
              weekEndDate: weekEnd
            }
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, lean: true }
        );
      });
      sprint = created;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      sprint = await timer.measure('Mongo', () => CareerSprint.findOne({
        userId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd
      }).sort({ updatedAt: -1 }).lean());
    }
  }

  if (!sprint) {
    throw createHttpError(500, 'Failed to load career sprint.');
  }

  const mutable = { ...sprint };
  const { changed } = checkInactivity(mutable);
  if (changed) {
    await timer.measure('persistence', async () => {
      runtimeCounters.persistenceOperations += 1;
      await CareerSprint.updateOne(
        { _id: sprint._id, userId },
        {
          $set: {
            longestStreak: mutable.longestStreak,
            streakBroken: mutable.streakBroken,
            streakBrokenAt: mutable.streakBrokenAt,
            streakWarning: mutable.streakWarning,
            streakStatus: mutable.streakStatus,
            currentStreak: mutable.currentStreak,
            streak: mutable.streak
          }
        }
      );
    });
    sprint = mutable;
  }

  const [previousSprint, signals] = await Promise.all([
    timer.measure('Mongo', () => findPreviousSprint(userId, sprint)),
    timer.measure('external provider', async () => {
      runtimeCounters.signalCalls += 1;
      return getDeveloperSignals(userId);
    })
  ]);

  return timer.measure('deterministic processing', () => serializeSprint(sprint, { previousSprint, signals }));
};

const getCurrentSprint = async (userId, { forceRefresh = false } = {}) => {
  const timer = createStageTimer();
  const key = memoryOverviewKey(userId);
  const cached = sprintOverviewCache.get(key);

  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    runtimeCounters.memoryHits += 1;
    await timer.measure('cache', async () => cached.value);
    return timer.attach(cloneCached(cached.value));
  }

  if (!forceRefresh && sprintOverviewInflight.has(key)) {
    return sprintOverviewInflight.get(key);
  }

  const epoch = sprintCacheEpoch.get(key) || 0;
  const previousValid = cached?.value || null;

  const request = (async () => {
    if (!forceRefresh) {
      const redisHit = await timer.measure('Redis', () => withBudget(
        aiService.getSharedCache(overviewIdentityKey(userId), OVERVIEW_REDIS_NAMESPACE),
        SPRINT_REDIS_BUDGET_MS,
        null
      ));
      if (isPersistableOverview(redisHit)) {
        runtimeCounters.redisHits += 1;
        setBoundedCache(sprintOverviewCache, key, {
          value: cloneCached(redisHit),
          expiresAt: Date.now() + SPRINT_CACHE_TTL_MS
        });
        return timer.attach(cloneCached(redisHit));
      }
    }

    runtimeCounters.pipelineExecutions += 1;
    try {
      const value = await loadCurrentSprint(userId, timer);
      if ((sprintCacheEpoch.get(key) || 0) === epoch && isPersistableOverview(value)) {
        const cacheable = stripTimingMetadata(value);
        setBoundedCache(sprintOverviewCache, key, {
          value: cloneCached(cacheable),
          expiresAt: Date.now() + SPRINT_CACHE_TTL_MS
        });
        persistOverviewAsync(userId, cacheable);
      }
      return timer.attach(value);
    } catch (error) {
      if (forceRefresh && previousValid) return timer.attach(cloneCached(previousValid));
      throw error;
    }
  })();

  request.finally(() => {
    if (sprintOverviewInflight.get(key) === request) sprintOverviewInflight.delete(key);
  });

  if (!forceRefresh) sprintOverviewInflight.set(key, request);
  return request;
};

const assertUniqueTask = (sprint, title) => {
  const normalizedTitle = normalizeTitle(title).toLowerCase();
  const duplicate = (sprint.tasks || []).some((task) => normalizeTitle(task.title).toLowerCase() === normalizedTitle);
  if (duplicate) {
    const error = new Error('A task with this title already exists in the sprint.');
    error.statusCode = 400;
    throw error;
  }
};

const toggleTaskCompletion = async (userId, sprintId, taskId, isCompleted) => {
  assertObjectId(sprintId, 'Sprint');
  assertObjectId(taskId, 'Task');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const task = sprint.tasks.id(taskId);
  if (!task) return null;

  const nextCompleted = Boolean(isCompleted);
  const wasCompleted = Boolean(task.isCompleted);
  if (nextCompleted === wasCompleted) {
    const previousSprint = await findPreviousSprint(userId, sprint);
    return serializeSprint(sprint, { previousSprint, signals: null });
  }

  task.isCompleted = nextCompleted;
  task.completedAt = nextCompleted ? new Date() : null;

  if (nextCompleted && !wasCompleted) {
    sprint.xpPoints = Number(sprint.xpPoints || 0) + xpForTask(task);
    recordActivity(sprint);
  } else if (!nextCompleted && wasCompleted) {
    sprint.xpPoints = Math.max(0, Number(sprint.xpPoints || 0) - xpForTask(task));
  }

  sprint.level = levelFromXp(sprint.xpPoints);
  await sprint.save();
  invalidateCareerSprintCache(userId);

  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const addTaskToSprint = async (userId, sprintId, task) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const normalized = normalizeTask(task);
  assertUniqueTask(sprint, normalized.title);
  sprint.tasks.push(normalized);
  await sprint.save();
  invalidateCareerSprintCache(userId);

  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const restoreStreak = async (userId, sprintId) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const restored = restoreStreakFn(sprint);
  if (!restored) return null;

  await sprint.save();
  invalidateCareerSprintCache(userId);
  const [previousSprint, signals] = await Promise.all([
    findPreviousSprint(userId, sprint),
    getDeveloperSignals(userId)
  ]);

  return serializeSprint(sprint, { previousSprint, signals });
};

const updateSprintDates = async (userId, sprintId, sprintStartDate, sprintEndDate) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const nextStart = sprintStartDate ? startOfDay(parseDateOrNull(sprintStartDate)) : sprint.sprintStartDate;
  const nextEnd = sprintEndDate ? endOfDay(parseDateOrNull(sprintEndDate)) : sprint.sprintEndDate;
  assertDateRange(nextStart, nextEnd);

  if (sprintStartDate) sprint.sprintStartDate = nextStart;
  if (sprintEndDate) sprint.sprintEndDate = nextEnd;
  await sprint.save();
  invalidateCareerSprintCache(userId);

  const [previousSprint, signals] = await Promise.all([
    findPreviousSprint(userId, sprint),
    getDeveloperSignals(userId)
  ]);

  return serializeSprint(sprint, { previousSprint, signals });
};

const summarizeHistoryItem = (sprint) => {
  const tasks = sprint.tasks || [];
  const progressPercent = calcWeightedProgress(tasks);
  const completedTasks = tasks.filter((task) => task.isCompleted).length;
  const overdueTasks = tasks.filter((task) => !task.isCompleted && taskDueDate(task) && taskDueDate(task) < new Date()).length;

  return {
    ...sprint,
    summary: {
      progressPercent,
      completedTasks,
      totalTasks: tasks.length,
      overdueTasks,
      consistencyScore: clamp((progressPercent * 0.65) + (Math.min(Number(sprint.currentStreak || sprint.streak || 0), 10) * 3.5))
    }
  };
};

const getSprintHistory = async (userId, limit = 6) => {
  const history = await CareerSprint.find({ userId })
    .sort({ weekStartDate: -1 })
    .limit(clamp(limit, 1, 12))
    .lean();

  return history.map(summarizeHistoryItem);
};

const saveAiPlanToSprint = async (userId, sprintId, payload = {}) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  if (Array.isArray(payload.tasks) && payload.tasks.length > LIMITS.tasksPerPlan) {
    throw createHttpError(413, 'AI plan has too many tasks.');
  }

  const tasks = dedupeTasks(payload.tasks || []);
  if (!tasks.length) {
    throw createHttpError(400, 'AI plan must include at least one valid task.');
  }

  const plan = {
    name: sanitizeBoundedText(payload.name || 'AI Sprint Plan', LIMITS.planName, 'Plan name') || 'AI Sprint Plan',
    source: payload.source === 'scenario' ? 'scenario' : 'ai',
    generatorType: payload.source === 'scenario'
      ? 'scenario'
      : (payload.generatorType === 'llm' ? 'llm' : 'deterministic'),
    goalStack: sanitizeBoundedText(payload.goalStack || sprint.goalStack || '', LIMITS.goalField, 'Goal stack'),
    goalTechnology: sanitizeBoundedText(payload.goalTechnology || sprint.goalTechnology || '', LIMITS.goalField, 'Goal technology'),
    goalExperienceLevel: sanitizeBoundedText(payload.goalExperienceLevel || sprint.goalExperienceLevel || '', LIMITS.goalField, 'Experience level'),
    summary: sanitizeBoundedText(payload.summary || '', LIMITS.summary, 'Plan summary'),
    confidenceScore: clamp(Number.isFinite(Number(payload.confidenceScore)) ? Number(payload.confidenceScore) : 0),
    consistencyScore: clamp(Number.isFinite(Number(payload.consistencyScore)) ? Number(payload.consistencyScore) : 0),
    signalsUsed: Array.isArray(payload.signalsUsed)
      ? payload.signalsUsed
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, LIMITS.signalsUsed)
      : [],
    tasks
  };

  sprint.aiPlans = [...(sprint.aiPlans || []).filter((item) => normalizeTitle(item.name).toLowerCase() !== plan.name.toLowerCase()), plan].slice(-8);
  await sprint.save();
  invalidateCareerSprintCache(userId);

  const [previousSprint, signals] = await Promise.all([
    findPreviousSprint(userId, sprint),
    getDeveloperSignals(userId)
  ]);

  return serializeSprint(sprint, { previousSprint, signals });
};

const buildScenarioTasks = (scenario) => {
  const sourceFields = {
    sourceScenarioId: scenario?._id || null,
    sourceScenarioHash: scenario?.scenarioHash || scenario?.result?.scenarioHash || ''
  };
  const skillTasks = (scenario?.skills || []).slice(0, 4).map((skill, index) => ({
    title: `Learn ${skill}`,
    description: `Scenario Simulator suggests building momentum in ${skill} for your target role. Keep this task focused and measurable.`,
    points: index < 2 ? 5 : 4,
    priority: index === 0 ? 'high' : 'medium',
    category: 'learning',
    taskType: 'ai',
    ...sourceFields
  }));

  const projectTasks = (scenario?.projects || []).slice(0, 2).map((project) => ({
    title: `Build ${project.name}`,
    description: `Scenario Simulator converted this project into sprint execution work. Complexity: ${project.complexity}, planned duration: ${project.weeks} weeks.`,
    points: project.complexity === 'high' ? 6 : project.complexity === 'medium' ? 5 : 4,
    priority: project.impact >= 80 ? 'high' : 'medium',
    category: 'project',
    taskType: 'ai',
    ...sourceFields
  }));

  return dedupeTasks([...skillTasks, ...projectTasks]).slice(0, 6);
};

const importScenarioPlanToSprint = async (userId, sprintId, scenarioId = '') => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  if (scenarioId) assertObjectId(scenarioId, 'Scenario');

  const scenario = scenarioId
    ? await ScenarioSimulation.findOne({ _id: scenarioId, userId }).lean()
    : await ScenarioSimulation.findOne({ userId }).sort({ createdAt: -1 }).lean();

  if (!scenario) {
    throw createHttpError(404, 'No saved scenario is available to import.');
  }

  const tasks = buildScenarioTasks(scenario);
  if (!tasks.length) {
    throw createHttpError(400, 'The selected scenario does not include enough actionable items.');
  }

  return saveAiPlanToSprint(userId, sprintId, {
    name: scenario.name || 'Scenario Simulator Plan',
    source: 'scenario',
    generatorType: 'scenario',
    goalStack: scenario.role || sprint.goalStack,
    goalTechnology: (scenario.skills || []).slice(0, 2).join(', '),
    goalExperienceLevel: scenario.experienceLevel || sprint.goalExperienceLevel,
    summary: 'Imported from Scenario Simulator as a draft sprint plan.',
    confidenceScore: Number.isFinite(Number(scenario.confidenceScore ?? scenario.result?.confidenceScore))
      ? Number(scenario.confidenceScore ?? scenario.result?.confidenceScore)
      : 0,
    consistencyScore: clamp((Number(scenario.improvements?.hiringScore) || 0) * 2.4, 0, 100),
    signalsUsed: ['Scenario Simulator'],
    tasks
  });
};

module.exports = {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint,
  restoreStreak,
  updateSprintDates,
  getSprintHistory,
  saveAiPlanToSprint,
  importScenarioPlanToSprint,
  serializeSprint,
  calcWeightedProgress,
  xpForTask,
  levelFromXp,
  invalidateCareerSprintCache,
  clearCareerSprintMemoryCache,
  getCareerSprintRuntimeCounters,
  resetCareerSprintRuntimeCounters,
  assertObjectId,
  sanitizeBoundedText,
  LIMITS,
  CAREER_SPRINT_OVERVIEW_VERSION,
  SPRINT_REDIS_BUDGET_MS,
  STAGE_TIMINGS_ENABLED
};
