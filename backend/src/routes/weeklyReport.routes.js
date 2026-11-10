const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  generateReport,
  getLatestReport,
  getReportHistory,
} = require('../controllers/weeklyReportController');

router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.post('/generate', protect, generateReport);
router.get('/latest', protect, getLatestReport);
router.get('/history', protect, getReportHistory);

module.exports = router;
