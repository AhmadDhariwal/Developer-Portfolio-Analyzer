const express = require('express');
const { getAnalytics } = require('../../controllers/hub/recruiterAnalyticsController');
const { getDashboard } = require('../../controllers/hub/recruiterDashboardController');

const router = express.Router();

router.get('/dashboard', getDashboard);
router.get('/', getAnalytics);

module.exports = router;
