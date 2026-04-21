const CareerSprint = require('../models/careerSprint');
const {
  createSprint,
  getCurrentSprint,
  toggleTaskCompletion,
  addTaskToSprint,
  restoreStreak,
  calcWeightedProgress,
} = require('../services/careerSprintService');
const { generateTasks } = require('../services/aiTaskService');

// GET /api/career-sprints/current
const getCurrentCareerSprint = async (req, res) => {
  try {
    const sprint = await getCurrentSprint(req.user._id);
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint fetch error:', error.message);
    res.status(500).json({ message: 'Failed to load career sprint.' });
  }
};

// POST /api/career-sprints
const createCareerSprint = async (req, res) => {
  try {
    const { title, weeklyGoal, tasks, goalStack, goalTechnology, goalTitle, goalExperienceLevel } = req.body || {};
    const sprint = await createSprint({
      userId: req.user._id,
      title,
      weeklyGoal,
      tasks,
      goalStack,
      goalTechnology,
      goalTitle,
      goalExperienceLevel,
    });
    res.status(201).json(sprint);
  } catch (error) {
    console.error('Career sprint create error:', error.message);
    res.status(500).json({ message: 'Failed to create career sprint.' });
  }
};

// POST /api/career-sprints/:id/tasks
const addCareerSprintTask = async (req, res) => {
  try {
    const sprint = await addTaskToSprint(req.user._id, req.params.id, req.body || {});
    if (!sprint) return res.status(404).json({ message: 'Sprint not found.' });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint add task error:', error.message);
    res.status(500).json({ message: 'Failed to add sprint task.' });
  }
};

// PUT /api/career-sprints/:id/tasks/:taskId
const updateCareerSprintTask = async (req, res) => {
  try {
    const { isCompleted } = req.body || {};
    const sprint = await toggleTaskCompletion(req.user._id, req.params.id, req.params.taskId, isCompleted);
    if (!sprint) return res.status(404).json({ message: 'Sprint or task not found.' });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint update task error:', error.message);
    res.status(500).json({ message: 'Failed to update sprint task.' });
  }
};

// GET /api/career-sprints/history
const getCareerSprintHistory = async (req, res) => {
  try {
    const limit = Number(req.query.limit || 6);
    const history = await CareerSprint.find({ userId: req.user._id })
      .sort({ weekStartDate: -1 })
      .limit(limit)
      .lean();
    res.json({ history });
  } catch (error) {
    console.error('Career sprint history error:', error.message);
    res.status(500).json({ message: 'Failed to load sprint history.' });
  }
};

// POST /api/career-sprints/:id/restore-streak
const restoreCareerStreakController = async (req, res) => {
  try {
    const sprint = await restoreStreak(req.user._id, req.params.id);
    if (!sprint) return res.status(400).json({ message: 'Cannot restore streak at this time.' });
    res.json(sprint);
  } catch (error) {
    console.error('Career sprint restore streak error:', error.message);
    res.status(500).json({ message: 'Failed to restore streak.' });
  }
};

/**
 * POST /api/career-sprints/generate-ai-tasks
 * Body: { stack, technology, experienceLevel }
 * Returns a list of AI-generated tasks (not yet saved to sprint).
 */
const generateAiTasks = async (req, res) => {
  try {
    const { stack, technology, experienceLevel } = req.body || {};
    const tasks = await generateTasks({
      userId: req.user._id,
      stack,
      technology,
      experienceLevel,
    });
    res.json({ tasks });
  } catch (error) {
    console.error('AI task generation error:', error.message);
    res.status(500).json({ message: 'Failed to generate AI tasks.' });
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
};
