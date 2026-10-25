const sprintProgressScore = require('./scoring/sprintProgressScore');
const { clampScore: clamp } = require('./scoring/math');
const CareerSprint = require('../models/careerSprint');
const ScenarioSimulation = require('../models/scenarioSimulation');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { getDeveloperSignals } = require('./developerSignalService');
const {
  recordActivity,
  checkInactivity,
  restoreStreak: restoreStreakFn,
  canRestore,
  MAX_RESTORE_DAYS,
  activityAnchor,
} = require('./streakService');
const { startOfDay, endOfDay, addDays, daysBetween } = require('../utils/dateUtils');

const overviewCache = require('./sprintOverviewCacheService');
const { POLICY, calendar, sprintWindow } = require('../utils/sprintCalendar');
const preferences = require('./sprintPreferenceService');
const reservations = require('./sprintReservationService');
const draftContext = require('./sprintDraftContextService');
const provenance = require('./sprintTaskProvenanceService');
const legacyPolicy = require('./sprintLegacyPolicy');
const CAREER_SPRINT_OVERVIEW_VERSION = 'overview_v4';
const SPRINT_REDIS_BUDGET_MS = 120;
const STAGE_TIMINGS_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.CAREER_SPRINT_STAGE_TIMINGS === '1';
const runtimeCounters = {
  pipelineExecutions: 0,
  memoryHits: 0,
  redisHits: 0,
  mongoHits: 0,
  signalCalls: 0,
  persistenceOperations: 0,
  redisWrites: 0,
};
const createStageTimer = () => {
  const start = performance.now();
  const stages = {};
  return {
    async measure(name, work) {
      const at = performance.now();
      try {
        return await work();
      } finally {
        stages[name] = (stages[name] || 0) + performance.now() - at;
      }
    },
    attach(value) {
      return STAGE_TIMINGS_ENABLED
        ? {
            ...value,
            cacheMetadata: {
              authoritativeSource: 'MongoDB',
              stageTimingsMs: { ...stages, total: performance.now() - start },
              requestCounters: { ...runtimeCounters },
            },
          }
        : value;
    },
  };
};
const invalidateCareerSprintCache = (userId) => overviewCache.invalidate(userId);
const clearCareerSprintMemoryCache = () => overviewCache.clear();
const getCareerSprintRuntimeCounters = () => ({ ...runtimeCounters });
const resetCareerSprintRuntimeCounters = () => {
  for (const key of Object.keys(runtimeCounters)) runtimeCounters[key] = 0;
};

const LIMITS = {
  title: 120,
  description: 1000,
  goalField: 80,
  planName: 120,
  summary: 500,
  signalsUsed: 12,
  tasksPerPlan: 20,
  tasksPerCreate: 30,
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
  if (value != null && typeof value !== 'string') throw createHttpError(400, `${field} must be text.`);
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (required && !text) throw createHttpError(400, `${field} is required.`);
  if (text.length > max) throw createHttpError(413, `${field} is too large.`);
  return text;
};

const parseDateOrNull = (value) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date))
    throw createHttpError(400, 'Invalid date value.');
  let parsed = new Date(value);
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
    if (!match) throw createHttpError(400, 'Invalid date value.');
    const [, year, month, day] = match.map(Number);
    const calendar = new Date(year, month - 1, day);
    if (calendar.getFullYear() !== year || calendar.getMonth() !== month - 1 || calendar.getDate() !== day)
      throw createHttpError(400, 'Invalid date value.');
    if (value.length === 10) parsed = calendar;
  }
  if (Number.isNaN(parsed.getTime())) throw createHttpError(400, 'Invalid date value.');
  return parsed;
};

const assertDateRange = (start, end) => {
  if (start && end && new Date(start).getTime() > new Date(end).getTime()) {
    throw createHttpError(400, 'Sprint end date must be on or after the start date.');
  }
};

const occupiedCalendarDays = (start, end) => {
  assertDateRange(start, end);
  const count = daysBetween(start, end) + 1;
  if (count > 366) throw createHttpError(400, 'Sprint windows cannot exceed 366 days.');
  return Array.from({ length: count }, (_, offset) => {
    const date = addDays(startOfDay(start), offset);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  });
};

const POINTS_TO_XP = { high: 15, medium: 10, low: 5 };

const xpForTask = (task) => {
  const base = POINTS_TO_XP[task.priority] || 10;
  const points = Number(task.points || 0);
  return base + (Number.isFinite(points) ? points : 0);
};

const levelFromXp = (xp) => {
  const total = Number(xp || 0);
  return Math.max(1, Math.floor((Number.isFinite(total) ? total : 0) / 100) + 1);
};

const calcWeightedProgress = (tasks) => sprintProgressScore.calculate(tasks).score ?? 0;

