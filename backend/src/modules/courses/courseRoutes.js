const express = require('express');
const { fetchCourses } = require('./courseController');
const { protect } = require('../../core/middleware/authmiddleware');
const {
  admitCourseRead,
  admitCourseLearningRead,
  admitCourseMutation,
  admitCourseSprint,
} = require('./middleware/courseAdmission');

const progress = require('./courseProgressController');
const router = express.Router();

// GET /api/courses
// Query params: stack, experience, platform, rating, level, topic, duration, page, limit
router.get('/', protect, admitCourseRead, fetchCourses);
router.get('/my-learning', protect, admitCourseLearningRead, progress.listProgress);
router.put('/:courseId/progress', protect, admitCourseMutation, progress.saveProgress);
router.delete('/:courseId/progress', protect, admitCourseMutation, progress.removeProgress);
router.post('/:courseId/career-sprint', protect, admitCourseSprint, progress.handoffToSprint);

module.exports = router;
