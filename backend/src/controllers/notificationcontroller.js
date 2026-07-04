const Notification = require('../models/notification');
const Membership = require('../models/membership');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const {
  resolveOrganizationRole,
  resolveTeamRole,
  isRoleAtLeast
} = require('../services/tenantService');
const {
  notificationEvents,
  emitNotificationEvent
} = require('../services/notificationService');

const NOTIFICATION_TYPES = new Set(['profile_update', 'resume_upload', 'github_update', 'low_score', 'career_update', 'system', 'info', 'warning', 'success', 'error']);
const NOTIFICATION_PROJECTION = '_id userId type title message dedupeKey meta isRead createdAt updatedAt';
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const collectAllowedUserIds = async ({ organizationId, teamId, requesterId, includeAllOrgs }) => {
  if (!organizationId) {
    if (!includeAllOrgs) {
      return { role: 'member', allowedUserIds: [String(requesterId)] };
    }

    const memberships = await Membership.find({ userId: requesterId, status: 'active' })
      .select('organizationId role')
      .lean();

    const orgRoles = memberships.reduce((acc, m) => {
      const orgId = String(m.organizationId || '');
      if (!orgId) return acc;
      acc.set(orgId, acc.has(orgId) ? acc.get(orgId) : m.role);
      return acc;
    }, new Map());

    if (!orgRoles.size) {
      return { role: 'member', allowedUserIds: [String(requesterId)] };
    }

    const orgIds = Array.from(orgRoles.keys());
    const orgMembers = await Membership.find({ organizationId: { $in: orgIds }, status: 'active' })
      .select('organizationId userId role')
      .lean();

    const allowedUserIds = [];
    orgMembers.forEach((m) => {
      const orgRole = orgRoles.get(String(m.organizationId));
      if (!orgRole) return;
      if (orgRole === 'member') {
        if (String(m.userId) === String(requesterId) && !allowedUserIds.includes(String(m.userId))) {
          allowedUserIds.push(String(m.userId));
        }
        return;
      }
      if (orgRole === 'manager' && m.role === 'admin' && String(m.userId) !== String(requesterId)) {
        return;
      }
      if (!allowedUserIds.includes(String(m.userId))) {
        allowedUserIds.push(String(m.userId));
      }
    });

    return { role: 'admin', allowedUserIds };
  }

  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    return { error: { status: 400, message: 'organizationId is invalid.' } };
  }

  const orgRole = await resolveOrganizationRole(requesterId, organizationId);
  if (!orgRole) {
    return { error: { status: 403, message: 'You do not have access to this organization.' } };
  }

  if (orgRole === 'member') {
    return { role: orgRole, allowedUserIds: [String(requesterId)] };
  }

  if (teamId) {
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return { error: { status: 400, message: 'teamId is invalid.' } };
    }

    const teamRole = await resolveTeamRole(requesterId, teamId);
    if (!teamRole || !isRoleAtLeast(teamRole.role, 'manager')) {
      return { error: { status: 403, message: 'Insufficient team role.' } };
    }

    const teamMembers = await Membership.find({ teamId, status: 'active' })
      .select('userId')
      .lean();
    const allowedUserIds = teamMembers.map((m) => String(m.userId));
    return { role: orgRole, allowedUserIds };
  }

  if (orgRole === 'manager') {
    return { role: orgRole, allowedUserIds: [String(requesterId)] };
  }

  const orgMembers = await Membership.find({ organizationId, status: 'active' })
    .select('userId role')
    .lean();
  const allowedUserIds = orgMembers.map((m) => String(m.userId));
  return { role: orgRole, allowedUserIds, orgMembers };
};