const normalizeTitle = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeTask = (task, taskTypeDefault = 'manual', trustedSource = false, calendarOwner = {}) => {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw createHttpError(400, 'Task must be an object.');
  }
  const title = sanitizeBoundedText(task?.title, LIMITS.title, 'Task title', { required: true });
  const description = sanitizeBoundedText(task?.description || '', LIMITS.description, 'Task description');
  const defaults = { learning: 3, project: 5, practice: 4 };
  for (const [field, allowed] of Object.entries({
    category: Object.keys(defaults),
    priority: ['high', 'medium', 'low'],
    taskType: ['ai', 'manual'],
  })) {
    if (task[field] !== undefined && !allowed.includes(task[field])) {
      throw createHttpError(400, `Invalid task ${field}.`);
    }
  }
  const pointsRaw = task.points === undefined ? defaults[task.category || 'learning'] : task.points;
  if (typeof pointsRaw !== 'number' || !Number.isFinite(pointsRaw) || pointsRaw < 1 || pointsRaw > 10) {
    throw createHttpError(400, 'Task points must be between 1 and 10.');
  }
  if (task.isCompleted !== undefined && task.isCompleted !== false) {
    throw createHttpError(400, 'Complete tasks through the completion action.');
  }
  const c = calendar(calendarOwner);
  const startDate = task.startDate
    ? c.start(calendarOwner.calendarPolicy ? task.startDate : parseDateOrNull(task.startDate))
    : null;
  const endDate = task.endDate
    ? c.end(calendarOwner.calendarPolicy ? task.endDate : parseDateOrNull(task.endDate))
    : null;
  assertDateRange(startDate, endDate);
  return {
    title,
    description,
    points: pointsRaw,
    priority: ['high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
    category: ['learning', 'project', 'practice'].includes(task?.category) ? task.category : 'learning',
    taskType: task?.taskType === 'ai' ? 'ai' : taskTypeDefault,
    startDate,
    endDate,
    isCompleted: false,
    ...(trustedSource
      ? {
          sourceScenarioId: task.sourceScenarioId || null,
          sourceScenarioHash: String(task.sourceScenarioHash || '').slice(0, 128),
          sourceScenarioItemKey: String(task.sourceScenarioItemKey || '').slice(0, 64),
          sourceCourseId: task.sourceCourseId || null,
          sourceCourseSkill: task.sourceCourseSkill || null,
          ...Object.fromEntries(provenance.fields.filter((key) => task[key]).map((key) => [key, task[key]])),
        }
      : {}),
  };
};

const dedupeTasks = (tasks = [], existingTitles = [], trustedSource = false, calendarOwner = {}) => {
  const seen = new Set(existingTitles.map((title) => normalizeTitle(title).toLowerCase()).filter(Boolean));
  const clean = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const normalized = normalizeTask(
      task,
      task?.taskType === 'ai' ? 'ai' : 'manual',
      trustedSource,
      calendarOwner,
    );
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
  sprintEndDate,
  timeZone = 'UTC',
}) => {
  const pinned = sprintWindow(timeZone, sprintStartDate, sprintEndDate);
  const sprintStart = pinned.sprintStartDate;
  const sprintEnd = pinned.sprintEndDate;

  if (Array.isArray(tasks) && tasks.length > LIMITS.tasksPerCreate) {
    throw createHttpError(413, 'Too many tasks in one request.');
  }
  if (!Array.isArray(tasks)) throw createHttpError(400, 'Tasks must be an array.');

  return {
    userId,
    title: sanitizeBoundedText(title || 'Career Sprint', LIMITS.title, 'Sprint title') || 'Career Sprint',
    weeklyGoal: clamp(weeklyGoal || 5, 1, 20),
    weekStartDate: sprintStart,
    weekEndDate: sprintEnd,
    sprintStartDate: sprintStart,
    sprintEndDate: sprintEnd,
    creationKey: `${sprintStart.toISOString()}:${sprintEnd.toISOString()}`,
    ...pinned,
    tzdbVersion: process.versions.tz || 'runtime-icu',
    goalStack: sanitizeBoundedText(goalStack || '', LIMITS.goalField, 'Goal stack'),
    goalTechnology: sanitizeBoundedText(goalTechnology || '', LIMITS.goalField, 'Goal technology'),
    goalTitle: sanitizeBoundedText(goalTitle || '', LIMITS.goalField, 'Goal title'),
    goalExperienceLevel: sanitizeBoundedText(goalExperienceLevel || '', LIMITS.goalField, 'Experience level'),
    tasks: dedupeTasks(tasks, [], false, pinned),
  };
};

const taskDueDate = (task) => {
  const candidate = task?.endDate || task?.deadline || task?.dueDate || null;
  return candidate ? new Date(candidate) : null;
};

const buildDailyActivity = (sprint, days = 14) => {
  const c = calendar(sprint);
  const today = c.start(new Date());
  const completedByDay = new Map();

  (sprint.tasks || [])
    .filter((task) => task.isCompleted && task.completedAt)
    .forEach((task) => {
      const key = c.key(task.completedAt);
      completedByDay.set(key, (completedByDay.get(key) || 0) + 1);
    });

  const activity = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = c.add(today, -offset);
    const key = c.key(date);
    activity.push({
      date,
      count: completedByDay.get(key) || 0,
      active: (completedByDay.get(key) || 0) > 0,
    });
  }
  return activity;
};

