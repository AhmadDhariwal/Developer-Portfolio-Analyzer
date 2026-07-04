const {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint,
  restoreStreak,
  updateSprintDates,
  getSprintHistory,
  saveAiPlanToSprint,
  importScenarioPlanToSprint
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

const normalizeError = (error, fallback) => ({
  message: error?.message || fallback,
  errors: error?.details || []
});

const getCurrentCareerSprint = async (req, res) => {
  try {
    const forceRefresh = String(req.query.forceRefresh || '').toLowerCase() === 'true';
    const sprint = await getCurrentSprint(req.user._id, { forceRefresh });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint fetch error:', error.message);
    res.status(500).json({ message: 'Failed to load career sprint.' });
  }
};

const createCareerSprint = async (req, res) => {
  try {
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
      userId: req.user._id,
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
    invalidateSprintDependents(req.user._id);
    res.status(201).json(sprint);
  } catch (error) {
    console.error('Career sprint create error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to create career sprint.'));
  }
};

const addCareerSprintTask = async (req, res) => {
  try {
    const sprint = await addTaskToSprint(req.user._id, req.params.id, req.body || {});
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(req.user._id);
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint add task error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to add sprint task.'));
  }
};

const updateCareerSprintTask = async (req, res) => {
  try {
    const { isCompleted } = req.body || {};
    const sprint = await toggleTaskCompletion(req.user._id, req.params.id, req.params.taskId, isCompleted);
    if (!sprint) return res.status(404).json({ message: 'Sprint or task not found.' });
    invalidateSprintDependents(req.user._id);
    if (Boolean(isCompleted)) {
      const completedTask = (sprint.tasks || []).find((task) => String(task._id) === String(req.params.taskId));
      await createNotification({
        userId: req.user._id,
        type: 'success',
        title: 'Sprint Task Completed',
        message: completedTask?.title ? `${completedTask.title} was completed.` : 'A Career Sprint task was completed.',
        dedupeKey: `sprint_task_completed:${req.params.id}:${req.params.taskId}`,
        dedupeWindowHours: 24,
        meta: { sprintId: req.params.id, taskId: req.params.taskId, level: sprint.level, streak: sprint.currentStreak }
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
    const limit = Number(req.query.limit || 6);
    const history = await getSprintHistory(req.user._id, limit);
    res.json({ history });
  } catch (error) {
    console.error('Career sprint history error:', error.message);
    res.status(500).json({ message: 'Failed to load sprint history.' });
  }
};

const restoreCareerStreakController = async (req, res) => {
  try {
    const sprint = await restoreStreak(req.user._id, req.params.id);
    if (!sprint) return res.status(400).json({ message: 'Cannot restore streak at this time.' });
    invalidateSprintDependents(req.user._id);
    await createNotification({
      userId: req.user._id,
      type: 'success',
      title: 'Career Streak Restored',
      message: `Your ${Number(sprint.currentStreak || sprint.streak || 0)} day streak is active again.`,
      dedupeKey: `sprint_streak_restored:${req.params.id}`,
      dedupeWindowHours: 24
    });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint restore streak error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to restore streak.'));
  }
};

const generateAiTasks = async (req, res) => {
  try {
    const { stack, technology, experienceLevel, sprintStartDate, sprintEndDate, forceRefresh } = req.body || {};
    const result = await generateTasks({
      userId: req.user._id,
      stack,
      technology,
      experienceLevel,
      sprintStartDate,
      sprintEndDate,
      forceRefresh: Boolean(forceRefresh)
    });
    res.json(result);
  } catch (error) {
    console.error('AI task generation error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to generate AI tasks.'));
  }
};

const generateTrueAiTasks = async (req, res) => {
  try {
    const { stack, technology, experienceLevel, sprintStartDate, sprintEndDate, forceRefresh } = req.body || {};
    const result = await generateAiTasksWithLLM({
      userId: req.user._id,
      stack,
      technology,
      experienceLevel,
      sprintStartDate,
      sprintEndDate,
      forceRefresh: Boolean(forceRefresh)
    });
    res.json(result);
  } catch (error) {
    console.error('LLM sprint generation error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to generate AI sprint plan.'));
  }
};

const updateSprintDatesController = async (req, res) => {
  try {
    const { sprintStartDate, sprintEndDate } = req.body || {};
    const sprint = await updateSprintDates(req.user._id, req.params.id, sprintStartDate, sprintEndDate);
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(req.user._id);
    res.json(sprint);
  } catch (error) {
    console.error('Sprint dates update error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to update sprint dates.'));
  }
};

const saveAiPlanController = async (req, res) => {
  try {
    const sprint = await saveAiPlanToSprint(req.user._id, req.params.id, req.body || {});
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(req.user._id);
    res.json(sprint);
  } catch (error) {
    console.error('Save AI sprint plan error:', error.message);
    res.status(error.statusCode || 500).json(normalizeError(error, 'Failed to save AI sprint plan.'));
  }
};

const importScenarioPlanController = async (req, res) => {
  try {
    const sprint = await importScenarioPlanToSprint(req.user._id, req.params.id, req.body?.scenarioId || '');
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    invalidateSprintDependents(req.user._id);
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
