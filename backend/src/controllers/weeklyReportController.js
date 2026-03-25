const WeeklyReport = require('../models/weeklyReport');
const { generateWeeklyReport } = require('../services/weeklyReportService');

// POST /api/weekly-reports/generate
const generateReport = async (req, res) => {
  try {
    const report = await generateWeeklyReport(req.user._id);
    if (!report) return res.status(404).json({ message: 'User not found.' });
    res.json(report);
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
    const limit = Number(req.query.limit || 6);
    const reports = await WeeklyReport.find({ userId: req.user._id }).sort({ weekEndDate: -1 }).limit(limit).lean();
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
