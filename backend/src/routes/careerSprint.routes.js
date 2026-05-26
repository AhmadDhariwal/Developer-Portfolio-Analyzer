const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
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
  importScenarioPlanController,
} = require('../controllers/careerSprintController');

router.get('/current',              protect, getCurrentCareerSprint);
router.post('/',                    protect, createCareerSprint);
router.post('/generate-plan',       protect, generateAiTasks);
router.post('/generate-ai-tasks',   protect, generateAiTasks);
router.post('/generate-ai-plan',    protect, generateTrueAiTasks);
router.post('/:id/ai-plans',        protect, saveAiPlanController);
router.post('/:id/import-scenario', protect, importScenarioPlanController);
router.post('/:id/tasks',           protect, addCareerSprintTask);
router.put('/:id/tasks/:taskId',    protect, updateCareerSprintTask);
router.put('/:id/dates',            protect, updateSprintDatesController);
router.get('/history',              protect, getCareerSprintHistory);
router.post('/:id/restore-streak',  protect, restoreCareerStreakController);

module.exports = router;
