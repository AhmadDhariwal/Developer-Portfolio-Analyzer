const AuditLog = require('../models/auditLog');
const User = require('../models/user');
const Membership = require('../models/membership');
const Team = require('../models/team');
const mongoose = require('mongoose');
const { resolveOrganizationRole } = require('../services/tenantService');
const { normalizeUserRole } = require('../middleware/authmiddleware');

const MAX_DATE_RANGE_DAYS = 90;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ACTION_CATEGORY_OPTIONS = ['auth', 'organization', 'team', 'job', 'candidate', 'invitation', 'ai', 'email', 'settings', 'admin', 'recruiter', 'developer', 'system', 'other'];
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /otp/i,
  /passcode/i,
  /pwd/i,
  /pass[_-]?phrase/i,
  /private[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i
];

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
const uniqueIds = (values = []) => Array.from(new Set(values.map((value) => String(value || '')).filter(Boolean)));
const hasSensitiveKey = (key) => SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(String(key || '')));

const maskSensitiveData = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveData(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((acc, [key, currentValue]) => {
    acc[key] = hasSensitiveKey(key) ? '***MASKED***' : maskSensitiveData(currentValue);
    return acc;
  }, {});
};

const deriveActionCategory = ({ action = '', route = '' }) => {
  const haystack = `${String(action || '')} ${String(route || '')}`.toLowerCase();

  if (!haystack.trim()) return 'system';
  if (/(login|logout|auth|password|session|token|otp)/.test(haystack)) return 'auth';
  if (/(organization|tenant|console|company)/.test(haystack)) return 'organization';
  if (/(team|membership)/.test(haystack)) return 'team';
  if (/(job|jobs|role)/.test(haystack)) return 'job';
  if (/(candidate|portfolio|analysis|resume|github)/.test(haystack)) return 'candidate';
  if (/(invite|invitation)/.test(haystack)) return 'invitation';
  if (/(ai-rank|match|analysis|ai\b|openai)/.test(haystack)) return 'ai';
  if (/(email|mail|delivery)/.test(haystack)) return 'email';
  if (/(setting|preference|config)/.test(haystack)) return 'settings';
  if (/(admin|audit)/.test(haystack)) return 'admin';
  if (/(recruiter)/.test(haystack)) return 'recruiter';
  if (/(developer|public-profile|profile)/.test(haystack)) return 'developer';
  if (/(system|health|cron|background)/.test(haystack)) return 'system';
  return 'other';
};

const normalizeStatusCode = (value) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeMethod = (value) => {
  const method = String(value || '').trim().toUpperCase();
  return method || '';
};

const normalizeActionCategory = (value) => {
  const category = String(value || '').trim().toLowerCase();
  return ACTION_CATEGORY_OPTIONS.includes(category) ? category : '';
};

const buildActionCategoryClause = (category) => {
  switch (category) {
    case 'auth':
      return { $or: [{ action: /login|logout|auth|password|session|token|otp/i }, { route: /login|logout|auth|password|session|token|otp/i }] };
    case 'organization':
      return { $or: [{ action: /organization|tenant|console|company/i }, { route: /organization|tenant|console|company/i }] };
    case 'team':
      return { $or: [{ action: /team|membership/i }, { route: /team|membership/i }] };
    case 'job':
      return { $or: [{ action: /job|jobs|role/i }, { route: /job|jobs|role/i }] };
    case 'candidate':
      return { $or: [{ action: /candidate|portfolio|resume|github/i }, { route: /candidate|portfolio|resume|github/i }] };
    case 'invitation':
      return { $or: [{ action: /invite|invitation/i }, { route: /invite|invitation/i }] };
    case 'ai':
      return { $or: [{ action: /ai-rank|match|analysis|ai\b|openai/i }, { route: /ai-rank|match|analysis|ai\b|openai/i }] };
    case 'email':
      return { $or: [{ action: /email|mail|delivery/i }, { route: /email|mail|delivery/i }] };
    case 'settings':
      return { $or: [{ action: /setting|preference|config/i }, { route: /setting|preference|config/i }] };
    case 'admin':
      return { $or: [{ action: /admin|audit/i }, { route: /admin|audit/i }] };
    case 'recruiter':
      return { $or: [{ action: /recruiter/i }, { route: /recruiter/i }] };
    case 'developer':
      return { $or: [{ action: /developer|public-profile|profile/i }, { route: /developer|public-profile|profile/i }] };
    case 'system':
      return { $or: [{ actor: null }, { action: /system|health|cron|background/i }, { route: /system|health|cron|background/i }] };
    case 'other':
      return {
        $nor: [
          { action: /login|logout|auth|password|session|token|otp|organization|tenant|console|company|team|membership|job|jobs|role|candidate|portfolio|resume|github|invite|invitation|ai-rank|match|analysis|ai\b|openai|email|mail|delivery|setting|preference|config|admin|audit|recruiter|developer|public-profile|profile|system|health|cron|background/i },
          { route: /login|logout|auth|password|session|token|otp|organization|tenant|console|company|team|membership|job|jobs|role|candidate|portfolio|resume|github|invite|invitation|ai-rank|match|analysis|ai\b|openai|email|mail|delivery|setting|preference|config|admin|audit|recruiter|developer|public-profile|profile|system|health|cron|background/i },
          { actor: null }
        ]
      };
    default:
      return null;
  }
};

