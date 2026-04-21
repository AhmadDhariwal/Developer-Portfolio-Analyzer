const CareerSprint = require('../models/careerSprint');

// ── Date helpers ──────────────────────────────────────────────────────────

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

/**
 * Weighted progress: sum of completed task points / total task points.
 * Falls back to task count if no points defined.
 */
const calcWeightedProgress = (tasks) => {
  if (!tasks || tasks.length === 0) return 0;
  const totalPts = tasks.reduce((s, t) => s + (Number(t.points) || 1), 0);
  const donePts  = tasks.filter(t => t.isCompleted).reduce((s, t) => s + (Number(t.points) || 1), 0);
  return totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;
};

// ── Sprint builder ────────────────────────────────────────────────────────

const buildSprintPayload = ({ userId, title, weeklyGoal, tasks = [], goalStack, goalTechnology, goalTitle, goalExperienceLevel }) => {
  const weekStartDate = startOfWeek();
  const weekEndDate   = endOfWeek(weekStartDate);

  return {
    userId,
    title:       title || 'Career Sprint',
    weeklyGoal:  Number(weeklyGoal || 5),
    weekStartDate,
    weekEndDate,
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
          isCompleted: false,
        }))
      : []
  };
};

// ── Streak status ─────────────────────────────────────────────────────────

const resolveStreakStatus = (sprint) => {
  if (sprint.streakBroken) return 'broken';
  if (sprint.streakWarning) return 'warning';
  return 'active';
};

// ── Public API ────────────────────────────────────────────────────────────

const createSprint = async ({ userId, title, weeklyGoal, tasks = [], goalStack, goalTechnology, goalTitle, goalExperienceLevel }) => {
  const payload = buildSprintPayload({ userId, title, weeklyGoal, tasks, goalStack, goalTechnology, goalTitle, goalExperienceLevel });
  return CareerSprint.create(payload);
};

const getCurrentSprint = async (userId) => {
  const now = new Date();
  let sprint = await CareerSprint.findOne({ userId, weekStartDate: { $lte: now }, weekEndDate: { $gte: now } });

  if (!sprint) {
    sprint = await CareerSprint.create(buildSprintPayload({ userId }));

    // Check if previous sprint broke the streak
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const previousSprint = await CareerSprint.findOne({
      userId,
      weekEndDate: { $lt: now, $gte: weekAgo }
    });

    if (previousSprint) {
      const completedCount = previousSprint.tasks.filter(t => t.isCompleted).length;
      const goalMet = completedCount >= Number(previousSprint.weeklyGoal || 0);
      if (!goalMet && sprint.streak > 0) {
        sprint.streakBroken  = true;
        sprint.streakBrokenAt = now;
        sprint.streakStatus  = 'broken';
        sprint.streak        = 0;
        await sprint.save();
      }
    }
  }

  // Warn if sprint ends soon and goal not met
  const daysUntilWeekEnd = Math.ceil((sprint.weekEndDate - now) / (1000 * 60 * 60 * 24));
  if (daysUntilWeekEnd <= 1) {
    const completedCount = sprint.tasks.filter(t => t.isCompleted).length;
    const tasksRemaining = Number(sprint.weeklyGoal || 0) - completedCount;
    const shouldWarn = tasksRemaining > 0 && sprint.streak > 0;
    if (sprint.streakWarning !== shouldWarn) {
      sprint.streakWarning = shouldWarn;
      sprint.streakStatus  = resolveStreakStatus(sprint);
      await sprint.save();
    }
  }

  sprint.streakStatus = resolveStreakStatus(sprint);
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

  // XP: add on completion, subtract on un-completion
  if (task.isCompleted && !wasCompleted) {
    sprint.xpPoints = (sprint.xpPoints || 0) + xpForTask(task);
  } else if (!task.isCompleted && wasCompleted) {
    sprint.xpPoints = Math.max(0, (sprint.xpPoints || 0) - xpForTask(task));
  }
  sprint.level = levelFromXp(sprint.xpPoints);

  await sprint.save();
  await updateSprintStreak(sprint);
  sprint.streakStatus = resolveStreakStatus(sprint);
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
    isCompleted: false,
  });

  await sprint.save();
  sprint.streakStatus = resolveStreakStatus(sprint);
  return sprint;
};

const updateSprintStreak = async (sprint) => {
  const completedCount = sprint.tasks.filter(t => t.isCompleted).length;
  const goalMet = completedCount >= Number(sprint.weeklyGoal || 0);
  if (!goalMet) return sprint;

  const now = new Date();
  if (sprint.lastCompletedWeekAt) {
    const last    = new Date(sprint.lastCompletedWeekAt);
    const diffDays = Math.floor((startOfWeek(now) - startOfWeek(last)) / (1000 * 60 * 60 * 24));
    sprint.streak = diffDays <= 7 ? (sprint.streak || 0) + 1 : 1;
  } else {
    sprint.streak = 1;
  }

  sprint.longestStreak     = Math.max(Number(sprint.longestStreak || 0), sprint.streak);
  sprint.lastCompletedWeekAt = now;
  sprint.streakBroken      = false;
  sprint.streakBrokenAt    = null;
  sprint.streakWarning     = false;
  sprint.streakStatus      = 'active';
  await sprint.save();
  return sprint;
};

const restoreStreak = async (userId, sprintId) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint || !sprint.streakBroken || !sprint.streakBrokenAt) return null;

  const now = new Date();
  const hoursSinceBroken = (now - sprint.streakBrokenAt) / (1000 * 60 * 60);
  if (hoursSinceBroken > 24) return null;

  const previousSprint = await CareerSprint.findOne({
    userId,
    _id: { $ne: sprintId },
    weekEndDate: { $lt: sprint.weekStartDate }
  }).sort({ weekEndDate: -1 }).lean();

  sprint.streak        = previousSprint?.streak || 1;
  sprint.streakBroken  = false;
  sprint.streakBrokenAt = null;
  sprint.streakStatus  = 'active';
  await sprint.save();
  return sprint;
};

module.exports = {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint,
  restoreStreak,
  calcWeightedProgress,
  xpForTask,
  levelFromXp,
};
