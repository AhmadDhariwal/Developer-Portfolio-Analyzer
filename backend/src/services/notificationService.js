const Notification = require('../models/notification');
const { EventEmitter } = require('events');

const notificationEvents = new EventEmitter();

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
  dedupeWindowHours = 12
}) => {
  if (!userId || !type || !title || !message) return null;

  if (dedupeKey) {
    const since = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000);
    const existing = await Notification.findOne({
      userId,
      dedupeKey,
      createdAt: { $gte: since }
    }).lean();

    if (existing) return existing;
  }

  const notification = await Notification.create({
    userId,
    type,
    title,
    message,
    dedupeKey,
    meta,
    isRead: false
  });

  emitNotificationEvent(userId, 'created');
  return notification;
};

module.exports = {
  createNotification,
  notificationEvents,
  emitNotificationEvent
};
