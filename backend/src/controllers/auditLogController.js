const AuditLog = require('../models/auditLog');
const User = require('../models/user');
const Membership = require('../models/membership');
const Team = require('../models/team');
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

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const loadOrganizationActorScope = async ({ organizationId, teamId, requesterRole, requesterId }) => {
  if (teamId) {
    if (!isObjectId(teamId)) {
      const error = new Error('teamId is invalid.');
      error.statusCode = 400;
      throw error;
    }

    const team = await Team.findOne({ _id: teamId, organizationId }).select('_id').lean();
    if (!team) {
      const error = new Error('Team not found in this organization.');
      error.statusCode = 404;
      throw error;
    }
  }

  const memberships = await Membership.find({
    organizationId,
    status: 'active',
    ...(teamId ? { teamId } : {})
  })
    .populate('userId', 'name email githubUsername')
    .select('userId role teamId')
    .lean();

  const allowedUserIds = [];
  const actorOptions = [];
  const actorOptionMap = new Map();

  const pushActorOption = (entry) => {
    const uid = String(entry?._id || '');
    if (!uid || actorOptionMap.has(uid)) return;
    actorOptionMap.set(uid, {
      _id: uid,
      name: entry.name,
      email: entry.email,
      githubUsername: entry.githubUsername,
      role: entry.role
    });
  };

  memberships.forEach((membership) => {
    const uid = String(membership.userId?._id || '');
    if (!uid) return;
    if (requesterRole === 'manager' && membership.role === 'admin' && uid !== requesterId) return;
    if (!allowedUserIds.includes(uid)) {
      allowedUserIds.push(uid);
    }
    pushActorOption({
      _id: uid,
      name: membership.userId.name,
      email: membership.userId.email,
      githubUsername: membership.userId.githubUsername,
      role: membership.role
    });
  });

  if (!teamId) {
    // Include org-scoped admin/recruiter users even when they do not have a team membership.
    const orgUsers = await User.find({ organizationId })
      .select('_id name email githubUsername role')
      .lean();

    orgUsers.forEach((user) => {
      const uid = String(user?._id || '');
      if (!uid) return;
      if (requesterRole === 'manager' && String(user.role || '') === 'admin' && uid !== requesterId) return;
      if (!allowedUserIds.includes(uid)) {
        allowedUserIds.push(uid);
      }
      pushActorOption(user);
    });
  }

  const requesterUser = await User.findById(requesterId)
    .select('_id name email githubUsername role')
    .lean();
  if (requesterUser) {
    if (!allowedUserIds.includes(String(requesterUser._id))) {
      allowedUserIds.push(String(requesterUser._id));
    }
    pushActorOption(requesterUser);
  }

  if (requesterRole === 'member') {
    return { allowedUserIds: [requesterId], actorOptions: [] };
  }

  actorOptionMap.forEach((value) => actorOptions.push(value));
  return { allowedUserIds, actorOptions };
};

const resolveRequestedActorIds = async ({ actorTerm, organizationId, allowedUserIds }) => {
  if (!actorTerm) return [];

  if (isObjectId(actorTerm)) {
    const candidateId = String(actorTerm);
    if (allowedUserIds.length > 0 && !allowedUserIds.includes(candidateId)) {
      return [];
    }
    return [candidateId];
  }

  const regex = new RegExp(actorTerm, 'i');
  const query = {
    $or: [{ name: regex }, { email: regex }, { githubUsername: regex }]
  };

  if (organizationId) {
    query.organizationId = organizationId;
  }

  if (allowedUserIds.length > 0) {
    query._id = { $in: allowedUserIds };
  }

  const matchingUsers = await User.find(query).select('_id').lean();
  return matchingUsers.map((user) => String(user._id));
};

