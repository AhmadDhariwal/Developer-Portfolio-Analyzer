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
  updateSprintDatesController,
} = require('../controllers/careerSprintController');

router.get('/current',              protect, getCurrentCareerSprint);
router.post('/',                    protect, createCareerSprint);
router.post('/generate-ai-tasks',   protect, generateAiTasks);
router.post('/:id/tasks',           protect, addCareerSprintTask);
router.put('/:id/tasks/:taskId',    protect, updateCareerSprintTask);
router.put('/:id/dates',            protect, updateSprintDatesController);
router.get('/history',              protect, getCareerSprintHistory);
router.post('/:id/restore-streak',  protect, restoreCareerStreakController);

module.exports = router;
