const WeeklyReport = require('../models/weeklyReport');
const User = require('../models/user');
const {
  generateWeeklyReport,
  wasWeeklyReportSmartSkipped,
  sendWeeklyReportEmail,
  updateWeeklyReportEmailStatus,
} = require('../services/weeklyReportService');

const parseForceRefresh = (value) =>
  ['true', '1', 'yes'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  );

const snapshots = require('../services/weeklyReportSnapshotService');
const { startOfWeek, endOfWeek } = require('../services/weeklyReportCalendar');
function failure(res, error) {
  const status = [400, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 500;
  if (status === 429) res.set('Retry-After', '300');
  return res.status(status).json({ message: status === 500 ? 'Weekly report operation failed.' : error.message });
}
async function getReport(req, res) {
  try { res.json(await snapshots.getOwned(req.user._id, req.params.id, req.query.version)); }
  catch (error) { failure(res, error); }
}
async function downloadPdf(req, res) {
  try {
    const report = await snapshots.getOwned(req.user._id, req.params.id, req.query.version);
    const pdf = await require('../services/weeklyReportPdfService').render(report);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="weekly-report-${String(report._id)}-v${report.meta?.version || 1}.pdf"`);
    res.send(pdf);
  } catch (error) { failure(res, error); }
}
async function refreshReport(req, res) {
  try {
    const saved = await snapshots.getOwned(req.user._id, req.params.id);
    const start = startOfWeek();
    if (new Date(saved.weekStartDate).getTime() !== start.getTime() || new Date(saved.weekEndDate).getTime() !== endOfWeek(start).getTime()) throw snapshots.fail(409, 'Historical reporting weeks cannot be refreshed.');
    if (req.body?.contentHash !== undefined && req.body.contentHash !== saved.meta?.reportHash) throw snapshots.fail(409, 'The saved report changed. Reload before refreshing.');
    const report = await generateWeeklyReport(req.user._id, { forceRefresh: true, expectedHash: saved.meta?.reportHash, targetId: String(saved._id), emailIntent: false });
    res.json(report);
  } catch (error) { failure(res, error); }
}
async function resendEmail(req, res) {
  try {
    const saved = await snapshots.getOwned(req.user._id, req.params.id);
    if (req.body?.contentHash !== undefined && req.body.contentHash !== saved.meta?.reportHash) throw snapshots.fail(409, 'This is an archived version. Reload the saved report before resending.');
    const result = await sendWeeklyReportEmail(saved, null, { resend: true, expectedHash: saved.meta?.reportHash });
    if (!result.sent) throw snapshots.fail(409, result.reason || 'Email was not sent.');
    res.json({ sent: true, reportId: String(saved._id), contentHash: saved.meta?.reportHash });
  } catch (error) { failure(res, error); }
}

// POST /api/weekly-reports/generate
const generateReport = async (req, res) => {
  try {
    const forceRefresh = parseForceRefresh(req.query.forceRefresh ?? req.body?.forceRefresh);
    const report = await generateWeeklyReport(req.user._id, { forceRefresh, emailIntent: !forceRefresh });
    if (!report) return res.status(404).json({ message: 'User not found.' });

    try {
      const user = await User.findById(req.user._id).select('name email notifications').lean();
      if (forceRefresh || wasWeeklyReportSmartSkipped(report)) {
        // An unchanged report has already completed its email lifecycle.
      } else if (user?.email && user?.notifications?.weeklyScoreReport !== false) {
        await sendWeeklyReportEmail(report, user);
      } else {
        await updateWeeklyReportEmailStatus(report._id, {
          status: 'skipped',
          error: user?.email
            ? 'Weekly report email notifications are disabled.'
            : 'No user email is configured.',
        });
      }
    } catch (emailError) {
      console.error('Weekly report email send error:', emailError.message);
    }

    const latest = await WeeklyReport.findById(report._id).lean();
    const resolved = latest || report;
    res.json(resolved);
  } catch (error) {
    console.error('Weekly report generate error:', error.message);
    if (error.status === 503) res.set('Retry-After', '5');
    res
      .status(error.status === 503 ? 503 : 500)
      .json({ message: 'Failed to generate weekly report.' });
  }
};

// GET /api/weekly-reports/latest
const getLatestReport = async (req, res) => {
  try {
    const report = await WeeklyReport.findOne({ userId: req.user._id })
      .sort({ weekEndDate: -1 })
      .select('-__v')
      .lean();
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
      .select('-__v')
      .lean();
    res.json({ reports });
  } catch (error) {
    console.error('Weekly report history error:', error.message);
    res.status(500).json({ message: 'Failed to load report history.' });
  }
};

module.exports = {
  getReport, downloadPdf, refreshReport, resendEmail,
  generateReport,
  getLatestReport,
  getReportHistory,
};
