const mongoose = require('mongoose');
const Notification = require('../models/notification');
const State = require('../models/notificationState');
const Membership = require('../models/membership');
const Team = require('../models/team');
const User = require('../models/user');
const persistence = require('../services/notificationPersistenceService');
const { VALID_TYPES } = require('../services/notificationService');
const { streamNotifications } = require('../services/notificationStreamService');
const metrics = require('../services/notificationMetrics');

const projection =
  '_id userId type title message meta isRead security organizationId teamId createdAt updatedAt';
const invalid = (message) => Object.assign(Error(message), { status: 400 });
const denied = () => Object.assign(Error('Notification scope is not authorized.'), { status: 403 });
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function scope(req, session, lockMembership = false) {
  const source = { ...req.body, ...req.query };
  const userId = String(req.user._id);
  if (source.userId && String(source.userId) !== userId) throw denied();
  const filter = { userId: req.user._id };
  const organizationId = String(source.organizationId || '');
  const teamId = String(source.teamId || '');
  if (teamId && !organizationId) throw invalid('teamId requires organizationId.');
  if (!organizationId) {
    const memberships = await Membership.find({ userId, status: 'active' })
      .limit(201)
      .session(session || null)
      .lean();
    if (memberships.length > 200)
      throw Object.assign(Error('Notification membership capacity exceeded.'), { status: 503 });
    const orgIds = memberships.map((member) => member.organizationId);
    const adminOrgs = memberships
      .filter((member) => member.role === 'admin' && !member.teamId)
      .map((member) => member.organizationId);
    const teamIds = memberships.filter((member) => member.teamId).map((member) => member.teamId);
    filter.$and = [
      {
        $or: [
          { organizationId: null },
          { organizationId: { $in: orgIds }, teamId: null },
          { organizationId: { $in: adminOrgs } },
          { organizationId: { $in: orgIds }, teamId: { $in: teamIds } }
        ]
      }
    ];
    if (session && lockMembership && memberships.length)
      await Membership.collection.updateMany(
        { _id: { $in: memberships.map((member) => member._id) }, status: 'active' },
        { $inc: { notificationMutationVersion: 1 } },
        { session }
      );
    return filter;
  }
  if (!mongoose.isValidObjectId(organizationId) || (teamId && !mongoose.isValidObjectId(teamId)))
    throw invalid('Invalid notification scope.');
  const membership = await Membership.findOne({ userId, organizationId, status: 'active' })
    .session(session || null)
    .lean();
  if (!membership) throw denied();
  if (session && lockMembership)
    await Membership.collection.updateOne(
      { _id: membership._id, status: 'active' },
      { $inc: { notificationMutationVersion: 1 } },
      { session }
    );
  filter.organizationId = organizationId;
  if (!teamId && !(membership.role === 'admin' && !membership.teamId)) {
    const teams = await Membership.find({
      userId,
      organizationId,
      status: 'active',
      teamId: { $ne: null }
    })
      .select('teamId')
      .limit(201)
      .session(session || null)
      .lean();
    if (teams.length > 200)
      throw Object.assign(Error('Notification membership capacity exceeded.'), { status: 503 });
    filter.teamId = { $in: [null, ...teams.map((member) => member.teamId)] };
  }
  if (teamId) {
    const team = await Team.findOne({ _id: teamId, organizationId, isActive: true })
      .session(session || null)
      .lean();
    if (!team) throw denied();
    if (
      !(membership.role === 'admin' && !membership.teamId) &&
      !(await Membership.exists({ userId, organizationId, teamId, status: 'active' }).session(
        session || null
      ))
    )
      throw denied();
    filter.teamId = teamId;
  }
  return filter;
}

function fail(res, error) {
  const status = [400, 401, 403, 404].includes(error.status) ? error.status : 503;
  return res
    .status(status)
    .json({ message: status === 503 ? 'Notifications temporarily unavailable.' : error.message });
}

function cursor(value) {
  if (typeof value !== 'string' || value.length > 200)
    throw invalid('Invalid notification cursor.');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!mongoose.isValidObjectId(parsed.id) || !Number.isFinite(Date.parse(parsed.at)))
      throw Error();
    return { _id: parsed.id, createdAt: new Date(parsed.at) };
  } catch {
    throw invalid('Invalid notification cursor.');
  }
}

async function countUnread(filter, session) {
  const stop = metrics.duration.startTimer({ operation: 'unread-count' });
  try {
    return await Notification.countDocuments({ ...filter, isRead: false })
      .session(session)
      .maxTimeMS(2000);
  } finally {
    stop();
  }
}

