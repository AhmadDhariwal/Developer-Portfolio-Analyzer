const express        = require('express');
const { fetchJobs }  = require('../controllers/jobController');
const { protect }    = require('../middleware/authmiddleware');

const router = express.Router();

// GET /api/jobs
// Query params: stack, experience, platform, location, skills, jobType, expLevel, page, limit
router.get('/', protect, fetchJobs);

module.exports = router;
