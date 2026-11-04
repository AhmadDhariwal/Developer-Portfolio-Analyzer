const express = require('express');
const { fetchCourses } = require('../controllers/courseController');
const { protect } = require('../middleware/authmiddleware');
const {
  admitCourseRead,
  admitCourseMutation,
  admitCourseSprint,
} = require('../middleware/courseAdmission');

const progress = require('../controllers/courseProgressController');
const router = express.Router();

// GET /api/courses
// Query params: stack, experience, platform, rating, level, topic, duration, page, limit
router.get('/', protect, admitCourseRead, fetchCourses);
router.get('/my-learning', protect, admitCourseRead, progress.listProgress);
router.put('/:courseId/progress', protect, admitCourseMutation, progress.saveProgress);
router.delete('/:courseId/progress', protect, admitCourseMutation, progress.removeProgress);
router.post('/:courseId/career-sprint', protect, admitCourseSprint, progress.handoffToSprint);

module.exports = router;
