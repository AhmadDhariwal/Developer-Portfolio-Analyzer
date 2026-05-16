const express = require('express');
const { getAnalytics } = require('../../controllers/recruiter-hub/recruiterAnalyticsController');
const { getDashboard } = require('../../controllers/recruiter-hub/recruiterDashboardController');

const router = express.Router();

router.get('/dashboard', getDashboard);
router.get('/', getAnalytics);

module.exports = router;
