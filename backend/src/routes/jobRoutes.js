const express        = require('express');
const { fetchJobs, getJobById, getSourceHealthStatus, getCacheHealthStatus } = require('../controllers/jobController');
const { protect }    = require('../middleware/authmiddleware');

const router = express.Router();

// GET /api/jobs
// Query params: stack, experience, platform, location, skills, jobType, expLevel, page, limit
router.get('/', protect, fetchJobs);
router.get('/source-health', protect, getSourceHealthStatus);
router.get('/cache-health', protect, getCacheHealthStatus);
router.get('/:id', protect, getJobById);

module.exports = router;