const getNotifications = async (req, res) => {
  try {
    const rawPage = req.query.page === undefined ? 1 : Number(req.query.page);
    const rawLimit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(rawPage) || rawPage < 1 || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      return res.status(400).json({ message: 'page and limit must be positive integers; limit cannot exceed 50.' });
    }
    const page = rawPage;
    const limit = rawLimit;
  const organizationId = String(req.query.organizationId || '').trim();
  const teamId = String(req.query.teamId || '').trim();
    const search = String(req.query.search || '').trim();
    const roleFilter = String(req.query.role || '').trim().toLowerCase();
    const typeFilter = String(req.query.type || '').trim();
    const requestedUserId = String(req.query.userId || '').trim();
    const unreadOnly = String(req.query.unread || '').toLowerCase() === 'true';
  const includeAllOrgs = String(req.query.includeAllOrgs || '').toLowerCase() === 'true';

    if (requestedUserId && !mongoose.Types.ObjectId.isValid(requestedUserId)) {
      return res.status(400).json({ message: 'userId is invalid.' });
    }
    if (typeFilter && !NOTIFICATION_TYPES.has(typeFilter)) {
      return res.status(400).json({ message: 'type is invalid.' });
    }
    if (search.length > 100) {
      return res.status(400).json({ message: 'search cannot exceed 100 characters.' });
    }

  const scope = await collectAllowedUserIds({ organizationId, teamId, requesterId: req.user._id, includeAllOrgs });
    if (scope.error) {
      return res.status(scope.error.status).json({ message: scope.error.message });
    }

    let allowedUserIds = scope.allowedUserIds || [String(req.user._id)];
    if (scope.role === 'admin' && roleFilter && Array.isArray(scope.orgMembers)) {
      const filtered = scope.orgMembers
        .filter((m) => String(m.role || '').toLowerCase() === roleFilter)
        .map((m) => String(m.userId));
      allowedUserIds = allowedUserIds.filter((id) => filtered.includes(id));
    }

    if (requestedUserId) {
      if (!allowedUserIds.includes(requestedUserId)) {
        return res.status(403).json({ message: 'You do not have access to this user notifications.' });
      }
      allowedUserIds = [requestedUserId];
    }

    const filter = {
      userId: { $in: allowedUserIds }
    };

    if (typeFilter) {
      filter.type = typeFilter;
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ title: regex }, { message: regex }];
    }

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if ((req.query.from && !from) || (req.query.to && !to) || (from && to && from > to)) {
      return res.status(400).json({ message: 'Date range is invalid.' });
    }
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    if (unreadOnly) {
      filter.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .select(NOTIFICATION_PROJECTION)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({
        userId: { $in: allowedUserIds },
        isRead: false
      })
    ]);

    res.json({
      notifications,
      unreadCount,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    console.error('Get notifications error:', error.message);
    res.status(500).json({ message: 'Failed to fetch notifications.' });
  }
};

const canAccessNotification = async (req, notification) => {
  if (!notification) return { allowed: false };
  const ownerId = String(notification.userId || '');
  const requesterId = String(req.user._id || '');
  if (ownerId === requesterId) {
    return { allowed: true };
  }

  const organizationId = String(req.query.organizationId || req.body.organizationId || '').trim();
  const teamId = String(req.query.teamId || req.body.teamId || '').trim();
  if (!organizationId) {
    return { allowed: false };
  }

  const scope = await collectAllowedUserIds({ organizationId, teamId, requesterId: req.user._id });
  if (scope.error) {
    return { allowed: false, error: scope.error };
  }

  const allowed = (scope.allowedUserIds || []).includes(ownerId);
  return { allowed };
};

const markNotificationRead = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Notification id is invalid.' });
    const existing = await Notification.findById(req.params.id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    const access = await canAccessNotification(req, existing);
    if (!access.allowed) {
      return res.status(access.error?.status || 403).json({ message: access.error?.message || 'Not authorized.' });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { isRead: true } },
      { returnDocument: 'after' }
    ).lean();

    emitNotificationEvent(existing.userId, 'read');

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

const deleteNotification = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Notification id is invalid.' });
    const existing = await Notification.findById(req.params.id).lean();
    if (!existing) {
      return res.json({ message: 'Notification already deleted.' });
    }

    const access = await canAccessNotification(req, existing);
    if (!access.allowed) {
      return res.status(access.error?.status || 403).json({ message: access.error?.message || 'Not authorized.' });
    }

    await Notification.deleteOne({ _id: req.params.id });
    emitNotificationEvent(existing.userId, 'delete');

    res.json({ message: 'Notification deleted.' });
  } catch (error) {
    console.error('Delete notification error:', error.message);
    res.status(500).json({ message: 'Failed to delete notification.' });
  }
};

const streamNotifications = async (req, res) => {
  let heartbeat = null;
  let cleanedUp = false;
  let onChanged = null;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeat) clearInterval(heartbeat);
    if (onChanged) notificationEvents.off('changed', onChanged);
  };

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
    console.info('Notification SSE connected', { userId });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event, payload) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent('connected', { ok: true, timestamp: new Date().toISOString() });

    onChanged = (payload) => {
      if (payload?.userId !== userId) return;
      sendEvent('notification', payload);
    };

    notificationEvents.on('changed', onChanged);

    heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    req.on('close', () => {
      cleanup();
      console.info('Notification SSE disconnected', { userId });
      res.end();
    });
    res.on('error', cleanup);
  } catch (error) {
    cleanup();
    console.error('Notification stream auth error:', error.message);
    res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

module.exports = {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  streamNotifications
};