const buildRestoreMeta = (sprint) => {
  if (sprint.calendarPolicy === POLICY) {
    const state = require('./sprintStreakPolicy').restoreState(sprint);
    return {
      ...state,
      remainingRestoreDays: Math.ceil(state.remainingRestoreMs / 86400000),
      reason: state.canRestore
        ? 'Restore is available until the exclusive expiry instant.'
        : 'Restore is not available.',
    };
  }
  const broken = Boolean(sprint.streakBroken);
  const lastActive = activityAnchor(sprint);
  const missedDays = lastActive ? Math.max(0, daysBetween(lastActive, startOfDay(new Date())) - 1) : 0;
  const remainingRestoreDays = broken ? Math.max(0, MAX_RESTORE_DAYS - missedDays + 1) : MAX_RESTORE_DAYS;

  return {
    canRestore: canRestore(sprint),
    policy: 'legacy-missed-days-v1',
    remainingRestoreDays,
    reason: !broken
      ? 'Your streak is active.'
      : remainingRestoreDays > 0
        ? `Your streak broke after ${missedDays || 1} missed day${missedDays === 1 ? '' : 's'}. Restore is still available.`
        : 'The restore window has expired. Start a new streak today.',
  };
};

const buildInsights = ({ analytics, comparison, restoreMeta, signals }) => {
  const insights = [];

  if (analytics.progressPercent >= 85) {
    insights.push('Sprint execution is strong. You are close to clearing the current workload.');
  } else if (analytics.progressPercent >= 50) {
    insights.push('Progress is healthy, but there is still room to close remaining work faster.');
  } else {
    insights.push(
      'Execution is still early. Focus on completing one high-value task today to build momentum.',
    );
  }

  if (analytics.consistencyScore >= 75) {
    insights.push('Consistency is a strength right now. Your recent task completion pattern is stable.');
  } else if (analytics.consistencyScore !== null && analytics.consistencyScore < 45) {
    insights.push(
      'Consistency is slipping. Smaller daily tasks or tighter task scope would improve follow-through.',
    );
  }

  if (analytics.overdueTasks > 0) {
    insights.push(
      `There ${analytics.overdueTasks === 1 ? 'is' : 'are'} ${analytics.overdueTasks} overdue task${analytics.overdueTasks === 1 ? '' : 's'} affecting momentum.`,
    );
  }

  if (comparison.progressDelta > 0) {
    insights.push(
      `Week-over-week progress improved by ${comparison.progressDelta} points compared with the previous sprint.`,
    );
  } else if (comparison.progressDelta < 0) {
    insights.push(
      `Week-over-week progress is down by ${Math.abs(comparison.progressDelta)} points, so this sprint likely needs a narrower focus.`,
    );
  }

  if (restoreMeta.canRestore) {
    insights.push(
      `Your streak can still be restored within ${restoreMeta.remainingRestoreDays} day${restoreMeta.remainingRestoreDays === 1 ? '' : 's'}.`,
    );
  }

  if (signals?.careerSprint?.activeLearningFocus) {
    insights.push(`Current learning focus signal: ${signals.careerSprint.activeLearningFocus}.`);
  }

  return insights.slice(0, 6);
};

