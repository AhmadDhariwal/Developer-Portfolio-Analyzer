const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const { getRecruiterCandidates } = require('../controllers/recruiterController');

router.get('/candidates', protect, getRecruiterCandidates);

module.exports = router;
