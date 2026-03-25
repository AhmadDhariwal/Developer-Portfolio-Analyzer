const CareerSprint = require('../models/careerSprint');

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

const buildSprintPayload = ({ userId, title, weeklyGoal, tasks = [] }) => {
  const weekStartDate = startOfWeek();
  const weekEndDate = endOfWeek(weekStartDate);

  return {
    userId,
    title: title || 'Career Sprint',
    weeklyGoal: Number(weeklyGoal || 5),
    weekStartDate,
    weekEndDate,
    tasks: Array.isArray(tasks)
      ? tasks.map((task) => ({
          title: String(task.title || 'New Task'),
          description: String(task.description || ''),
          points: Number(task.points || 1),
          isCompleted: false
        }))
      : []
  };
};

const createSprint = async ({ userId, title, weeklyGoal, tasks = [] }) => {
  const payload = buildSprintPayload({ userId, title, weeklyGoal, tasks });
  return CareerSprint.create(payload);
};

const getCurrentSprint = async (userId) => {
  const now = new Date();
  let sprint = await CareerSprint.findOne({ userId, weekStartDate: { $lte: now }, weekEndDate: { $gte: now } });
  if (!sprint) {
    sprint = await CareerSprint.create(buildSprintPayload({ userId }));
  }
  return sprint;
};

const toggleTaskCompletion = async (userId, sprintId, taskId, isCompleted) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  const task = sprint.tasks.id(taskId);
  if (!task) return null;

  task.isCompleted = Boolean(isCompleted);
  task.completedAt = task.isCompleted ? new Date() : null;

  await sprint.save();
  await updateSprintStreak(sprint);
  return sprint;
};

const addTaskToSprint = async (userId, sprintId, task) => {
  const sprint = await CareerSprint.findOne({ _id: sprintId, userId });
  if (!sprint) return null;

  sprint.tasks.push({
    title: String(task?.title || 'New Task'),
    description: String(task?.description || ''),
    points: Number(task?.points || 1),
    isCompleted: false
  });

  await sprint.save();
  return sprint;
};

const updateSprintStreak = async (sprint) => {
  const completedCount = sprint.tasks.filter((t) => t.isCompleted).length;
  const goalMet = completedCount >= Number(sprint.weeklyGoal || 0);

  if (!goalMet) return sprint;

  const now = new Date();
  if (sprint.lastCompletedWeekAt) {
    const last = new Date(sprint.lastCompletedWeekAt);
    const diffDays = Math.floor((startOfWeek(now) - startOfWeek(last)) / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) {
      sprint.streak = (sprint.streak || 0) + 1;
    } else {
      sprint.streak = 1;
    }
  } else {
    sprint.streak = 1;
  }

  sprint.longestStreak = Math.max(Number(sprint.longestStreak || 0), sprint.streak);
  sprint.lastCompletedWeekAt = now;
  await sprint.save();
  return sprint;
};

module.exports = {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint
};