const sanitizeAuditLog = (log) => ({
  ...log,
  before: maskSensitiveData(log?.before),
  after: maskSensitiveData(log?.after),
  actionCategory: deriveActionCategory(log || {})
});

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
  const allowedSet = new Set(allowedUserIds.map((value) => String(value)));
  return {
    allowedUserIds,
    actorOptions: actorOptions.filter((actor) => allowedSet.has(String(actor._id || '')))
  };
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

const loadSuperAdminActorScope = async ({ requesterId, organizationId, teamId, actorTerm, roleFilter }) => {
  let effectiveOrganizationId = organizationId;

  if (teamId) {
    if (!isObjectId(teamId)) {
      const error = new Error('teamId is invalid.');
      error.statusCode = 400;
      throw error;
    }

    const team = await Team.findById(teamId).select('_id organizationId').lean();
    if (!team) {
      const error = new Error('Team not found.');
      error.statusCode = 404;
      throw error;
    }

    const teamOrganizationId = String(team.organizationId || '');
    if (effectiveOrganizationId && String(effectiveOrganizationId) !== teamOrganizationId) {
      const error = new Error('Selected team does not belong to the selected organization.');
      error.statusCode = 400;
      throw error;
    }

    effectiveOrganizationId = teamOrganizationId;
  }

  const shouldExpandScope = !!effectiveOrganizationId || !!teamId || !!actorTerm || !!roleFilter;
  if (!shouldExpandScope) {
    return {
      actorFilter: requesterId,
      actorOptions: [],
      effectiveOrganizationId: '',
      effectiveTeamId: ''
    };
  }

  if (effectiveOrganizationId && !isObjectId(effectiveOrganizationId)) {
    const error = new Error('organizationId is invalid.');
    error.statusCode = 400;
    throw error;
  }

  const scopedUserIds = new Set();

  if (effectiveOrganizationId || teamId) {
    const memberships = await Membership.find({
      status: 'active',
      ...(effectiveOrganizationId ? { organizationId: effectiveOrganizationId } : {}),
      ...(teamId ? { teamId } : {})
    }).select('userId').lean();

    memberships.forEach((membership) => {
      if (membership?.userId) scopedUserIds.add(String(membership.userId));
    });
  }

  if (effectiveOrganizationId && !teamId) {
    const orgUsers = await User.find({ organizationId: effectiveOrganizationId }).select('_id').lean();
    orgUsers.forEach((user) => {
      if (user?._id) scopedUserIds.add(String(user._id));
    });
  }

  const userQuery = {};
  if (scopedUserIds.size > 0) {
    userQuery._id = { $in: Array.from(scopedUserIds) };
  } else if (effectiveOrganizationId || teamId) {
    userQuery._id = { $in: [] };
  }

  const normalizedRole = normalizeUserRole(roleFilter);
  if (normalizedRole) {
    userQuery.role = normalizedRole;
  }

  if (actorTerm) {
    if (isObjectId(actorTerm)) {
      const actorId = String(actorTerm);
      if (userQuery._id?.$in) {
        userQuery._id = { $in: userQuery._id.$in.includes(actorId) ? [actorId] : [] };
      } else {
        userQuery._id = actorId;
      }
    } else {
      const regex = new RegExp(actorTerm, 'i');
      userQuery.$or = [{ name: regex }, { email: regex }, { githubUsername: regex }];
    }
  }

  const matchingUsers = await User.find(userQuery)
    .select('_id name email githubUsername role organizationId')
    .sort({ name: 1, email: 1, createdAt: -1 })
    .lean();

  return {
    actorFilter: { $in: uniqueIds(matchingUsers.map((user) => user._id)) },
    actorOptions: matchingUsers.map((user) => ({
      _id: String(user._id),
      name: user.name,
      email: user.email,
      githubUsername: user.githubUsername,
      role: normalizeUserRole(user.role)
    })),
    effectiveOrganizationId: effectiveOrganizationId || '',
    effectiveTeamId: teamId || ''
  };
};