const serializeSprint = async (sprintDoc, options = {}) => {
  const sprint = typeof sprintDoc.toObject === 'function' ? sprintDoc.toObject() : { ...sprintDoc };
  const tasks = Array.isArray(sprint.tasks) ? sprint.tasks : [];
  sprint.legacyAccess = legacyPolicy.access(sprint);
  const unresolved = sprint.legacyAccess.calendarStatus === 'provenance-unresolved';
  const previousSprint = options.previousSprint || null;
  const signals = Object.prototype.hasOwnProperty.call(options, 'signals')
    ? options.signals || {}
    : await getDeveloperSignals(sprint.userId);
  const totalPoints = tasks.reduce((sum, task) => sum + (Number(task.points) || 1), 0);
  const completedTasks = tasks.filter((task) => task.isCompleted);
  const completedPoints = completedTasks.reduce((sum, task) => sum + (Number(task.points) || 1), 0);
  const overdueTasks = tasks.filter(
    (task) => !task.isCompleted && taskDueDate(task) && taskDueDate(task) < new Date(),
  ).length;
  const progressPercent = calcWeightedProgress(tasks);
  const currentStreak = Number(sprint.currentStreak || sprint.streak || 0);
  const activeWindowDays = unresolved
    ? null
    : sprint.sprintStartDate && sprint.sprintEndDate
      ? Math.max(1, calendar(sprint).difference(sprint.sprintStartDate, sprint.sprintEndDate) + 1)
      : 7;
  const completedInLastSevenDays = unresolved
    ? null
    : buildDailyActivity(sprint, 7).reduce((sum, day) => sum + day.count, 0);
  const consistencyScore = unresolved
    ? null
    : clamp(
        progressPercent * 0.62 +
          (Math.min(currentStreak, 14) / 14) * 23 +
          Math.min(completedInLastSevenDays, 10) * 1.5,
      );
  const productivityScore = clamp(completedPoints * 4 + completedTasks.length * 5 - overdueTasks * 6, 0, 100);
  const previousProgress = previousSprint ? calcWeightedProgress(previousSprint.tasks || []) : 0;
  const previousCompleted = previousSprint
    ? (previousSprint.tasks || []).filter((task) => task.isCompleted).length
    : 0;
  const previousXp = Number(previousSprint?.xpPoints || 0);
  const restoreMeta = unresolved
    ? { policy: 'legacy-calendar-unresolved', canRestore: false, reason: sprint.legacyAccess.reason }
    : buildRestoreMeta(sprint);

  sprint._canRestore = !sprint.legacyAccess.readOnly && restoreMeta.canRestore;
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
    dailyActivity: unresolved ? [] : buildDailyActivity(sprint, 14),
  };
  sprint.comparison = {
    progressDelta: progressPercent - previousProgress,
    completedTasksDelta: completedTasks.length - previousCompleted,
    streakDelta: currentStreak - Number(previousSprint?.currentStreak || previousSprint?.streak || 0),
    xpDelta: Number(sprint.xpPoints || 0) - previousXp,
  };
  sprint.restoreMeta = sprint.legacyAccess.readOnly ? { ...restoreMeta, canRestore: false } : restoreMeta;
  sprint.signalsUsed = {
    careerSprint: {
      consistencyScore: unresolved
        ? null
        : Number(signals?.careerSprintSignal?.consistencyScore || consistencyScore),
      activeLearningFocus: String(
        signals?.careerSprintSignal?.activeLearningFocus || sprint.goalTechnology || sprint.goalStack || '',
      ).trim(),
      streak: Number(signals?.careerSprintSignal?.streak || currentStreak),
    },
    weeklyReport: {
      status: String(signals?.weeklyReportSignal?.status || 'Unavailable'),
      weeklyProgressScore: Number(signals?.weeklyReportSignal?.weeklyProgressScore || 0),
      repeatedWeakAreas: signals?.weeklyReportSignal?.repeatedWeakAreas || [],
    },
    portfolio: {
      completenessScore: Number(signals?.portfolioSignal?.completenessScore || 0),
      projectPresentationQuality: Number(signals?.portfolioSignal?.projectPresentationQuality || 0),
    },
    integrations: {
      usedProviders: signals?.integrationSignal?.usedProviders || [],
      strongestProof: signals?.integrationSignal?.strongestProof || [],
    },
  };
  sprint.insights = buildInsights({
    analytics: sprint.analytics,
    comparison: sprint.comparison,
    restoreMeta,
    signals: sprint.signalsUsed,
  });

  // Normalize ids to stable strings so cache clones and API clients never see ObjectId artifacts.
  sprint._id = sprint._id != null ? String(sprint._id) : sprint._id;
  sprint.userId = sprint.userId != null ? String(sprint.userId) : sprint.userId;
  sprint.tasks = tasks.map((task) => ({
    ...task,
    _id: task?._id != null ? String(task._id) : task?._id,
  }));
  if (Array.isArray(sprint.aiPlans)) {
    const context =
      options.draftContext ||
      (sprint.aiPlans.length ? await draftContext.currentContext(sprint.userId) : null);
    sprint.aiPlans = sprint.aiPlans.map((plan) => ({
      ...(context ? { compatibility: draftContext.compatibility(plan, context) } : {}),
      ...plan,
      _id: plan?._id != null ? String(plan._id) : plan?._id,
    }));
  }

  return sprint;
};

const createSprint = async (opts) => {
  const preference = await preferences.getPreference(opts.userId);
  const payload = buildSprintPayload({ ...opts, timeZone: preference.timeZone });
  payload._id = new mongoose.Types.ObjectId(
    crypto
      .createHash('sha256')
      .update(String(opts.userId) + payload.creationKey)
      .digest('hex')
      .slice(0, 24),
  );
  const existing = await CareerSprint.findOne({
    userId: opts.userId,
    $or: [
      { sprintStartDate: { $lte: payload.sprintEndDate }, sprintEndDate: { $gte: payload.sprintStartDate } },
      {
        sprintStartDate: null,
        weekStartDate: { $lte: payload.sprintEndDate },
        weekEndDate: { $gte: payload.sprintStartDate },
      },
    ],
  });
  if (existing) {
    if (
      +new Date(existing.sprintStartDate || existing.weekStartDate) === +payload.sprintStartDate &&
      +new Date(existing.sprintEndDate || existing.weekEndDate) === +payload.sprintEndDate
    ) {
      return serializeSprint(existing, { signals: null });
    }
    throw createHttpError(409, 'Sprint dates overlap an existing sprint.');
  }
  let sprint;
  const token = await reservations.reserve(
    opts.userId,
    payload._id,
    payload.sprintStartDate,
    payload.sprintEndDate,
  );
  payload.scheduleToken = token;
  try {
    sprint = await CareerSprint.create(payload);
  } catch (error) {
    sprint = await CareerSprint.findOne({ userId: opts.userId, creationKey: payload.creationKey });
    if (
      (sprint && sprint.scheduleToken !== token) ||
      (!sprint && (error.name === 'ValidationError' || error.name === 'CastError' || error.code === 11000))
    )
      await reservations.releaseSafely(opts.userId, token);
    if (!sprint) throw error;
  }
  invalidateCareerSprintCache(opts.userId);
  return serializeSprint(sprint, { signals: null });
};

