const {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint,
  restoreStreak,
  updateSprintDates,
  getSprintHistory,
  saveAiPlanToSprint,
  importScenarioPlanToSprint,
  assertObjectId,
  sanitizeBoundedText,
  LIMITS
} = require('../services/careerSprintService');
const { generateTasks, generateAiTasksWithLLM } = require('../services/aiTaskService');
const { invalidateDashboardSummaryCache } = require('./dashboardcontroller');
const { invalidateContextCache } = require('../services/scenarioSimulatorService');
const { invalidateNewsSignalCache } = require('../services/newsService');
const { createNotification } = require('../services/notificationService');

const invalidateSprintDependents = (userId) => {
  invalidateDashboardSummaryCache(userId);
  invalidateContextCache(userId);
  invalidateNewsSignalCache(userId);
};

const INTERNAL_ERROR_PATTERN = /E\d{4}|Mongo|CastError|TypeError|at\s+\S+:\d+|ENOENT|ECONN|stack|password|token|api[_-]?key|secret|prompt/i;

const normalizeError = (error, fallback) => {
  const statusCode = Number(error?.statusCode) || 500;
  const rawMessage = String(error?.message || '').trim();
  const safeClientMessage = statusCode >= 400
    && statusCode < 500
    && rawMessage
    && !INTERNAL_ERROR_PATTERN.test(rawMessage)
    ? rawMessage
    : fallback;

  return {
    message: safeClientMessage,
    errors: Array.isArray(error?.details) ? error.details.slice(0, 20) : []
  };
};

const requireUser = (req, res) => {
  if (!req.user?._id) {
    res.status(401).json({ message: 'Authentication required.' });
    return null;
  }
  return req.user._id;
};

const sanitizePlannerInput = (body = {}) => ({
  stack: sanitizeBoundedText(body.stack || '', LIMITS.goalField, 'Stack'),
  technology: sanitizeBoundedText(body.technology || '', LIMITS.goalField, 'Technology'),
  experienceLevel: sanitizeBoundedText(body.experienceLevel || '', LIMITS.goalField, 'Experience level'),
  sprintStartDate: body.sprintStartDate || undefined,
  sprintEndDate: body.sprintEndDate || undefined,
  forceRefresh: Boolean(body.forceRefresh)
});

const getCurrentCareerSprint = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const forceRefresh = String(req.query.forceRefresh || '').toLowerCase() === 'true';
    const sprint = await getCurrentSprint(userId, { forceRefresh });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint fetch error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to load career sprint.'));
  }
};

const createCareerSprint = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const {
      title,
      weeklyGoal,
      tasks,
      goalStack,
      goalTechnology,
      goalTitle,
      goalExperienceLevel,
      sprintStartDate,
      sprintEndDate
    } = req.body || {};

    const sprint = await createSprint({
      userId,
      title,
      weeklyGoal,
      tasks,
      goalStack,
      goalTechnology,
      goalTitle,
      goalExperienceLevel,
      sprintStartDate,
      sprintEndDate
    });
    invalidateSprintDependents(userId);
    res.status(201).json(sprint);
  } catch (error) {
    console.error('Career sprint create error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to create career sprint.'));
  }
};

const addCareerSprintTask = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    assertObjectId(req.params.id, 'Sprint');
    const sprint = await addTaskToSprint(userId, req.params.id, req.body || {});
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(userId);
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint add task error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to add sprint task.'));
  }
};

