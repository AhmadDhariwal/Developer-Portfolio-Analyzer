const express = require('express');
const { fetchCourses } = require('../controllers/courseController');
const { protect } = require('../middleware/authmiddleware');

const progress = require('../controllers/courseProgressController');
const router = express.Router();

// GET /api/courses
// Query params: stack, experience, platform, rating, level, topic, duration, page, limit
router.get('/', protect, fetchCourses);
router.get('/my-learning', protect, progress.listProgress);
router.put('/:courseId/progress', protect, progress.saveProgress);
router.delete('/:courseId/progress', protect, progress.removeProgress);
router.post('/:courseId/career-sprint', protect, progress.handoffToSprint);

module.exports = router;