const findPreviousSprint = async (userId, sprint) => {
  const pivotDate = sprint.sprintStartDate || sprint.weekStartDate || sprint.createdAt || new Date();
  return CareerSprint.findOne({
    userId,
    _id: { $ne: sprint._id },
    $or: [{ sprintEndDate: { $lt: pivotDate } }, { sprintEndDate: null, weekEndDate: { $lt: pivotDate } }],
  })
    .select('tasks xpPoints currentStreak streak weekStartDate')
    .sort({ sprintEndDate: -1, weekEndDate: -1 })
    .lean();
};

const loadCurrentSprint = async (userId, timer = createStageTimer(), forceRefresh = false) => {
  const now = new Date();
  const previousRequest = findPreviousSprint(userId, { sprintStartDate: now });
  previousRequest.catch(() => {});
  runtimeCounters.mongoHits += 1;

  let sprint = await timer.measure('Mongo', () =>
    CareerSprint.findOne({
      userId,
      sprintStartDate: { $lte: now },
      sprintEndDate: { $gte: now },
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean(),
  );

  if (!sprint) {
    sprint = await timer.measure('Mongo', () =>
      CareerSprint.findOne({
        userId,
        sprintStartDate: null,
        sprintEndDate: null,
        weekStartDate: { $lte: now },
        weekEndDate: { $gte: now },
      })
        .sort({ updatedAt: -1, _id: -1 })
        .lean(),
    );
  }

  if (!sprint) {
    const created = await createSprint({ userId });
    sprint = await CareerSprint.findOne({ _id: created._id, userId }).lean();
  }

  if (!sprint) {
    throw createHttpError(
      409,
      'An existing sprint conflicts with the default week. Choose a non-overlapping window.',
    );
  }

  const mutable = { ...sprint };
  const { changed } = legacyPolicy.access(sprint).readOnly ? { changed: false } : checkInactivity(mutable);
  if (changed) {
    await timer.measure('persistence', async () => {
      runtimeCounters.persistenceOperations += 1;
      const result = await CareerSprint.updateOne(
        { _id: sprint._id, userId, __v: sprint.__v, lastActiveDate: sprint.lastActiveDate },
        {
          $inc: { __v: 1 },
          $set: {
            longestStreak: mutable.longestStreak,
            streakBroken: mutable.streakBroken,
            streakBrokenAt: mutable.streakBrokenAt,
            streakWarning: mutable.streakWarning,
            streakStatus: mutable.streakStatus,
            currentStreak: mutable.currentStreak,
            streak: mutable.streak,
          },
        },
      );
      if (result.matchedCount === 0) {
        Object.assign(mutable, await CareerSprint.findOne({ _id: sprint._id, userId }).lean());
      }
    });
    sprint = mutable;
  }

  const previousSprint = await previousRequest;
  const context = sprint.aiPlans?.length ? await draftContext.currentContext(userId) : null;
  return overviewCache.load(
    sprint,
    previousSprint,
    async () => {
      runtimeCounters.signalCalls++;
      const signals = await getDeveloperSignals(userId).catch(() => ({}));
      return serializeSprint(sprint, { previousSprint, signals, draftContext: context });
    },
    runtimeCounters,
    forceRefresh,
    context,
  );
};

const getCurrentSprint = async (userId, { forceRefresh = false } = {}) => {
  const timer = createStageTimer();
  return timer.attach(await loadCurrentSprint(userId, timer, forceRefresh));
};

const assertUniqueTask = (sprint, title) => {
  const normalizedTitle = normalizeTitle(title).toLowerCase();
  const duplicate = (sprint.tasks || []).some(
    (task) => normalizeTitle(task.title).toLowerCase() === normalizedTitle,
  );
  if (duplicate) {
    const error = new Error('A task with this title already exists in the sprint.');
    error.statusCode = 400;
    throw error;
  }
};

const toggleTaskCompletion = async (userId, sprintId, taskId, isCompleted) => {
  if (typeof isCompleted !== 'boolean') throw createHttpError(400, 'isCompleted must be a boolean.');
  assertObjectId(sprintId, 'Sprint');
  assertObjectId(taskId, 'Task');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;
  legacyPolicy.assertWritable(sprint);

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
  legacyPolicy.assertWritable(sprint);

  const [normalized] = await provenance.attach(
    userId,
    [task],
    [normalizeTask(task, 'manual', false, sprint)],
  );
  const duplicate = (sprint.tasks || []).some(
    (item) =>
      normalizeTitle(item.title).toLowerCase() === normalized.title.toLowerCase() ||
      (normalized.sourceRecommendationId &&
        item.sourceRecommendationId === normalized.sourceRecommendationId),
  );
  if (duplicate) return serializeSprint(sprint, { signals: null });
  if (sprint.tasks.length >= 500) throw createHttpError(413, 'Sprint task limit reached.');
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
  legacyPolicy.assertWritable(sprint);

  const restored = restoreStreakFn(sprint);
  if (!restored) return null;

  await sprint.save();
  invalidateCareerSprintCache(userId);
  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const updateSprintDates = async (userId, sprintId, sprintStartDate, sprintEndDate) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;
  legacyPolicy.assertWritable(sprint);

  const nextStart = sprintStartDate
    ? calendar(sprint).start(sprint.calendarPolicy ? sprintStartDate : parseDateOrNull(sprintStartDate))
    : sprint.sprintStartDate || sprint.weekStartDate;
  const nextEnd = sprintEndDate
    ? calendar(sprint).end(sprint.calendarPolicy ? sprintEndDate : parseDateOrNull(sprintEndDate))
    : sprint.sprintEndDate || sprint.weekEndDate;
  assertDateRange(nextStart, nextEnd);
  const overlap = await CareerSprint.findOne({
    userId,
    _id: { $ne: sprintId },
    sprintStartDate: { $lte: nextEnd },
    sprintEndDate: { $gte: nextStart },
  }).lean();
  if (overlap) throw createHttpError(409, 'Sprint dates overlap an existing sprint.');

  if (sprintStartDate) sprint.sprintStartDate = nextStart;
  if (sprintEndDate) sprint.sprintEndDate = nextEnd;
  sprint.weekStartDate = nextStart;
  sprint.weekEndDate = nextEnd;
  sprint.creationKey = `${nextStart.toISOString()}:${nextEnd.toISOString()}`;
  sprint.occupiedDays =
    sprint.calendarPolicy === POLICY
      ? sprintWindow(sprint.timeZone, nextStart, nextEnd).occupiedDays
      : occupiedCalendarDays(nextStart, nextEnd);
  const oldToken = sprint.scheduleToken || `legacy:${sprintId}`;
  const token = await reservations.reserve(userId, sprintId, nextStart, nextEnd);
  sprint.scheduleToken = token;
  try {
    await sprint.save();
  } catch (error) {
    if (error.name === 'VersionError' || error.name === 'ValidationError' || error.code === 11000)
      await reservations.releaseSafely(userId, token);
    throw error;
  }
  await reservations.releaseSafely(userId, oldToken);
  invalidateCareerSprintCache(userId);

  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const summarizeHistoryItem = (sprint) => {
  const tasks = sprint.tasks || [];
  const progressPercent = calcWeightedProgress(tasks);
  const completedTasks = tasks.filter((task) => task.isCompleted).length;
  const overdueTasks = tasks.filter(
    (task) => !task.isCompleted && taskDueDate(task) && taskDueDate(task) < new Date(),
  ).length;

  return {
    ...sprint,
    summary: {
      progressPercent,
      completedTasks,
      totalTasks: tasks.length,
      overdueTasks,
      consistencyScore: clamp(
        progressPercent * 0.65 + Math.min(Number(sprint.currentStreak || sprint.streak || 0), 10) * 3.5,
      ),
    },
  };
};

const getSprintHistory = async (userId, limit = 6) => {
  const history = await CareerSprint.find({ userId })
    .sort({ weekStartDate: -1, _id: -1 })
    .limit(clamp(limit, 1, 12))
    .lean();

  const context = history.some((item) => item.aiPlans?.length)
    ? await draftContext.currentContext(userId)
    : null;
  return history.map((item) => ({
    ...summarizeHistoryItem(item),
    legacyAccess: legacyPolicy.access(item),
    aiPlans: (item.aiPlans || []).map((plan) => ({
      ...plan,
      ...(context ? { compatibility: draftContext.compatibility(plan, context) } : {}),
    })),
  }));
};

const saveAiPlanToSprint = async (userId, sprintId, payload = {}, trustedSource = false) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;
  legacyPolicy.assertWritable(sprint);

  if (Array.isArray(payload.tasks) && payload.tasks.length > LIMITS.tasksPerPlan) {
    throw createHttpError(413, 'AI plan has too many tasks.');
  }

  let tasks = dedupeTasks(payload.tasks || [], [], trustedSource, sprint);
  if (!trustedSource) tasks = await provenance.attach(userId, payload.tasks || [], tasks);
  if (!tasks.length) {
    throw createHttpError(400, 'AI plan must include at least one valid task.');
  }

  const context = await draftContext.currentContext(userId);
  const plan = {
    context,
    origin: trustedSource
      ? 'scenario'
      : payload.generatorType === 'llm'
        ? 'ai'
        : payload.origin === 'manual'
          ? 'manual'
          : 'deterministic',
    name:
      sanitizeBoundedText(payload.name || 'AI Sprint Plan', LIMITS.planName, 'Plan name') || 'AI Sprint Plan',
    source: payload.source === 'scenario' ? 'scenario' : 'ai',
    generatorType:
      payload.source === 'scenario' ? 'scenario' : payload.generatorType === 'llm' ? 'llm' : 'deterministic',
    goalStack: sanitizeBoundedText(
      payload.goalStack || sprint.goalStack || '',
      LIMITS.goalField,
      'Goal stack',
    ),
    goalTechnology: sanitizeBoundedText(
      payload.goalTechnology || sprint.goalTechnology || '',
      LIMITS.goalField,
      'Goal technology',
    ),
    goalExperienceLevel: sanitizeBoundedText(
      payload.goalExperienceLevel || sprint.goalExperienceLevel || '',
      LIMITS.goalField,
      'Experience level',
    ),
    summary: sanitizeBoundedText(payload.summary || '', LIMITS.summary, 'Plan summary'),
    confidenceScore: clamp(
      Number.isFinite(Number(payload.confidenceScore)) ? Number(payload.confidenceScore) : 0,
    ),
    consistencyScore: clamp(
      Number.isFinite(Number(payload.consistencyScore)) ? Number(payload.consistencyScore) : 0,
    ),
    signalsUsed: Array.isArray(payload.signalsUsed)
      ? payload.signalsUsed
          .map((item) => sanitizeBoundedText(item, 160, 'Signal label'))
          .filter(Boolean)
          .slice(0, LIMITS.signalsUsed)
      : [],
    tasks,
  };

  const sameName = (sprint.aiPlans || []).find(
    (item) => normalizeTitle(item.name).toLowerCase() === plan.name.toLowerCase(),
  );
  if (sameName) {
    const content = (items) =>
      items.map((task) => [
        task.title,
        task.description,
        task.points,
        task.priority,
        task.category,
        task.taskType,
        task.startDate || null,
        task.endDate || null,
        String(task.sourceScenarioId || ''),
        ...provenance.fields.map((key) => task[key] || ''),
      ]);
    const sameTasks = draftContext.digest(content(sameName.tasks)) === draftContext.digest(content(tasks));
    if (sameTasks) return serializeSprint(sprint, { signals: null, draftContext: context });
    throw createHttpError(
      409,
      'A different draft already uses this name. Preserve it or delete it explicitly.',
    );
  }
  if ((sprint.aiPlans || []).length >= 8)
    throw createHttpError(409, 'Eight saved drafts already exist. Delete a draft before saving another.');
  sprint.aiPlans.push(plan);
  await sprint.save();
  invalidateCareerSprintCache(userId);

  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const importScenarioPlanToSprint = async (userId, sprintId, scenarioId = '') => {
  assertObjectId(sprintId, 'Sprint');
  if (scenarioId) assertObjectId(scenarioId, 'Scenario');
  const scenario = scenarioId
    ? await ScenarioSimulation.findOne({ _id: scenarioId, userId }).lean()
    : await ScenarioSimulation.findOne({ userId }).sort({ createdAt: -1, _id: -1 }).lean();
  if (!scenario) throw createHttpError(404, 'No saved scenario is available to import.');
  const exported = await require('./scenarioSprintExportService').exportScenario(
    userId,
    sprintId,
    scenario,
    'draft',
  );
  return serializeSprint(exported.sprint, { signals: null });
};

// Optimistic concurrency makes each saved document update atomic. Retry from a
// fresh owned document so identical completion/import requests become no-ops.
const retryMutation =
  (operation) =>
  async (...args) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await operation(...args);
      } catch (error) {
        if (error.code === 11000) throw createHttpError(409, 'Sprint dates overlap an existing sprint.');
        if (error.name !== 'VersionError') throw error;
        if (attempt === 4) throw createHttpError(409, 'Sprint changed. Retry your action.');
      }
    }
  };

