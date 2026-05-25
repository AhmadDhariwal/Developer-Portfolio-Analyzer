const WeeklyReport = require('../models/weeklyReport');
const User = require('../models/user');
const {
  generateWeeklyReport,
  sendWeeklyReportEmail,
  updateWeeklyReportEmailStatus
} = require('../services/weeklyReportService');

const parseForceRefresh = (value) => ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());

// POST /api/weekly-reports/generate
const generateReport = async (req, res) => {
  try {
    const forceRefresh = parseForceRefresh(req.query.forceRefresh ?? req.body?.forceRefresh);
    const report = await generateWeeklyReport(req.user._id, { forceRefresh });
    if (!report) return res.status(404).json({ message: 'User not found.' });

    try {
      const user = await User.findById(req.user._id).select('name email notifications').lean();
      if (user?.email && user?.notifications?.weeklyScoreReport !== false) {
        await sendWeeklyReportEmail(report, user);
      } else {
        await updateWeeklyReportEmailStatus(report._id, {
          status: 'skipped',
          error: user?.email ? 'Weekly report email notifications are disabled.' : 'No user email is configured.'
        });
      }
    } catch (emailError) {
      console.error('Weekly report email send error:', emailError.message);
    }

    const latest = await WeeklyReport.findById(report._id).lean();
    res.json(latest || report);
  } catch (error) {
    console.error('Weekly report generate error:', error.message);
    res.status(500).json({ message: 'Failed to generate weekly report.' });
  }
};

// GET /api/weekly-reports/latest
const getLatestReport = async (req, res) => {
  try {
    const report = await WeeklyReport.findOne({ userId: req.user._id }).sort({ weekEndDate: -1 }).lean();
    res.json(report || null);
  } catch (error) {
    console.error('Weekly report latest error:', error.message);
    res.status(500).json({ message: 'Failed to load weekly report.' });
  }
};

// GET /api/weekly-reports/history
const getReportHistory = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(12, Number.parseInt(req.query.limit, 10) || 6));
    const reports = await WeeklyReport.find({ userId: req.user._id })
      .sort({ weekEndDate: -1 })
      .limit(limit)
      .lean();
    res.json({ reports });
  } catch (error) {
    console.error('Weekly report history error:', error.message);
    res.status(500).json({ message: 'Failed to load report history.' });
  }
};

module.exports = {
  generateReport,
  getLatestReport,
  getReportHistory
};
