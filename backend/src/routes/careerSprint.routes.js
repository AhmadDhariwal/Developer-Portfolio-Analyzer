const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getCurrentCareerSprint,
  createCareerSprint,
  addCareerSprintTask,
  updateCareerSprintTask,
  getCareerSprintHistory
} = require('../controllers/careerSprintController');

router.get('/current', protect, getCurrentCareerSprint);
router.post('/', protect, createCareerSprint);
router.post('/:id/tasks', protect, addCareerSprintTask);
router.put('/:id/tasks/:taskId', protect, updateCareerSprintTask);
router.get('/history', protect, getCareerSprintHistory);

module.exports = router;
