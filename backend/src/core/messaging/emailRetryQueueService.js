const mongoose = require('mongoose');

const EmailDeliveryJob = require('./models/emailDeliveryJob');
const { sendInvitationEmail } = require('./invitationEmailService');
const { logEmailDeliveryAudit } = require('./emailAuditService');

const RETRY_INTERVAL_MS = Math.max(
  5000,
  Number.parseInt(process.env.EMAIL_RETRY_INTERVAL_MS || '30000', 10)
);
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const BASE_BACKOFF_MS = 60 * 1000;

let timer = null;
let isRunning = false;

const calcBackoff = (attempts) => {
  const power = Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** power);
};

const enqueueInvitationRetry = async ({ invitationId, to, payload, maxAttempts = 5 }) => {
  if (!invitationId || !to || !payload) return null;

  return EmailDeliveryJob.findOneAndUpdate(
    { invitationId },
    {
      $setOnInsert: {
        invitationId,
        to,
        payload,
        status: 'pending',
        attempts: 0,
        maxAttempts: Math.max(1, Math.min(20, maxAttempts)),
        nextAttemptAt: new Date(Date.now() + 15000)
      }
    },
    {
      returnDocument: 'after',
      upsert: true
    }
  ).lean();
};

const PROCESSING_LEASE_MS = 120 * 1000;
const UNCERTAIN_DELIVERY = 'Delivery outcome unknown. Automatic resend skipped.';
const staleProcessing = (now) => ({
  status: 'processing',
  nextAttemptAt: { $lte: now },
  updatedAt: { $lte: new Date(now.getTime() - PROCESSING_LEASE_MS) }
});

const markJobInProgress = async (jobId) => {
  const now = new Date();
  return EmailDeliveryJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ['pending', 'retrying'] }, nextAttemptAt: { $lte: now } },
    {
      $set: {
        status: 'processing',
        updatedAt: now,
        nextAttemptAt: new Date(now.getTime() + PROCESSING_LEASE_MS)
      }
    },
    { returnDocument: 'after', timestamps: false }
  ).lean();
};

const expireUncertainJob = (jobId, now) =>
  EmailDeliveryJob.updateOne(
    { _id: jobId, ...staleProcessing(now) },
    { $set: { status: 'failed', lastError: UNCERTAIN_DELIVERY } }
  );

const sendWithLease = async (locked, ownership) => {
  let heartbeat;
  const interval = setInterval(() => {
    if (heartbeat) return;
    const now = new Date();
    heartbeat = EmailDeliveryJob.updateOne(
      { ...ownership, nextAttemptAt: { $gt: now } },
      { $set: { nextAttemptAt: new Date(now.getTime() + PROCESSING_LEASE_MS) } },
      { timestamps: false }
    )
      .catch(() => {})
      .finally(() => {
        heartbeat = null;
      });
  }, PROCESSING_LEASE_MS / 4);
  interval.unref();

  try {
    return await sendInvitationEmail(locked.payload);
  } finally {
    clearInterval(interval);
    await heartbeat;
  }
};

const handleSingleJob = async (job) => {
  if (job.status === 'processing') {
    // A disconnected worker may already have delivered the message.
    await expireUncertainJob(job._id, new Date());
    return;
  }

  const locked = await markJobInProgress(job._id);
  if (!locked) return;

  const ownership = { _id: locked._id, status: 'processing', updatedAt: locked.updatedAt };
  const result = await sendWithLease(locked, ownership);
  const nextAttempts = locked.attempts + 1;
  const exhausted = nextAttempts >= locked.maxAttempts;
  const state = result.sent
    ? { status: 'sent', sentAt: new Date(), lastError: null }
    : {
        status: result.deliveryUncertain || exhausted ? 'failed' : 'retrying',
        nextAttemptAt: new Date(Date.now() + calcBackoff(nextAttempts)),
        lastError: result.deliveryUncertain
          ? UNCERTAIN_DELIVERY
          : result.reason || 'Email delivery failed.'
      };

  const saved = await EmailDeliveryJob.updateOne(ownership, {
    $set: { ...state, attempts: nextAttempts, lastProvider: result.provider || null }
  });
  if (!saved.matchedCount) return;

  await logEmailDeliveryAudit({
    actor: locked.payload.actorId || null,
    organizationId: locked.payload.organizationId,
    teamId: locked.payload.teamId,
    invitationId: String(locked.invitationId),
    email: locked.to,
    role: locked.payload.role,
    provider: result.provider,
    result,
    attemptType: 'retry',
    attemptNumber: nextAttempts
  });
};

const processDueJobs = async () => {
  if (isRunning) return;
  if (mongoose.connection.readyState !== 1) return;

  isRunning = true;

  try {
    const now = new Date();
    const jobs = await EmailDeliveryJob.find({
      $or: [
        { status: { $in: ['pending', 'retrying'] }, nextAttemptAt: { $lte: now } },
        staleProcessing(now)
      ]
    })
      .sort({ nextAttemptAt: 1 })
      .limit(5)
      .lean();

    for (const job of jobs) {
      await handleSingleJob(job);
    }
    await require('../../modules/support/services/supportNotificationDeliveryService').processDue();
    await require('../../modules/weekly-reports/services/weeklyReportDeliveryService').processDue();
  } catch (error) {
    console.error('Email retry worker error:', error.message);
  } finally {
    isRunning = false;
  }
};

const startEmailRetryWorker = () => {
  if (timer) return;

  timer = setInterval(() => {
    processDueJobs().catch((error) => {
      console.error('Email retry worker tick failed:', error.message);
    });
  }, RETRY_INTERVAL_MS);

  // Avoid keeping process alive only for this timer.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log(`Email retry worker started. Interval: ${RETRY_INTERVAL_MS}ms`);
};

module.exports = {
  enqueueInvitationRetry,
  markJobInProgress,
  processDueJobs,
  startEmailRetryWorker
};