const editTask = async (userId, sprintId, taskId, payload = {}) => {
  assertObjectId(sprintId, 'Sprint');
  assertObjectId(taskId, 'Task');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (sprint) legacyPolicy.assertWritable(sprint);
  const task = sprint?.tasks.id(taskId);
  if (!task) return null;
  if (task.isCompleted) throw createHttpError(409, 'Uncomplete this task before editing it.');
  const fields = ['title', 'description', 'points', 'priority', 'category', 'startDate', 'endDate'];
  if (Object.keys(payload).some((key) => !fields.includes(key)))
    throw createHttpError(400, 'Unsupported task field.');
  const normalized = normalizeTask({ ...task.toObject(), ...payload }, task.taskType, false, sprint);
  if (normalizeTitle(task.title).toLowerCase() !== normalized.title.toLowerCase())
    assertUniqueTask(sprint, normalized.title);
  const preservedProvenance = {
    sourceCourseId: task.sourceCourseId || null,
    sourceCourseSkill: task.sourceCourseSkill || null,
    sourceScenarioId: task.sourceScenarioId || null,
    sourceScenarioHash: task.sourceScenarioHash || '',
    sourceScenarioItemKey: task.sourceScenarioItemKey || '',
    sourceRecommendationId: task.sourceRecommendationId || undefined,
    sourceRecommendationSnapshotId: task.sourceRecommendationSnapshotId || undefined,
    sourceRecommendationHash: task.sourceRecommendationHash || undefined,
    sourceRule: task.sourceRule || undefined,
    evidenceLimitation: task.evidenceLimitation || undefined,
  };
  Object.assign(task, normalized, preservedProvenance);
  await sprint.save();
  invalidateCareerSprintCache(userId);
  return serializeSprint(sprint, { signals: null });
};

