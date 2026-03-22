const mongoose = require('mongoose');

const EmailDeliveryJob = require('../models/emailDeliveryJob');
const { sendInvitationEmail } = require('./invitationEmailService');
const { logEmailDeliveryAudit } = require('./emailAuditService');

const RETRY_INTERVAL_MS = Math.max(5000, Number.parseInt(process.env.EMAIL_RETRY_INTERVAL_MS || '30000', 10));
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const BASE_BACKOFF_MS = 60 * 1000;

let timer = null;
let isRunning = false;

const calcBackoff = (attempts) => {
  const power = Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** power));
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
      new: true,
      upsert: true
    }
  ).lean();
};

const markJobInProgress = async (jobId) => {
  const updated = await EmailDeliveryJob.findOneAndUpdate(
    {
      _id: jobId,
      status: { $in: ['pending', 'retrying'] }
    },
    {
      $set: { status: 'processing' }
    },
    { new: true }
  ).lean();

  return updated;
};

const handleSingleJob = async (job) => {
  const locked = await markJobInProgress(job._id);
  if (!locked) return;

  const result = await sendInvitationEmail(locked.payload);
  const nextAttempts = locked.attempts + 1;

  if (result.sent) {
    await EmailDeliveryJob.findByIdAndUpdate(locked._id, {
      status: 'sent',
      attempts: nextAttempts,
      sentAt: new Date(),
      lastProvider: result.provider || null,
      lastError: null
    });
  } else {
    const exhausted = nextAttempts >= locked.maxAttempts;
    const nextAttemptAt = new Date(Date.now() + calcBackoff(nextAttempts));

    await EmailDeliveryJob.findByIdAndUpdate(locked._id, {
      status: exhausted ? 'failed' : 'retrying',
      attempts: nextAttempts,
      nextAttemptAt,
      lastProvider: result.provider || null,
      lastError: result.reason || 'Email delivery failed.'
    });
  }

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
    const jobs = await EmailDeliveryJob.find({
      status: { $in: ['pending', 'retrying'] },
      nextAttemptAt: { $lte: new Date() }
    })
      .sort({ nextAttemptAt: 1 })
      .limit(5)
      .lean();

    for (const job of jobs) {
      await handleSingleJob(job);
    }
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
  startEmailRetryWorker
};
