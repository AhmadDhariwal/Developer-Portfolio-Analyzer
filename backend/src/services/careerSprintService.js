const CareerSprint = require('../models/careerSprint');
const ScenarioSimulation = require('../models/scenarioSimulation');
const { getDeveloperSignals } = require('./developerSignalService');
const { recordActivity, checkInactivity, restoreStreak: restoreStreakFn, canRestore, MAX_RESTORE_DAYS } = require('./streakService');
const { startOfDay, endOfDay, addDays, daysBetween } = require('../utils/dateUtils');

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
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

const normalizeTask = (task, taskTypeDefault = 'manual') => ({
  title: normalizeTitle(task?.title || 'New Task'),
  description: String(task?.description || '').trim(),
  points: clamp(task?.points || 3, 1, 10),
  priority: ['high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
  category: ['learning', 'project', 'practice'].includes(task?.category) ? task.category : 'learning',
  taskType: task?.taskType === 'ai' ? 'ai' : taskTypeDefault,
  startDate: task?.startDate ? startOfDay(new Date(task.startDate)) : null,
  endDate: task?.endDate ? endOfDay(new Date(task.endDate)) : null,
  isCompleted: Boolean(task?.isCompleted)
});

const dedupeTasks = (tasks = [], existingTitles = []) => {
  const seen = new Set(existingTitles.map((title) => normalizeTitle(title).toLowerCase()).filter(Boolean));
  const clean = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const normalized = normalizeTask(task, task?.taskType === 'ai' ? 'ai' : 'manual');
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
  const sprintStart = sprintStartDate ? startOfDay(new Date(sprintStartDate)) : weekStart;
  const sprintEnd = sprintEndDate ? endOfDay(new Date(sprintEndDate)) : weekEnd;

  return {
    userId,
    title: normalizeTitle(title || 'Career Sprint'),
    weeklyGoal: clamp(weeklyGoal || 5, 1, 20),
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    sprintStartDate: sprintStart,
    sprintEndDate: sprintEnd,
    goalStack: String(goalStack || '').trim(),
    goalTechnology: String(goalTechnology || '').trim(),
    goalTitle: String(goalTitle || '').trim(),
    goalExperienceLevel: String(goalExperienceLevel || '').trim(),
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
  const signals = options.signals || (await getDeveloperSignals(sprint.userId));
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

  return sprint;
};

const createSprint = async (opts) => {
  const payload = buildSprintPayload(opts);
  const sprint = await CareerSprint.create(payload);
  return serializeSprint(sprint);
};

const findPreviousSprint = async (userId, sprint) => {
  const pivotDate = sprint.weekStartDate || sprint.createdAt || new Date();
  return CareerSprint.findOne({
    userId,
    _id: { $ne: sprint._id },
    weekStartDate: { $lt: pivotDate }
  }).sort({ weekStartDate: -1 }).lean();
};

const getCurrentSprint = async (userId) => {
  const now = new Date();
  const weekStart = startOfWeek();
  const weekEnd = endOfWeek(weekStart);

  // Atomic create-or-return: prevents duplicate sprints under race conditions
  let sprint = await CareerSprint.findOneAndUpdate(
    {
      userId,
      $or: [
        { sprintStartDate: { $lte: now }, sprintEndDate: { $gte: now } },
        { weekStartDate: { $lte: now }, weekEndDate: { $gte: now } }
      ]
    },
    {
      $setOnInsert: {
        ...buildSprintPayload({ userId }),
        weekStartDate: weekStart,
        weekEndDate: weekEnd
      }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  const { changed } = checkInactivity(sprint);
  if (changed) await sprint.save();

  const [previousSprint, signals] = await Promise.all([
    findPreviousSprint(userId, sprint),
    getDeveloperSignals(userId)
  ]);

  return serializeSprint(sprint, { previousSprint, signals });
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

  // Task toggle only needs previous sprint for comparison — skip full signal reload
  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const addTaskToSprint = async (userId, sprintId, task) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  assertUniqueTask(sprint, task?.title);
  sprint.tasks.push(normalizeTask(task));
  await sprint.save();

  // Task addition doesn't need full developer signal enrichment — skip signal reload
  const previousSprint = await findPreviousSprint(userId, sprint);
  return serializeSprint(sprint, { previousSprint, signals: null });
};

const restoreStreak = async (userId, sprintId) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const restored = restoreStreakFn(sprint);
  if (!restored) return null;

  await sprint.save();
  const [previousSprint, signals] = await Promise.all([
    findPreviousSprint(userId, sprint),
    getDeveloperSignals(userId)
  ]);

  return serializeSprint(sprint, { previousSprint, signals });
};

const updateSprintDates = async (userId, sprintId, sprintStartDate, sprintEndDate) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  if (sprintStartDate) sprint.sprintStartDate = startOfDay(new Date(sprintStartDate));
  if (sprintEndDate) sprint.sprintEndDate = endOfDay(new Date(sprintEndDate));
  await sprint.save();

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
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const tasks = dedupeTasks(payload.tasks || []);
  if (!tasks.length) {
    const error = new Error('AI plan must include at least one task.');
    error.statusCode = 400;
    throw error;
  }

  const plan = {
    name: normalizeTitle(payload.name || 'AI Sprint Plan'),
    source: payload.source === 'scenario' ? 'scenario' : 'ai',
    generatorType: payload.source === 'scenario'
      ? 'scenario'
      : (payload.generatorType === 'llm' ? 'llm' : 'deterministic'),
    goalStack: String(payload.goalStack || sprint.goalStack || '').trim(),
    goalTechnology: String(payload.goalTechnology || sprint.goalTechnology || '').trim(),
    goalExperienceLevel: String(payload.goalExperienceLevel || sprint.goalExperienceLevel || '').trim(),
    summary: String(payload.summary || '').trim(),
    confidenceScore: clamp(payload.confidenceScore || 0),
    consistencyScore: clamp(payload.consistencyScore || 0),
    signalsUsed: Array.isArray(payload.signalsUsed) ? payload.signalsUsed.map((item) => String(item || '').trim()).filter(Boolean) : [],
    tasks
  };

  sprint.aiPlans = [...(sprint.aiPlans || []).filter((item) => normalizeTitle(item.name).toLowerCase() !== plan.name.toLowerCase()), plan].slice(-8);
  await sprint.save();

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
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const scenario = scenarioId
    ? await ScenarioSimulation.findOne({ _id: scenarioId, userId }).lean()
    : await ScenarioSimulation.findOne({ userId }).sort({ createdAt: -1 }).lean();

  if (!scenario) {
    const error = new Error('No saved scenario is available to import.');
    error.statusCode = 404;
    throw error;
  }

  const tasks = buildScenarioTasks(scenario);
  if (!tasks.length) {
    const error = new Error('The selected scenario does not include enough actionable items.');
    error.statusCode = 400;
    throw error;
  }

  return saveAiPlanToSprint(userId, sprintId, {
    name: scenario.name || 'Scenario Simulator Plan',
    source: 'scenario',
    generatorType: 'scenario',
    goalStack: scenario.role || sprint.goalStack,
    goalTechnology: (scenario.skills || []).slice(0, 2).join(', '),
    goalExperienceLevel: scenario.experienceLevel || sprint.goalExperienceLevel,
    summary: 'Imported from Scenario Simulator as a draft sprint plan.',
    confidenceScore: scenario.confidenceScore || scenario.result?.confidenceScore || 0,
    consistencyScore: clamp((scenario.improvements?.hiringScore || 0) * 2.4, 0, 100),
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
  levelFromXp
};