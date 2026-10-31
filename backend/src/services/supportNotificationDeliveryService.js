const { randomUUID } = require('node:crypto');
const Ticket = require('../models/supportTicket');
const metrics = require('./notificationMetrics');
let running = false;

async function processDue(send = require('./emailService').sendConfiguredEmail) {
  if (running) return;
  running = true;
  try {
    await metrics.recordBacklog('support', Ticket);
    // SMTP cannot prove whether an interrupted send was accepted. Preserve the
    // ambiguous receipt for operator reconciliation; never blindly send twice.
    const expired = await Ticket.find({
      'emailDelivery.status': 'processing',
      'emailDelivery.leaseUntil': { $lte: new Date() }
    })
      .select('_id')
      .limit(5)
      .maxTimeMS(2000)
      .lean();
    await Ticket.updateMany(
      {
        _id: { $in: expired.map((ticket) => ticket._id) },
        'emailDelivery.status': 'processing',
        'emailDelivery.leaseUntil': { $lte: new Date() }
      },
      {
        $set: {
          'emailDelivery.status': 'uncertain',
          'emailDelivery.lastError': 'Delivery interrupted; verify provider receipt before retry.'
        }
      }
    ).maxTimeMS(2000);
    if (!String(process.env.SUPPORT_INBOX_EMAIL || '').trim()) return;
    const tickets = await Ticket.find({
      'emailDelivery.status': { $in: ['pending', 'retrying'] },
      'emailDelivery.nextAttemptAt': { $lte: new Date() }
    })
      .select('_id')
      .sort({ 'emailDelivery.nextAttemptAt': 1 })
      .limit(5)
      .maxTimeMS(2000)
      .lean();
    for (const item of tickets) {
      const leaseId = randomUUID();
      const ticket = await Ticket.findOneAndUpdate(
        { _id: item._id, 'emailDelivery.status': { $in: ['pending', 'retrying'] } },
        {
          $set: {
            'emailDelivery.status': 'processing',
            'emailDelivery.leaseId': leaseId,
            'emailDelivery.leaseUntil': new Date(Date.now() + 120000)
          },
          $inc: { 'emailDelivery.attempts': 1 }
        },
        { returnDocument: 'after' }
      ).lean();
      if (!ticket) continue;
      const filter = {
        _id: ticket._id,
        'emailDelivery.leaseId': leaseId,
        'emailDelivery.status': 'processing'
      };
      if (
        !(await require('../models/user').exists({ _id: ticket.userId, isActive: { $ne: false } }))
      ) {
        await Ticket.updateOne(filter, {
          $set: {
            'emailDelivery.status': 'skipped',
            'emailDelivery.lastError': 'Account is unavailable.'
          }
        });
        continue;
      }
      try {
        await send(require('./support.service').supportEmailPayload(ticket));
        await Ticket.updateOne(filter, {
          $set: { 'emailDelivery.status': 'sent', 'emailDelivery.lastError': '' }
        });
        metrics.outcomes.inc({ operation: 'support-email', outcome: 'sent' });
      } catch (error) {
        const safeToRetry = ['EAUTH', 'ENOTFOUND', 'ECONNREFUSED'].includes(error.code);
        const status = !safeToRetry
          ? 'uncertain'
          : ticket.emailDelivery.attempts >= 5
            ? 'failed'
            : 'retrying';
        await Ticket.updateOne(filter, {
          $set: {
            'emailDelivery.status': status,
            'emailDelivery.nextAttemptAt': new Date(
              Date.now() + Math.min(3600000, 30000 * 2 ** ticket.emailDelivery.attempts)
            ),
            'emailDelivery.lastError': safeToRetry
              ? 'Provider unavailable before delivery.'
              : 'Delivery outcome unknown; reconcile with provider.'
          }
        });
        metrics.outcomes.inc({ operation: 'support-email', outcome: status });
      }
    }
  } finally {
    running = false;
  }
}
module.exports = { processDue };
