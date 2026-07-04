const Notification = require('../models/notification');
const User = require('../models/user');
const { EventEmitter } = require('events');
const { getSettingsSnapshotSync } = require('./platformSettingsService');

const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(0);
const dedupeInflight = new Map();
const VALID_TYPES = new Set(['profile_update', 'resume_upload', 'github_update', 'low_score', 'career_update', 'system', 'info', 'warning', 'success', 'error']);
const VALID_PREFERENCES = new Set(['weeklyScoreReport', 'jobMatchAlerts', 'skillTrendAlerts', 'newRecommendations']);

const emitNotificationEvent = (userId, eventType = 'updated') => {
  if (!userId) return;
  notificationEvents.emit('changed', {
    userId: String(userId),
    eventType,
    timestamp: new Date().toISOString()
  });
};

const createNotification = async ({
  userId,
  type,
  title,
  message,
  dedupeKey = '',
  meta = {},
  dedupeWindowHours = 12,
  preferenceKey = ''
}) => {
  try {
    if (!userId || !VALID_TYPES.has(type) || !String(title || '').trim() || !String(message || '').trim()) return null;

    if (preferenceKey === 'systemAlerts') {
      if (getSettingsSnapshotSync()?.notifications?.systemAlerts === false) return null;
    } else if (VALID_PREFERENCES.has(preferenceKey)) {
      const user = await User.findById(userId).select(`notifications.${preferenceKey}`).lean();
      if (user?.notifications?.[preferenceKey] === false) return null;
    }

    const safeDedupeKey = String(dedupeKey || '').trim().slice(0, 180);
    const inflightKey = safeDedupeKey ? `${String(userId)}:${safeDedupeKey}` : '';
    if (inflightKey && dedupeInflight.has(inflightKey)) return dedupeInflight.get(inflightKey);

    const create = async () => {
      if (safeDedupeKey) {
        const safeWindowHours = Math.max(0, Math.min(24 * 30, Number(dedupeWindowHours) || 12));
        const since = new Date(Date.now() - safeWindowHours * 60 * 60 * 1000);
        const existing = await Notification.findOne({
          userId,
          dedupeKey: safeDedupeKey,
          createdAt: { $gte: since }
        }).select('_id userId type title message dedupeKey meta isRead createdAt updatedAt').lean();

        if (existing) return existing;
      }

      const notification = await Notification.create({
        userId,
        type,
        title: String(title).trim(),
        message: String(message).trim(),
        dedupeKey: safeDedupeKey,
        meta,
        isRead: false
      });

      emitNotificationEvent(userId, 'created');
      return notification;
    };

    const request = create().finally(() => {
      if (inflightKey) dedupeInflight.delete(inflightKey);
    });
    if (inflightKey) dedupeInflight.set(inflightKey, request);
    return await request;
  } catch (error) {
    console.warn('Notification creation skipped:', error.message);
    return null;
  }
};

module.exports = {
  createNotification,
  notificationEvents,
  emitNotificationEvent
};