const getNotifications = async (req, res) => {
  const stop = metrics.duration.startTimer({ operation: 'inbox' });
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw invalid('page must be 1–100 and limit must be 1–50; use cursor for older history.');
    const snapshot = await persistence.transaction(async (session) => {
      const account = await User.exists({
        _id: req.user._id,
        isActive: { $ne: false },
        $expr: {
          $eq: [{ $ifNull: ['$sessionRevision', 0] }, Number(req.user.sessionRevision || 0)]
        }
      }).session(session);
      if (!account) throw Object.assign(Error('Account or session unavailable.'), { status: 401 });
      const base = await scope(req, session);
      const filter = { ...base };
      const search = String(req.query.search || '').trim();
      if (search.length > 100) throw invalid('Search cannot exceed 100 characters.');
      if (req.query.type) {
        if (!VALID_TYPES.has(req.query.type)) throw invalid('Invalid notification type.');
        filter.type = req.query.type;
      }
      if (search)
        filter.$or = [
          { title: new RegExp(escapeRegex(search), 'i') },
          { message: new RegExp(escapeRegex(search), 'i') }
        ];
      if (req.query.unread === 'true') filter.isRead = false;
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;
      if (
        (from && Number.isNaN(from.getTime())) ||
        (to && Number.isNaN(to.getTime())) ||
        (from && to && from > to)
      )
        throw invalid('Invalid date range.');
      if (from || to)
        filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
      const pageFilter = { ...filter };
      if (req.query.cursor) {
        const before = cursor(req.query.cursor);
        pageFilter.$and = [
          ...(pageFilter.$and || []),
          {
            $or: [
              { createdAt: { $lt: before.createdAt } },
              { createdAt: before.createdAt, _id: { $lt: before._id } }
            ]
          }
        ];
      }
      const notifications = await Notification.find(pageFilter)
        .select(projection)
        .sort({ createdAt: -1, _id: -1 })
        .skip(req.query.cursor ? 0 : (page - 1) * limit)
        .limit(limit)
        .session(session)
        .maxTimeMS(2000)
        .lean();
      const total = await Notification.countDocuments(filter).session(session).maxTimeMS(2000);
      const unreadCount = await countUnread(base, session);
      const filteredUnreadCount = await Notification.countDocuments({ ...filter, isRead: false })
        .session(session)
        .maxTimeMS(2000);
      const state = await State.findById(req.user._id).session(session).maxTimeMS(2000).lean();
      const last = notifications.at(-1);
      return {
        notifications,
        total,
        unreadCount,
        filteredUnreadCount,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        revision: state?.revision || 0,
        nextCursor:
          notifications.length === limit && last
            ? Buffer.from(
                JSON.stringify({ at: last.createdAt.toISOString(), id: String(last._id) })
              ).toString('base64url')
            : null
      };
    });
    res.json(snapshot);
  } catch (error) {
    fail(res, error);
  } finally {
    stop();
  }
};

async function mutate(req, work) {
  return persistence.transaction(async (session) => {
    await persistence.fence(req.user._id, session, Number(req.user.sessionRevision || 0));
    const filter = await scope(req, session, true);
    const result = await work(filter, session);
    if (result.changed) await persistence.changed(req.user._id, session);
    return result;
  });
}

const markNotificationRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw invalid('Invalid notification ID.');
    const result = await mutate(req, async (filter, session) => {
      const notification = await Notification.findOneAndUpdate(
        { ...filter, _id: req.params.id },
        { $set: { isRead: true } },
        { session, returnDocument: 'after' }
      )
        .select(projection)
        .lean();
      if (!notification) throw Object.assign(Error('Notification not found.'), { status: 404 });
      return { changed: true, notification };
    });
    res.json({ message: 'Notification marked as read.', notification: result.notification });
  } catch (error) {
    fail(res, error);
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await mutate(req, async (filter, session) => {
      const items = await Notification.find({ ...filter, isRead: false })
        .select('_id')
        .sort({ createdAt: -1, _id: -1 })
        .limit(500)
        .session(session)
        .lean();
      const updated = await Notification.updateMany(
        { ...filter, _id: { $in: items.map((item) => item._id) }, isRead: false },
        { $set: { isRead: true } },
        { session }
      );
      const remaining = await Notification.countDocuments({ ...filter, isRead: false }).session(
        session
      );
      return { changed: updated.modifiedCount, remaining };
    });
    res.json({
      message: result.remaining
        ? 'Marked up to 500 notifications as read. Repeat to continue.'
        : 'All notifications marked as read.',
      remaining: result.remaining,
      modifiedCount: result.changed
    });
  } catch (error) {
    fail(res, error);
  }
};

const deleteNotification = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw invalid('Invalid notification ID.');
    await mutate(req, async (filter, session) => {
      const result = await Notification.deleteOne({ ...filter, _id: req.params.id }, { session });
      return { changed: result.deletedCount };
    });
    // Identical response for an absent ID and another user's ID prevents enumeration.
    res.json({ message: 'Notification deleted.' });
  } catch (error) {
    fail(res, error);
  }
};

const bulkDeleteNotifications = async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id))
    )
      throw invalid('Provide 1–100 valid notification IDs.');
    const result = await mutate(req, async (filter, session) => {
      const deleted = await Notification.deleteMany({ ...filter, _id: { $in: ids } }, { session });
      return { changed: deleted.deletedCount };
    });
    res.json({ message: 'Selected notifications deleted.', deletedCount: result.changed });
  } catch (error) {
    fail(res, error);
  }
};

module.exports = {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  bulkDeleteNotifications,
  streamNotifications,
  scope
};
