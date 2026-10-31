const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const Notification = require('../models/notification');
const Receipt = require('../models/notificationReceipt');
const User = require('../models/user');
const Membership = require('../models/membership');
const Team = require('../models/team');
const persistence = require('./notificationPersistenceService');
const metrics = require('./notificationMetrics');
const { getSettingsSnapshotSync } = require('./platformSettingsService');

const VALID_TYPES = new Set([
  'profile_update',
  'resume_upload',
  'github_update',
  'low_score',
  'career_update',
  'system',
  'info',
  'warning',
  'success',
  'error'
]);
const VALID_PREFERENCES = new Set([
  'weeklyScoreReport',
  'jobMatchAlerts',
  'skillTrendAlerts',
  'newRecommendations'
]);
const NAVIGATION = {
  profile_update: '/app/profile',
  resume_upload: '/app/resume-analyzer',
  github_update: '/app/github-analyzer',
  low_score: '/app/dashboard',
  career_update: '/app/career-sprint'
};
const SAFE_PATHS = new Set([
  ...Object.values(NAVIGATION),
  '/app/notifications',
  '/app/support',
  '/app/skill-gap',
  '/app/recommendations',
  '/app/weekly-reports',
  '/app/integrations',
  '/app/portfolio'
]);

function navigation(type, meta = {}, preferenceKey = '') {
  if (meta.ticketId) return '/app/support';
  if (meta.reportId || preferenceKey === 'weeklyScoreReport') return '/app/weekly-reports';
  if (preferenceKey === 'skillTrendAlerts') return '/app/skill-gap';
  if (preferenceKey === 'newRecommendations') return '/app/recommendations';
  if (meta.slug) return '/app/portfolio';
  return SAFE_PATHS.has(meta.target) ? meta.target : NAVIGATION[type] || '/app/notifications';
}

async function createNotification(input) {
  const { userId, type, preferenceKey = '', session, security = false } = input;
  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  if (
    !mongoose.isValidObjectId(userId) ||
    !VALID_TYPES.has(type) ||
    !title ||
    !message ||
    title.length > 160 ||
    message.length > 2000
  ) {
    throw Object.assign(Error('Invalid notification.'), { status: 400 });
  }
  if (preferenceKey && !VALID_PREFERENCES.has(preferenceKey) && preferenceKey !== 'systemAlerts') {
    throw Object.assign(Error('Invalid notification preference.'), { status: 400 });
  }
  const key = String(input.eventId || input.dedupeKey || '').trim();
  if (key.length > 300)
    throw Object.assign(Error('Notification event key is too long.'), { status: 400 });
  const receiptId = key
    ? createHash('sha256')
        .update(`${userId}:${input.organizationId || 'personal'}:${input.teamId || ''}:${key}`)
        .digest('hex')
    : '';
  const notificationId = new mongoose.Types.ObjectId();
  const write = async (activeSession) => {
    await persistence.fence(userId, activeSession);
    const user = await User.findById(userId).select('notifications').session(activeSession).lean();
    let organizationId = null;
    let teamId = null;
    if (input.organizationId || input.teamId) {
      if (
        !mongoose.isValidObjectId(input.organizationId) ||
        (input.teamId && !mongoose.isValidObjectId(input.teamId))
      )
        throw Object.assign(Error('Invalid notification scope.'), { status: 400 });
      const membership = await Membership.findOne({
        userId,
        organizationId: input.organizationId,
        status: 'active',
        ...(input.teamId ? { teamId: input.teamId } : {})
      })
        .session(activeSession)
        .lean();
      if (!membership)
        throw Object.assign(Error('Recipient is outside notification scope.'), { status: 403 });
      if (
        input.teamId &&
        !(await Team.exists({
          _id: input.teamId,
          organizationId: input.organizationId,
          isActive: true
        }).session(activeSession))
      )
        throw Object.assign(Error('Invalid notification team.'), { status: 403 });
      await Membership.collection.updateOne(
        { _id: membership._id, status: 'active' },
        { $inc: { notificationMutationVersion: 1 } },
        { session: activeSession }
      );
      organizationId = input.organizationId;
      teamId = input.teamId || null;
    }
    const now = new Date();
    const receipt = receiptId
      ? await Receipt.findById(receiptId).session(activeSession).lean()
      : null;
    if (receipt && (!receipt.until || receipt.until > now)) {
      metrics.outcomes.inc({ operation: 'create', outcome: 'duplicate' });
      return Notification.findById(receipt.notificationId).session(activeSession).lean();
    }
    if (
      !security &&
      ((preferenceKey === 'systemAlerts' &&
        getSettingsSnapshotSync()?.notifications?.systemAlerts === false) ||
        (VALID_PREFERENCES.has(preferenceKey) && user?.notifications?.[preferenceKey] === false))
    ) {
      if (input.eventId)
        await Receipt.updateOne(
          { _id: receiptId },
          { $set: { userId, notificationId, until: null } },
          { upsert: true, session: activeSession }
        );
      metrics.outcomes.inc({ operation: 'create', outcome: 'suppressed' });
      return null;
    }
    if (receiptId) {
      const hours = Math.max(1 / 3600, Math.min(720, Number(input.dedupeWindowHours) || 12));
      const legacy =
        !input.eventId &&
        (await Notification.findOne({
          userId,
          organizationId,
          teamId,
          dedupeKey: key,
          createdAt: { $gte: new Date(now.getTime() - hours * 3600000) }
        })
          .session(activeSession)
          .lean());
      const until = input.eventId ? null : new Date(now.getTime() + hours * 3600000);
      await Receipt.updateOne(
        { _id: receiptId },
        { $set: { userId, notificationId: legacy?._id || notificationId, until } },
        { upsert: true, session: activeSession }
      );
      if (legacy) return legacy;
    }
    const meta = {};
    for (const name of [
      'ticketId',
      'reportId',
      'sprintId',
      'taskId',
      'username',
      'slug',
      'emailStatus',
      'gapCount',
      'readinessScore',
      'level',
      'streak',
      'isPublic'
    ]) {
      const value = input.meta?.[name];
      if (value !== undefined && ['string', 'number', 'boolean'].includes(typeof value))
        meta[name] = typeof value === 'string' ? value.slice(0, 120) : value;
      else if (value instanceof mongoose.Types.ObjectId) meta[name] = String(value);
    }
    meta.target = navigation(type, { ...meta, target: input.meta?.target }, preferenceKey);
    const [notification] = await Notification.create(
      [
        {
          _id: notificationId,
          userId,
          type,
          title,
          message,
          dedupeKey: key,
          meta,
          isRead: false,
          security,
          organizationId,
          teamId
        }
      ],
      { session: activeSession }
    );
    await persistence.changed(userId, activeSession);
    return notification;
  };
  try {
    const result = session ? await write(session) : await persistence.transaction(write);
    metrics.outcomes.inc({ operation: 'create', outcome: session ? 'staged' : 'committed' });
    return result;
  } catch (error) {
    metrics.outcomes.inc({ operation: 'create', outcome: 'failed' });
    throw error;
  }
}
module.exports = { createNotification, VALID_TYPES, SAFE_PATHS, navigation };
