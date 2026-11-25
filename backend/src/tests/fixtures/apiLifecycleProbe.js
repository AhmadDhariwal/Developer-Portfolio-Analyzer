// Windows does not deliver POSIX signals to detached Node children. Exercise the
// registered handlers through IPC there. Unix runners send actual OS signals.
const emailMode = process.env.P02_EMAIL_LIFECYCLE === 'true';
let releaseDelivery;
if (emailMode) {
  const delivery = new Promise((resolve) => {
    releaseDelivery = resolve;
  });
  require('../../core/messaging/invitationEmailService').sendInvitationEmail = () => {
    process.send({ phase: 'delivery-started' });
    return delivery;
  };
  require('../../modules/jobs/services/jobService').refreshJobCache = async () => ({
    skipped: true
  });
}
process.on('message', async ({ signal, op }) => {
  if (op === 'expire-settings') {
    const settings = require('../../modules/super-admin/services/platformSettingsService');
    settings.stopSettingsSynchronization();
    await settings.getSettings();
    const now = Date.now;
    Date.now = () => now() + 31000;
    process.send({ phase: 'settings-expired' });
    return;
  }
  if (op === 'enqueue' && emailMode) {
    const mongoose = require('mongoose');
    const jobs = require('../../core/messaging/emailRetryQueueService');
    const model = require('../../core/messaging/models/emailDeliveryJob');
    const job = await jobs.enqueueInvitationRetry({
      invitationId: new mongoose.Types.ObjectId(),
      to: 'fixture@example.test',
      payload: { role: 'admin' }
    });
    await model.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date(0) } });
    process.send({ phase: 'queued', jobId: String(job._id) });
    return;
  }
  if (op === 'release' && emailMode) {
    releaseDelivery({ sent: true, provider: 'fixture' });
    process.disconnect();
    return;
  }
  if (process.platform !== 'win32' || !['SIGTERM', 'SIGINT'].includes(signal)) return;
  process.emit(signal);
  process.emit(signal);
  if (!emailMode) process.disconnect();
});
require('../../../index.js');