const deleteTask = async (userId, sprintId, taskId) => {
  assertObjectId(sprintId, 'Sprint');
  assertObjectId(taskId, 'Task');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;
  legacyPolicy.assertWritable(sprint);
  const task = sprint.tasks.id(taskId);
  if (task?.isCompleted) throw createHttpError(409, 'Uncomplete this task before deleting it.');
  if (task) {
    task.deleteOne();
    await sprint.save();
    invalidateCareerSprintCache(userId);
  }
  return serializeSprint(sprint, { signals: null });
};

const mutateDraft = async (userId, sprintId, planId, selection = null, acknowledgement = null) => {
  assertObjectId(sprintId, 'Sprint');
  assertObjectId(planId, 'Plan');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;
  legacyPolicy.assertWritable(sprint);
  const plan = sprint.aiPlans.id(planId);
  if (!plan) return null;
  if (selection === null) {
    plan.deleteOne();
  } else {
    if (
      !Array.isArray(selection) ||
      selection.length > LIMITS.tasksPerPlan ||
      selection.some((index) => !Number.isInteger(index) || index < 0 || index >= plan.tasks.length)
    ) {
      throw createHttpError(400, 'Select valid draft task indexes.');
    }
    const context = await draftContext.currentContext(userId);
    draftContext.requireAcknowledgement(plan, context, acknowledgement);
    const selected = [...new Set(selection)].map((index) => plan.tasks[index].toObject());
    const tasks = dedupeTasks(
      selected,
      sprint.tasks.map((task) => task.title),
      true,
      sprint,
    ).filter(
      (task) =>
        (!task.sourceRecommendationId ||
          !sprint.tasks.some(
            (existing) => existing.sourceRecommendationId === task.sourceRecommendationId,
          )) &&
        (!task.sourceScenarioItemKey ||
          !(sprint.scenarioIngestedItems || []).includes(task.sourceScenarioItemKey)),
    );
    if (sprint.tasks.length + tasks.length > 500) throw createHttpError(413, 'Sprint task limit reached.');
    if (
      (sprint.scenarioIngestedItems?.length || 0) +
        tasks.filter((task) => task.sourceScenarioItemKey).length >
      500
    )
      throw createHttpError(413, 'Sprint provenance limit reached.');
    sprint.scenarioIngestedItems = [
      ...new Set([
        ...(sprint.scenarioIngestedItems || []),
        ...tasks.map((task) => task.sourceScenarioItemKey).filter(Boolean),
      ]),
    ];
    sprint.tasks.push(...tasks);
  }
  await sprint.save();
  invalidateCareerSprintCache(userId);
  return serializeSprint(sprint, { signals: null });
};

