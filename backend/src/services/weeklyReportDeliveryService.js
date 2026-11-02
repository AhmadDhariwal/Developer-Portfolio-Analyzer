const { randomUUID } = require('node:crypto');
const Report = require('../models/weeklyReport');
const User = require('../models/user');
const metrics = require('./notificationMetrics');
let running = false;

async function deliver(report, user, send, { resend = false } = {}) {
  if (!report?._id) return { sent: false, reason: 'Missing report.' };
  const current = await Report.findById(report._id).lean();
  if (!current) return { sent: false, reason: 'Report unavailable.' };
  const state = current.emailDelivery || {};
  const hash = current.meta?.reportHash || 'legacy';
  if (state.status === 'processing') {
    if (state.leaseUntil <= new Date())
      await Report.updateOne(
        {
          _id: current._id,
          'emailDelivery.leaseId': state.leaseId,
          'emailDelivery.status': 'processing'
        },
        { $set: { 'emailDelivery.status': 'uncertain' } }
      );
    return { sent: false, reason: 'Delivery requires reconciliation or is already processing.' };
  }
  if (state.status === 'uncertain')
    return { sent: false, reason: 'Verify provider delivery before resending.' };
  if (
    !resend &&
    (current.emailStatus === 'sent' || (state.status === 'sent' && state.contentHash === hash))
  )
    return { sent: false, reason: 'Report email already sent.' };
  if (state.contentHash === hash && (state.attempts >= 5 || state.nextAttemptAt > new Date()))
    return { sent: false, reason: 'Delivery backoff or attempt limit reached.' };
  const recipient = await User.findOne({ _id: current.userId, isActive: { $ne: false } })
    .select('email name notifications')
    .lean();
  if (!recipient?.email || recipient.notifications?.weeklyScoreReport === false) {
    await Report.updateOne({ _id: current._id }, { $set: { 'emailDelivery.status': 'skipped' } });
    return { sent: false, reason: 'Recipient or preference unavailable.' };
  }
  const leaseId = randomUUID();
  const claimed = await Report.findOneAndUpdate(
    {
      _id: current._id,
      'meta.reportHash': current.meta?.reportHash || null,
      'emailDelivery.leaseId': state.leaseId || null,
      'emailDelivery.status': { $nin: ['processing', 'uncertain'] }
    },
    {
      $set: {
        emailDelivery: {
          status: 'processing',
          leaseId,
          contentHash: hash,
          leaseUntil: new Date(Date.now() + 120000),
          attempts: state.contentHash === hash ? Number(state.attempts || 0) + 1 : 1
        }
      }
    },
    { returnDocument: 'after' }
  ).lean();
  if (!claimed)
    return { sent: false, reason: 'Another worker owns delivery or the report changed.' };
  const filter = {
    _id: current._id,
    'emailDelivery.leaseId': leaseId,
    'emailDelivery.status': 'processing'
  };
  let timeout;
  try {
    const result = await Promise.race([
      send(claimed, recipient, { resend }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('Delivery outcome unknown.')), 30000);
      })
    ]);
    await Report.updateOne(filter, {
      $set: { 'emailDelivery.status': result.sent ? 'sent' : 'skipped' }
    });
    metrics.outcomes.inc({ operation: 'weekly-email', outcome: result.sent ? 'sent' : 'skipped' });
    return result;
  } catch (error) {
    const safeToRetry =
      ['EAUTH', 'ENOTFOUND', 'ECONNREFUSED'].includes(error.code) ||
      [400, 401, 403, 429].includes(
        Number(error.response?.statusCode || error.response?.status || error.code)
      );
    const status = safeToRetry
      ? claimed.emailDelivery.attempts >= 5
        ? 'failed'
        : 'retrying'
      : 'uncertain';
    await Report.updateOne(filter, {
      $set: {
        'emailDelivery.status': status,
        'emailDelivery.nextAttemptAt': new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** claimed.emailDelivery.attempts)
        )
      }
    });
    metrics.outcomes.inc({ operation: 'weekly-email', outcome: status });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function processDue() {
  if (running) return;
  running = true;
  try {
    await metrics.recordBacklog('weekly', Report);
    // New report generation remains available while an earlier send is unresolved.
    // Ordinary email intent coalesces to the latest content. A known outcome
    // releases the next intent; an uncertain outcome remains an operator gate.
    const waiting = await Report.find({
      'emailDelivery.pendingContentHash': { $type: 'string' },
      'emailDelivery.status': { $in: ['sent', 'failed', 'skipped'] }
    })
      .limit(5)
      .maxTimeMS(2000)
      .lean();
    for (const report of waiting) {
      const pending = report.emailDelivery.pendingContentHash;
      if (report.meta?.reportHash !== pending) continue;
      await Report.updateOne(
        {
          _id: report._id,
          'meta.reportHash': pending,
          'emailDelivery.pendingContentHash': pending,
          'emailDelivery.leaseId': report.emailDelivery.leaseId || null
        },
        {
          $set: {
            emailDelivery: {
              status: 'pending',
              contentHash: pending,
              attempts: 0,
              nextAttemptAt: new Date()
            }
          }
        }
      );
    }
    const expired = await Report.find({
      'emailDelivery.status': 'processing',
      'emailDelivery.leaseUntil': { $lte: new Date() }
    })
      .select('_id')
      .limit(5)
      .maxTimeMS(2000)
      .lean();
    await Report.updateMany(
      {
        _id: { $in: expired.map((report) => report._id) },
        'emailDelivery.status': 'processing',
        'emailDelivery.leaseUntil': { $lte: new Date() }
      },
      { $set: { 'emailDelivery.status': 'uncertain' } }
    );
    const reports = await Report.find({
      'emailDelivery.status': { $in: ['pending', 'retrying'] },
      'emailDelivery.nextAttemptAt': { $lte: new Date() }
    })
      .sort({ 'emailDelivery.nextAttemptAt': 1 })
      .limit(5)
      .maxTimeMS(2000)
      .lean();
    for (const report of reports) {
      try {
        await require('./weeklyReportService').sendWeeklyReportEmail(report, null);
      } catch {
        /* Durable state and the originating failure notice retain the outcome. */
      }
    }
  } finally {
    running = false;
  }
}
module.exports = { deliver, processDue };
