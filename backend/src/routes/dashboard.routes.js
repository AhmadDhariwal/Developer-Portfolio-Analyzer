const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getDashboardContributions,
  getDashboardLanguages,
  getDashboardSkills,
  getDashboardRecommendations,
  getDashboardIntegrationAnalytics,
} = require('../controllers/dashboardcontroller');
const { protect } = require('../middleware/authmiddleware');

// All dashboard routes are protected
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-cache');
  next();
});
router.get('/summary', protect, getDashboardSummary);
router.get('/contributions', protect, getDashboardContributions);
router.get('/languages', protect, getDashboardLanguages);
router.get('/skills', protect, getDashboardSkills);
router.get('/recommendations', protect, getDashboardRecommendations);
router.get('/integration-analytics', protect, getDashboardIntegrationAnalytics);

module.exports = router;