const resolveAuditActorScope = async ({ req, organizationId, teamId, actorTerm, requesterId }) => {
  if (!organizationId) {
    return {
      actorFilter: requesterId,
      actorOptions: []
    };
  }

  if (!isObjectId(organizationId)) {
    const error = new Error('organizationId is invalid.');
    error.statusCode = 400;
    throw error;
  }

  const requesterRole = await resolveOrganizationRole(req.user?._id, organizationId);
  if (!requesterRole) {
    const error = new Error('You do not have access to this organization logs.');
    error.statusCode = 403;
    throw error;
  }

  const scope = await loadOrganizationActorScope({
    organizationId,
    teamId,
    requesterRole,
    requesterId
  });
  const shouldExpandScope = !!teamId || !!actorTerm;

  if (!shouldExpandScope) {
    return {
      actorFilter: requesterId,
      actorOptions: scope.actorOptions
    };
  }

  if (requesterRole === 'member') {
    return {
      actorFilter: { $in: scope.allowedUserIds },
      actorOptions: []
    };
  }

  if (teamId) {
    if (actorTerm) {
      const requestedActors = await resolveRequestedActorIds({
        actorTerm,
        organizationId,
        allowedUserIds: scope.allowedUserIds
      });
      return {
        actorFilter: requestedActors.length > 0 ? { $in: requestedActors } : { $in: [] },
        actorOptions: scope.actorOptions
      };
    }

    return {
      actorFilter: { $in: scope.allowedUserIds },
      actorOptions: scope.actorOptions
    };
  }

  const requestedActors = await resolveRequestedActorIds({
    actorTerm,
    organizationId,
    allowedUserIds: scope.allowedUserIds
  });

  return {
    actorFilter: requestedActors.length > 0 ? { $in: requestedActors } : { $in: [] },
    actorOptions: scope.actorOptions
  };
};

const authorizeDeleteAuditLog = async ({ log, organizationId, requesterId }) => {
  const actorId = log.actor ? String(log.actor) : '';

  if (!organizationId) {
    if (!actorId || actorId !== requesterId) {
      return { allowed: false, message: 'You can only delete your own activity logs.' };
    }
    return { allowed: true };
  }

  if (!isObjectId(organizationId)) {
    return { allowed: false, message: 'organizationId is invalid.', statusCode: 400 };
  }

  const requesterRole = await resolveOrganizationRole(requesterId, organizationId);
  if (!requesterRole) {
    return { allowed: false, message: 'You do not have access to this organization logs.' };
  }

  if (requesterRole === 'member') {
    if (!actorId || actorId !== requesterId) {
      return { allowed: false, message: 'You can only delete your own activity logs.' };
    }
    return { allowed: true };
  }

  if (!actorId) {
    return requesterRole === 'admin'
      ? { allowed: true }
      : { allowed: false, message: 'Only admins can delete system activity logs.' };
  }

  const membership = await Membership.findOne({
    organizationId,
    userId: actorId,
    status: 'active'
  }).select('role').lean();

  if (!membership) {
    return { allowed: false, message: 'Actor does not belong to this organization.' };
  }

  if (requesterRole === 'manager' && membership.role === 'admin' && actorId !== requesterId) {
    return { allowed: false, message: 'Managers cannot delete admin activity logs.' };
  }

  return { allowed: true };
};

// NOSONAR: scope resolution is centralized in helpers above.
const getAuditLogs = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
    const requesterId = String(req.user._id);
    const organizationId = String(req.query.organizationId || '').trim();
    const teamId = String(req.query.teamId || '').trim();
    const actorTerm = String(req.query.actor || '').trim();

    const filter = {};

    const { actorFilter, actorOptions } = await resolveAuditActorScope({
      req,
      organizationId,
      teamId,
      actorTerm,
      requesterId
    });
    filter.actor = actorFilter;

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
    res.status(error.statusCode || 500).json({ message: error.message || 'Failed to fetch audit logs.' });
  }
};

const deleteAuditLog = async (req, res) => {
  try {
    const log = await AuditLog.findById(req.params.id).lean();
    if (!log) {
      return res.status(404).json({ message: 'Audit log not found.' });
    }

    const organizationId = String(req.query.organizationId || '').trim();
    const requesterId = String(req.user._id);
    const authorization = await authorizeDeleteAuditLog({
      log,
      organizationId,
      requesterId
    });

    if (!authorization.allowed) {
      return res.status(authorization.statusCode || 403).json({ message: authorization.message });
    }

    await AuditLog.deleteOne({ _id: req.params.id });
    return res.json({ message: 'Audit log deleted.' });
  } catch (error) {
    console.error('Delete audit log error:', error.message);
    return res.status(500).json({ message: 'Failed to delete audit log.' });
  }
};

module.exports = { getAuditLogs, deleteAuditLog };
