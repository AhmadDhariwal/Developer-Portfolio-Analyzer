const CareerSprint = require('../models/careerSprint');
const { recordActivity, checkInactivity, restoreStreak: restoreStreakFn, canRestore } = require('./streakService');
const { startOfDay, endOfDay, addDays } = require('../utils/dateUtils');

// ── Week helpers (kept for sprint window logic) ───────────────────────────

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

// ── XP helpers ────────────────────────────────────────────────────────────

const POINTS_TO_XP = { high: 15, medium: 10, low: 5 };

const xpForTask = (task) => {
  const base = POINTS_TO_XP[task.priority] || 10;
  return base + Number(task.points || 0);
};

const levelFromXp = (xp) => Math.max(1, Math.floor(xp / 100) + 1);

// ── Progress helpers ──────────────────────────────────────────────────────

const calcWeightedProgress = (tasks) => {
  if (!tasks || tasks.length === 0) return 0;
  const totalPts = tasks.reduce((s, t) => s + (Number(t.points) || 1), 0);
  const donePts  = tasks.filter(t => t.isCompleted).reduce((s, t) => s + (Number(t.points) || 1), 0);
  return totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;
};

// ── Sprint builder ────────────────────────────────────────────────────────

const buildSprintPayload = ({
  userId, title, weeklyGoal, tasks = [],
  goalStack, goalTechnology, goalTitle, goalExperienceLevel,
  sprintStartDate, sprintEndDate,
}) => {
  const weekStart = startOfWeek();
  const weekEnd   = endOfWeek(weekStart);

  // User-chosen dates fall back to current week
  const sprintStart = sprintStartDate ? startOfDay(new Date(sprintStartDate)) : weekStart;
  const sprintEnd   = sprintEndDate   ? endOfDay(new Date(sprintEndDate))     : weekEnd;

  return {
    userId,
    title:       title || 'Career Sprint',
    weeklyGoal:  Number(weeklyGoal || 5),
    weekStartDate:   weekStart,
    weekEndDate:     weekEnd,
    sprintStartDate: sprintStart,
    sprintEndDate:   sprintEnd,
    goalStack:           goalStack || '',
    goalTechnology:      goalTechnology || '',
    goalTitle:           goalTitle || '',
    goalExperienceLevel: goalExperienceLevel || '',
    tasks: Array.isArray(tasks)
      ? tasks.map(task => ({
          title:       String(task.title || 'New Task'),
          description: String(task.description || ''),
          points:      Number(task.points || 3),
          priority:    ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
          category:    ['learning', 'project', 'practice'].includes(task.category) ? task.category : 'learning',
          taskType:    task.taskType === 'ai' ? 'ai' : 'manual',
          startDate:   task.startDate || null,
          endDate:     task.endDate   || null,
          isCompleted: false,
        }))
      : []
  };
};

// ── Public API ────────────────────────────────────────────────────────────

const createSprint = async (opts) => {
  const payload = buildSprintPayload(opts);
  return CareerSprint.create(payload);
};

const getCurrentSprint = async (userId) => {
  const now = new Date();
  let sprint = await CareerSprint.findOne({
    userId,
    weekStartDate: { $lte: now },
    weekEndDate:   { $gte: now }
  });

  if (!sprint) {
    sprint = await CareerSprint.create(buildSprintPayload({ userId }));
  }

  // Check inactivity on every load (acts as a soft daily cron)
  const { changed } = checkInactivity(sprint);
  if (changed) await sprint.save();

  // Attach canRestore flag (virtual, not persisted)
  sprint._canRestore = canRestore(sprint);

  return sprint;
};

const toggleTaskCompletion = async (userId, sprintId, taskId, isCompleted) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const task = sprint.tasks.id(taskId);
  if (!task) return null;

  const wasCompleted = task.isCompleted;
  task.isCompleted = Boolean(isCompleted);
  task.completedAt = task.isCompleted ? new Date() : null;

  // XP
  if (task.isCompleted && !wasCompleted) {
    sprint.xpPoints = (sprint.xpPoints || 0) + xpForTask(task);
    // Record streak activity on completion
    recordActivity(sprint);
  } else if (!task.isCompleted && wasCompleted) {
    sprint.xpPoints = Math.max(0, (sprint.xpPoints || 0) - xpForTask(task));
  }
  sprint.level = levelFromXp(sprint.xpPoints);

  await sprint.save();
  sprint._canRestore = canRestore(sprint);
  return sprint;
};

const addTaskToSprint = async (userId, sprintId, task) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  sprint.tasks.push({
    title:       String(task?.title || 'New Task'),
    description: String(task?.description || ''),
    points:      Number(task?.points || 3),
    priority:    ['high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
    category:    ['learning', 'project', 'practice'].includes(task?.category) ? task.category : 'learning',
    taskType:    task?.taskType === 'ai' ? 'ai' : 'manual',
    startDate:   task?.startDate || null,
    endDate:     task?.endDate   || null,
    isCompleted: false,
  });

  await sprint.save();
  sprint._canRestore = canRestore(sprint);
  return sprint;
};

const restoreStreak = async (userId, sprintId) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const restored = restoreStreakFn(sprint);
  if (!restored) return null;

  await sprint.save();
  sprint._canRestore = false;
  return sprint;
};

/**
 * Update sprint date range (user-selectable).
 */
const updateSprintDates = async (userId, sprintId, sprintStartDate, sprintEndDate) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  if (sprintStartDate) sprint.sprintStartDate = startOfDay(new Date(sprintStartDate));
  if (sprintEndDate)   sprint.sprintEndDate   = endOfDay(new Date(sprintEndDate));

  await sprint.save();
  return sprint;
};

module.exports = {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint,
  restoreStreak,
  updateSprintDates,
  calcWeightedProgress,
  xpForTask,
  levelFromXp,
};