const updateCareerSprintTask = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    assertObjectId(req.params.id, 'Sprint');
    assertObjectId(req.params.taskId, 'Task');
    const { isCompleted } = req.body || {};
    if (typeof isCompleted !== 'boolean') {
      return res.status(400).json({ message: 'isCompleted must be a boolean.' });
    }
    const sprint = await toggleTaskCompletion(userId, req.params.id, req.params.taskId, isCompleted);
    if (!sprint) return res.status(404).json({ message: 'Sprint or task not found.' });
    invalidateSprintDependents(userId);
    if (isCompleted) {
      const completedTask = (sprint.tasks || []).find((task) => String(task._id) === String(req.params.taskId));
      setImmediate(() => {
        createNotification({
          userId,
          type: 'success',
          title: 'Sprint Task Completed',
          message: completedTask?.title ? `${completedTask.title} was completed.` : 'A Career Sprint task was completed.',
          dedupeKey: `sprint_task_completed:${req.params.id}:${req.params.taskId}`,
          dedupeWindowHours: 24,
          meta: { sprintId: req.params.id, taskId: req.params.taskId, level: sprint.level, streak: sprint.currentStreak }
        }).catch(() => {});
      });
    }
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint update task error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to update sprint task.'));
  }
};

const getCareerSprintHistory = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const limit = Number(req.query.limit || 6);
    const history = await getSprintHistory(userId, limit);
    res.json({ history });
  } catch (error) {
    console.error('Career sprint history error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to load sprint history.'));
  }
};

const restoreCareerStreakController = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    assertObjectId(req.params.id, 'Sprint');
    const sprint = await restoreStreak(userId, req.params.id);
    if (!sprint) return res.status(400).json({ message: 'Cannot restore streak at this time.' });
    invalidateSprintDependents(userId);
    setImmediate(() => {
      createNotification({
        userId,
        type: 'success',
        title: 'Career Streak Restored',
        message: `Your ${Number(sprint.currentStreak || sprint.streak || 0)} day streak is active again.`,
        dedupeKey: `sprint_streak_restored:${req.params.id}`,
        dedupeWindowHours: 24
      }).catch(() => {});
    });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint restore streak error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to restore streak.'));
  }
};

const generateAiTasks = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const input = sanitizePlannerInput(req.body || {});
    const result = await generateTasks({
      userId,
      ...input
    });
    res.json(result);
  } catch (error) {
    console.error('AI task generation error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to generate AI tasks.'));
  }
};

const generateTrueAiTasks = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const input = sanitizePlannerInput(req.body || {});
    const result = await generateAiTasksWithLLM({
      userId,
      ...input
    });
    res.json(result);
  } catch (error) {
    console.error('LLM sprint generation error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to generate AI sprint plan.'));
  }
};

const updateSprintDatesController = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    assertObjectId(req.params.id, 'Sprint');
    const { sprintStartDate, sprintEndDate } = req.body || {};
    const sprint = await updateSprintDates(userId, req.params.id, sprintStartDate, sprintEndDate);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(userId);
    res.json(sprint);
  } catch (error) {
    console.error('Sprint dates update error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to update sprint dates.'));
  }
};

const saveAiPlanController = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    assertObjectId(req.params.id, 'Sprint');
    const sprint = await saveAiPlanToSprint(userId, req.params.id, req.body || {});
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(userId);
    res.json(sprint);
  } catch (error) {
    console.error('Save AI sprint plan error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to save AI sprint plan.'));
  }
};

const importScenarioPlanController = async (req, res) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    assertObjectId(req.params.id, 'Sprint');
    const scenarioId = req.body?.scenarioId ? String(req.body.scenarioId) : '';
    if (scenarioId) assertObjectId(scenarioId, 'Scenario');
    const sprint = await importScenarioPlanToSprint(userId, req.params.id, scenarioId);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(userId);
    res.json(sprint);
  } catch (error) {
    console.error('Import scenario sprint plan error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to import Scenario Simulator plan.'));
  }
};

module.exports = {
  getCurrentCareerSprint,
  createCareerSprint,
  addCareerSprintTask,
  updateCareerSprintTask,
  getCareerSprintHistory,
  restoreCareerStreakController,
  generateAiTasks,
  generateTrueAiTasks,
  updateSprintDatesController,
  saveAiPlanController,
  importScenarioPlanController
};