// Server-side Simulator adapter. Proposed work never changes evidence or scores.
const mergeProposedTasks = async (userId, sprintId, proposedTasks) => {
  assertObjectId(sprintId, 'Sprint');
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;
  legacyPolicy.assertWritable(sprint);
  if (!Array.isArray(proposedTasks) || proposedTasks.length > LIMITS.tasksPerCreate)
    throw createHttpError(400, 'Invalid proposed tasks.');
  for (const id of new Set(proposedTasks.map((task) => task?.sourceScenarioId).filter(Boolean))) {
    assertObjectId(id, 'Scenario');
    if (!(await ScenarioSimulation.findOne({ _id: id, userId }).lean()))
      throw createHttpError(404, 'Scenario not found.');
  }
  const tasks = dedupeTasks(
    proposedTasks,
    sprint.tasks.map((task) => task.title),
    true,
    sprint,
  );
  if (sprint.tasks.length + tasks.length > 500) throw createHttpError(413, 'Sprint task limit reached.');
  if (tasks.length) {
    sprint.tasks.push(...tasks);
    sprint.weeklyGoal = Math.max(Number(sprint.weeklyGoal || 5), tasks.length);
    await sprint.save();
    invalidateCareerSprintCache(userId);
  }
  return { sprint, tasksAdded: tasks };
};

module.exports = {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion: retryMutation(toggleTaskCompletion),
  addTaskToSprint: retryMutation(addTaskToSprint),
  restoreStreak: retryMutation(restoreStreak),
  updateSprintDates: retryMutation(updateSprintDates),
  editTask: retryMutation(editTask),
  deleteTask: retryMutation(deleteTask),
  mutateDraft: retryMutation(mutateDraft),
  mergeProposedTasks: retryMutation(mergeProposedTasks),
  getSprintHistory,
  saveAiPlanToSprint: retryMutation(saveAiPlanToSprint),
  importScenarioPlanToSprint: retryMutation(importScenarioPlanToSprint),
  normalizeTask,
  parseDateOrNull,
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
  STAGE_TIMINGS_ENABLED,
};
