const AuditLog = require('../models/auditLog');
const User = require('../models/user');
const Membership = require('../models/membership');
const mongoose = require('mongoose');
const { resolveOrganizationRole } = require('../services/tenantService');

const toInclusiveEndDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const hasTime = text.includes('T') || text.includes(':');
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  if (hasTime) return date;
  date.setHours(23, 59, 59, 999);
  return date;
};

const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
    const requesterId = String(req.user._id);
    const organizationId = String(req.query.organizationId || '').trim();

    const filter = {};

    let actorOptions = [];
    if (organizationId) {
      if (!mongoose.Types.ObjectId.isValid(organizationId)) {
        return res.status(400).json({ message: 'organizationId is invalid.' });
      }

      const myRole = await resolveOrganizationRole(req.user._id, organizationId);
      if (!myRole) {
        return res.status(403).json({ message: 'You do not have access to this organization logs.' });
      }

      if (myRole === 'member') {
        filter.actor = req.user._id;
      } else {
        const memberships = await Membership.find({
          organizationId,
          status: 'active'
        })
          .populate('userId', 'name email githubUsername')
          .select('userId role')
          .lean();

        const allowedUserIds = [];
        memberships.forEach((m) => {
          const uid = String(m.userId?._id || '');
          if (!uid) return;
          if (myRole === 'manager' && m.role === 'admin' && uid !== requesterId) {
            return;
          }
          if (!allowedUserIds.includes(uid)) {
            allowedUserIds.push(uid);
          }
        });

        filter.actor = { $in: allowedUserIds };

        actorOptions = memberships
          .filter((m) => {
            const uid = String(m.userId?._id || '');
            if (!uid) return false;
            if (myRole === 'manager' && m.role === 'admin' && uid !== requesterId) return false;
            return true;
          })
          .map((m) => ({
            _id: String(m.userId._id),
            name: m.userId.name,
            email: m.userId.email,
            githubUsername: m.userId.githubUsername,
            role: m.role
          }));
      }
    } else {
      // Without org scope, users can only see their own activity.
      filter.actor = req.user._id;
    }

    if (req.query.actor) {
      const actorTerm = String(req.query.actor).trim();
      let requestedActors = [];
      if (mongoose.Types.ObjectId.isValid(actorTerm)) {
        requestedActors = [actorTerm];
      } else {
        const regex = new RegExp(actorTerm, 'i');
        const matchingUsers = await User.find({
          $or: [{ name: regex }, { email: regex }, { githubUsername: regex }]
        })
          .select('_id')
          .lean();
        requestedActors = matchingUsers.map((u) => String(u._id));
      }

      if (filter.actor && typeof filter.actor === 'object' && Array.isArray(filter.actor.$in)) {
        const allowed = new Set(filter.actor.$in.map((id) => String(id)));
        requestedActors = requestedActors.filter((id) => allowed.has(String(id)));
      }

      filter.actor = requestedActors.length > 0 ? { $in: requestedActors } : { $in: [] };
    }
    if (req.query.action) filter.action = { $regex: String(req.query.action), $options: 'i' };
    if (req.query.from || req.query.to) {
      filter.timestamp = {};
      if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
      if (req.query.to) filter.timestamp.$lte = toInclusiveEndDate(req.query.to);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actor', 'name email githubUsername')
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      logs,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      actorOptions
    });
  } catch (error) {
    console.error('Get audit logs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch audit logs.' });
  }
};

module.exports = { getAuditLogs };