const buildActionOptions = async (filter) => {
  const actions = await AuditLog.distinct('action', { ...filter, deleted: { $ne: true } }).catch(() => []);
  return actions
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
};

const capDateRange = (query) => {
  const now = new Date();
  const maxPast = new Date(now.getTime() - MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000);

  let from = query.from ? new Date(query.from) : null;
  let to = query.to ? toInclusiveEndDate(query.to) : null;

  if (from && from < maxPast) from = maxPast;
  if (to && to > now) to = now;

  if (!from && !to) {
    from = maxPast;
  }

  const timestamp = {};
  if (from) timestamp.$gte = from;
  if (to) timestamp.$lte = to;
  return timestamp;
};

const buildAuditQueryFilter = ({
  actorFilter,
  organizationId,
  teamId,
  action,
  method,
  statusCode,
  actionCategory,
  timestamp,
  includeScopeFallback = false,
  includeTeamActorFallback = false
}) => {
  const filter = { deleted: { $ne: true } };
  if (action) filter.action = String(action).trim();
  if (method) filter.method = normalizeMethod(method);
  if (statusCode) filter.statusCode = statusCode;
  if (timestamp) filter.timestamp = timestamp;
  if (organizationId) filter.organizationId = organizationId;

  if (actionCategory) {
    const clause = buildActionCategoryClause(actionCategory);
    if (clause) {
      Object.assign(filter, clause);
    }
  }

  if (includeTeamActorFallback && teamId && actorFilter) {
    filter.$or = [
      { actor: actorFilter },
      { teamId }
    ];
    return filter;
  }

  if (teamId) filter.teamId = teamId;

  if (!includeScopeFallback) {
    if (actorFilter) filter.actor = actorFilter;
    return filter;
  }

  const scopeClauses = [];
  if (actorFilter) scopeClauses.push({ actor: actorFilter });
  if (teamId) scopeClauses.push({ teamId });
  if (organizationId && !teamId) scopeClauses.push({ organizationId });

  if (scopeClauses.length <= 1) {
    if (scopeClauses[0]) Object.assign(filter, scopeClauses[0]);
    return filter;
  }

  filter.$or = scopeClauses;
  return filter;
};

