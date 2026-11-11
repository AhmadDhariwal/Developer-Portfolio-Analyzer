const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  generateReport,
  getLatestReport,
  getReportHistory,
  getReport,
  downloadPdf,
  refreshReport,
  resendEmail,
} = require('../controllers/weeklyReportController');
const { admission } = require('../services/weeklyReportAdmissionService');

router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.post('/generate', protect, admission('generate', 6), generateReport);
router.get('/latest', protect, getLatestReport);
router.get('/history', protect, getReportHistory);
router.get('/:id/pdf', protect, admission('pdf', 12), downloadPdf);
router.get('/:id', protect, getReport);
router.post('/:id/refresh', protect, admission('refresh', 3), refreshReport);
router.post('/:id/resend-email', protect, admission('resend', 6), resendEmail);

module.exports = router;
