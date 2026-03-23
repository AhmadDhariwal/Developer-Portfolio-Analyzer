const Notification = require('../models/notification');
const jwt = require('jsonwebtoken');
const {
  notificationEvents,
  emitNotificationEvent
} = require('../services/notificationService');

const getNotifications = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ userId: req.user._id, isRead: false })
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Get notifications error:', error.message);
    res.status(500).json({ message: 'Failed to fetch notifications.' });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { isRead: true } },
      { returnDocument: 'after' }
    ).lean();

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    emitNotificationEvent(req.user._id, 'read');

    res.json({ message: 'Notification marked as read.', notification });
  } catch (error) {
    console.error('Mark notification read error:', error.message);
    res.status(500).json({ message: 'Failed to mark notification as read.' });
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );

    emitNotificationEvent(req.user._id, 'read_all');

    res.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('Mark all notifications read error:', error.message);
    res.status(500).json({ message: 'Failed to mark all notifications as read.' });
  }
};

const streamNotifications = async (req, res) => {
  let heartbeat = null;

  try {
    const token = req.query.token;
    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web'
    });
    const userId = String(decoded.id || '');
    if (!userId) {
      return res.status(401).json({ message: 'Not authorized, invalid token' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event, payload) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent('connected', { ok: true, timestamp: new Date().toISOString() });

    const onChanged = (payload) => {
      if (payload?.userId !== userId) return;
      sendEvent('notification', payload);
    };

    notificationEvents.on('changed', onChanged);

    heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    req.on('close', () => {
      if (heartbeat) clearInterval(heartbeat);
      notificationEvents.off('changed', onChanged);
      res.end();
    });
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    console.error('Notification stream auth error:', error.message);
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

module.exports = {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  streamNotifications
};
