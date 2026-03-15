const express            = require('express');
const { fetchCourses }   = require('../controllers/courseController');
const { protect }        = require('../middleware/authmiddleware');

const router = express.Router();

// GET /api/courses
// Query params: stack, experience, platform, rating, level, topic, duration, page, limit
router.get('/', protect, fetchCourses);

module.exports = router;
