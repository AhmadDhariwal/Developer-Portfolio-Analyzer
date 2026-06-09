const express        = require('express');
const { fetchJobs, getJobById } = require('../controllers/jobController');
const { protect }    = require('../middleware/authmiddleware');

const router = express.Router();

// GET /api/jobs
// Query params: stack, experience, platform, location, skills, jobType, expLevel, page, limit
router.get('/', protect, fetchJobs);
router.get('/:id', protect, getJobById);

module.exports = router;