const resolveAuditActorScope = async ({ req, organizationId, teamId, actorTerm, requesterId }) => {
  if (!organizationId) {
    return {
      actorFilter: requesterId,
      actorOptions: [],
      allowedUserIds: [requesterId]
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
    if (requesterRole === 'admin') {
      return {
        actorFilter: null,
        actorOptions: scope.actorOptions,
        allowedUserIds: scope.allowedUserIds
      };
    }

    return {
      actorFilter: { $in: scope.allowedUserIds },
      actorOptions: scope.actorOptions,
      allowedUserIds: scope.allowedUserIds
    };
  }

  if (requesterRole === 'member') {
    return {
      actorFilter: { $in: scope.allowedUserIds },
      actorOptions: [],
      allowedUserIds: scope.allowedUserIds
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
        actorOptions: scope.actorOptions,
        allowedUserIds: scope.allowedUserIds
      };
    }

    return {
      actorFilter: { $in: scope.allowedUserIds },
      actorOptions: scope.actorOptions,
      allowedUserIds: scope.allowedUserIds
    };
  }

  const requestedActors = await resolveRequestedActorIds({
    actorTerm,
    organizationId,
    allowedUserIds: scope.allowedUserIds
  });

  return {
    actorFilter: requestedActors.length > 0 ? { $in: requestedActors } : { $in: [] },
    actorOptions: scope.actorOptions,
    allowedUserIds: scope.allowedUserIds
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

const getAuditLogs = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
    const requesterId = String(req.user._id);
    const requesterRole = normalizeUserRole(req.user?.role);
    const organizationId = requesterRole === 'super_admin'
      ? String(req.query.organizationId || '').trim()
      : String(req.organizationId || req.user.organizationId || '').trim();
    const teamId = String(req.query.teamId || '').trim();
    const actorTerm = String(req.query.actor || '').trim();
    const roleFilter = String(req.query.role || '').trim();
    const method = normalizeMethod(req.query.method);
    const statusCode = normalizeStatusCode(req.query.statusCode);
    const actionCategory = normalizeActionCategory(req.query.actionCategory);

    const scope = requesterRole === 'super_admin'
      ? await loadSuperAdminActorScope({
          requesterId,
          organizationId,
          teamId,
          actorTerm,
          roleFilter
        })
      : await resolveAuditActorScope({
          req,
          organizationId,
          teamId,
          actorTerm,
          requesterId
        });
    const timestamp = capDateRange(req.query);
    const includeScopeFallback = requesterRole === 'super_admin' && !actorTerm && !roleFilter;
    const includeTeamActorFallback = requesterRole !== 'super_admin' && !!teamId && !!scope.actorFilter;
    const filter = buildAuditQueryFilter({
      actorFilter: scope.actorFilter,
      organizationId: requesterRole === 'super_admin' ? scope.effectiveOrganizationId : organizationId,
      teamId: requesterRole === 'super_admin' ? scope.effectiveTeamId : teamId,
      action: req.query.action,
      method,
      statusCode,
      actionCategory,
      timestamp,
      includeScopeFallback,
      includeTeamActorFallback
    });
    const optionsFilter = buildAuditQueryFilter({
      actorFilter: scope.actorFilter,
      organizationId: requesterRole === 'super_admin' ? scope.effectiveOrganizationId : organizationId,
      teamId: requesterRole === 'super_admin' ? scope.effectiveTeamId : teamId,
      method,
      statusCode,
      actionCategory,
      timestamp,
      includeScopeFallback,
      includeTeamActorFallback
    });

    const [logs, total, actionOptions] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actor', 'name email githubUsername')
        .lean(),
      AuditLog.countDocuments(filter),
      buildActionOptions(optionsFilter)
    ]);

    res.json({
      logs: logs.map((log) => sanitizeAuditLog(log)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: page < Math.max(1, Math.ceil(total / limit)),
      actorOptions: scope.actorOptions,
      actionOptions,
      actionCategoryOptions: ACTION_CATEGORY_OPTIONS,
      filters: {
        organizationId: requesterRole === 'super_admin' ? scope.effectiveOrganizationId : organizationId,
        teamId: requesterRole === 'super_admin' ? scope.effectiveTeamId : teamId,
        actor: actorTerm,
        action: String(req.query.action || '').trim(),
        method,
        statusCode,
        actionCategory,
        from: timestamp?.$gte || null,
        to: timestamp?.$lte || null
      }
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

    if (log.deleted) {
      return res.status(404).json({ message: 'Audit log already archived.' });
    }

    const requesterRole = normalizeUserRole(req.user?.role);
    const organizationId = requesterRole === 'super_admin'
      ? String(req.query.organizationId || log.organizationId || '').trim()
      : String(req.organizationId || req.user.organizationId || log.organizationId || '').trim();
    const requesterId = String(req.user._id);
    const authorization = await authorizeDeleteAuditLog({
      log,
      organizationId,
      requesterId
    });

    if (!authorization.allowed) {
      return res.status(authorization.statusCode || 403).json({ message: authorization.message });
    }

    // Soft delete: mark as deleted instead of removing
    await AuditLog.updateOne(
      { _id: req.params.id },
      { $set: { deleted: true, deletedAt: new Date() } }
    );
    return res.json({ message: 'Audit log archived.' });
  } catch (error) {
    console.error('Delete audit log error:', error.message);
    return res.status(500).json({ message: 'Failed to archive audit log.' });
  }
};

module.exports = { getAuditLogs, deleteAuditLog };
