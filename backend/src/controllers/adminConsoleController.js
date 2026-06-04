/**
 * Admin Console Controller
 * Organization-scoped endpoints for the org admin console.
 * All handlers assume req.organizationId is set by requireOrganizationContext middleware.
 */

const { body, param, validationResult } = require('express-validator');

const User = require('../models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Invitation = require('../models/invitation');
const AuditLog = require('../models/auditLog');
const Organization = require('../models/organization');
const Analysis = require('../models/analysis');
const AnalysisCache = require('../models/analysisCache');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const { normalizeSlug } = require('../services/tenantService');

// ── helpers ───────────────────────────────────────────────────────────────
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v || 0)));
const DEFAULT_DASHBOARD_DATE_RANGE = 30;
const ALLOWED_DASHBOARD_DATE_RANGES = [7, 14, 30, 60, 90];
const DEFAULT_JOB_STATUSES = ['open', 'draft', 'closed'];

const normalizeDashboardConfig = (value = {}) => {
  const preferredDateRangeDays = Number.parseInt(String(value?.preferredDateRangeDays || DEFAULT_DASHBOARD_DATE_RANGE), 10);

  return {
    preferredDateRangeDays: ALLOWED_DASHBOARD_DATE_RANGES.includes(preferredDateRangeDays)
      ? preferredDateRangeDays
      : DEFAULT_DASHBOARD_DATE_RANGE,
    defaultTeamId: value?.defaultTeamId ? String(value.defaultTeamId) : '',
    showKpiCards: value?.showKpiCards !== false,
    showTeamAnalytics: value?.showTeamAnalytics !== false,
    showRecruiterPerformance: value?.showRecruiterPerformance !== false,
    showJobTrends: value?.showJobTrends !== false,
    showActivityFeed: value?.showActivityFeed !== false
  };
};

const validate = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({
    message: 'Validation failed.',
    errors: errors.array().map((error) => ({ field: error.path, message: error.msg }))
  });
};

const buildTeamMember = (membership) => {
  const user = membership.userId;
  if (!user?._id) return null;

  // Membership role controls team permissions (admin/member),
  // but for recruiter accounts we want to surface their account role in UI.
  const displayRole = user.role === 'recruiter' ? 'recruiter' : membership.role;

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: displayRole,
    isActive: user.isActive !== false
  };
};

const loadTeamMembers = async (organizationId, teamIds = []) => {
  if (!organizationId || teamIds.length === 0) {
    return new Map();
  }

  const memberships = await Membership.find({
    organizationId,
    teamId: { $in: teamIds },
    status: 'active'
  })
    .populate('userId', 'name email role isActive')
    .lean();

  return memberships.reduce((map, membership) => {
    const teamId = String(membership.teamId || '');
    const member = buildTeamMember(membership);
    if (!teamId || !member) {
      return map;
    }

    const current = map.get(teamId) || [];
    if (!current.some((item) => String(item._id) === String(member._id))) {
      current.push(member);
      map.set(teamId, current);
    }

    return map;
  }, new Map());
};

const hydrateTeams = async (organizationId, teams = []) => {
  const membersByTeam = await loadTeamMembers(organizationId, teams.map((team) => team._id));

  return teams.map((team) => {
    const members = membersByTeam.get(String(team._id)) || [];
    return {
      ...team,
      isActive: team.isActive !== false,
      members,
      memberCount: members.length
    };
  });
};

const normalizeRecruiterIds = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
};

const loadOrgRecruiters = async (organizationId, recruiterIds = []) => {
  if (recruiterIds.length === 0) {
    return [];
  }

  const recruiters = await User.find({
    _id: { $in: recruiterIds },
    organizationId,
    role: 'recruiter'
  })
    .select('_id')
    .lean();

  if (recruiters.length !== recruiterIds.length) {
    const error = new Error('One or more recruiters were not found in this organization.');
    error.status = 404;
    throw error;
  }

  return recruiters;
};

const upsertRecruiterTeamMemberships = async ({ organizationId, teamId, recruiterIds = [], invitedBy }) => {
  const recruiters = await loadOrgRecruiters(organizationId, recruiterIds);

  for (const recruiter of recruiters) {
    const existingMembership = await Membership.findOne({
      organizationId,
      userId: recruiter._id,
      status: 'active',
      teamId: { $ne: null }
    })
      .populate('teamId', 'name')
      .lean();

    if (existingMembership && String(existingMembership.teamId?._id || existingMembership.teamId) !== String(teamId)) {
      const assignedName = existingMembership.teamId?.name || 'another team';
      const error = new Error(`Recruiter is already assigned to ${assignedName}.`);
      error.status = 409;
      throw error;
    }

    await Membership.findOneAndUpdate(
      {
        organizationId,
        teamId,
        userId: recruiter._id
      },
      {
        $set: {
          role: 'member',
          status: 'active',
          invitedBy,
          joinedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
};

// ── GET /api/admin-console/overview ──────────────────────────────────────
const getConsoleOverview = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const activeMembershipsQuery = { organizationId: orgId, status: 'active' };
    const organizationUsersQuery = { organizationId: orgId, role: { $in: ['admin', 'recruiter'] } };

    const [
      organization,
      recruitersCount,
      activeRecruitersCount,
      teamsCount,
      activeTeamsCount,
      jobsCount,
      pendingInvitationsCount,
      memberships,
      organizationUsers
    ] = await Promise.all([
      Organization.findById(orgId).select('name slug description createdAt').lean(),
      User.countDocuments({ role: 'recruiter', organizationId: orgId }),
      User.countDocuments({ role: 'recruiter', organizationId: orgId, isActive: true }),
      Team.countDocuments({ organizationId: orgId }),
      Team.countDocuments({ organizationId: orgId, isActive: { $ne: false } }),
      Job.countDocuments({ organizationId: orgId }),
      Invitation.countDocuments({ organizationId: orgId, status: 'pending', expiresAt: { $gt: new Date() } }),
      Membership.find(activeMembershipsQuery).select('userId role').lean(),
      User.find(organizationUsersQuery).select('_id role isActive').lean()
    ]);

    const internalMemberIds = new Set();
    memberships.forEach((membership) => {
      if (membership?.userId) internalMemberIds.add(String(membership.userId));
    });
    organizationUsers.forEach((user) => {
      if (user?._id) internalMemberIds.add(String(user._id));
    });

    const adminCount = organizationUsers.filter((user) => String(user.role || '') === 'admin').length;
    const recruiterUserIds = new Set(
      organizationUsers
        .filter((user) => String(user.role || '') === 'recruiter')
        .map((user) => String(user._id))
    );
    const memberOnlyIds = new Set(
      memberships
        .filter((membership) => String(membership.role || '') === 'member')
        .map((membership) => String(membership.userId))
    );

    return res.json({
      organization,
      stats: {
        recruitersCount,
        activeRecruitersCount,
        inactiveRecruitersCount: recruitersCount - activeRecruitersCount,
        teamsCount,
        activeTeamsCount,
        jobsCount,
        pendingInvitationsCount,
        membersCount: internalMemberIds.size
      },
      membershipSummary: {
        internalMembersCount: internalMemberIds.size,
        adminCount,
        recruiterCount: recruiterUserIds.size,
        memberCount: memberOnlyIds.size,
        publicDevelopersIncluded: false
      }
    });
  } catch (error) {
    console.error('Admin console overview error:', error.message);
    return res.status(500).json({ message: 'Failed to load organization overview.' });
  }
};

// ── GET /api/admin-console/analytics ─────────────────────────────────────
const getConsoleAnalytics = async (req, res) => {
  try {
    const orgId = req.organizationId;

    // Recruiter performance: each recruiter's job count and activity
    const recruiters = await User.find({ role: 'recruiter', organizationId: orgId })
      .select('_id name email isActive createdAt')
      .lean();

    const recruiterIds = recruiters.map((r) => r._id);

    const [jobs, teams, memberships, recentInvitations] = await Promise.all([
      Job.find({ organizationId: orgId }).select('recruiterId status createdAt').lean(),
      Team.find({ organizationId: orgId }).select('_id name createdAt').lean(),
      Membership.find({ organizationId: orgId, status: 'active' })
        .select('userId teamId role')
        .lean(),
      Invitation.find({ organizationId: orgId })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('name email role status createdAt expiresAt')
        .lean()
    ]);

    // Jobs per recruiter
    const jobsByRecruiter = new Map();
    jobs.forEach((job) => {
      const key = String(job.recruiterId || '');
      if (key) jobsByRecruiter.set(key, (jobsByRecruiter.get(key) || 0) + 1);
    });

    // Members per team
    const membersByTeam = new Map();
    memberships.forEach((m) => {
      if (!m.teamId) return;
      const key = String(m.teamId);
      membersByTeam.set(key, (membersByTeam.get(key) || 0) + 1);
    });

    const recruiterPerformance = recruiters.map((r) => ({
      _id: r._id,
      name: r.name,
      email: r.email,
      isActive: r.isActive !== false,
      jobsPosted: jobsByRecruiter.get(String(r._id)) || 0,
      joinedAt: r.createdAt
    }));

    const teamSummary = teams.map((t) => ({
      _id: t._id,
      name: t.name,
      memberCount: membersByTeam.get(String(t._id)) || 0,
      createdAt: t.createdAt
    }));

    // Hiring activity: jobs by status
    const hiringActivity = {
      total: jobs.length,
      open: jobs.filter((j) => j.status === 'open').length,
      draft: jobs.filter((j) => j.status === 'draft').length,
      closed: jobs.filter((j) => j.status === 'closed').length
    };

    // Invitation funnel
    const invitationFunnel = {
      pending: recentInvitations.filter((i) => i.status === 'pending').length,
      accepted: recentInvitations.filter((i) => i.status === 'accepted').length,
      expired: recentInvitations.filter((i) => i.status === 'expired').length,
      revoked: recentInvitations.filter((i) => i.status === 'revoked').length
    };

    return res.json({
      recruiterPerformance,
      teamSummary,
      hiringActivity,
      invitationFunnel,
      recentInvitations: recentInvitations.slice(0, 10)
    });
  } catch (error) {
    console.error('Admin console analytics error:', error.message);
    return res.status(500).json({ message: 'Failed to load organization analytics.' });
  }
};

// ── GET /api/admin-console/activity ──────────────────────────────────────
const getConsoleActivity = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10));
    const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '25'), 10)));
    const skip = (page - 1) * limit;

    // Get all user IDs in this org (admin + recruiters + members)
    const orgUserIds = await Membership.find({ organizationId: orgId, status: 'active' })
      .select('userId')
      .lean()
      .then((ms) => ms.map((m) => m.userId));

    // Also include the org owner (admin user)
    const orgAdmin = await User.findOne({ organizationId: orgId, role: 'admin' }).select('_id').lean();
    if (orgAdmin) orgUserIds.push(orgAdmin._id);

    const uniqueIds = [...new Set(orgUserIds.map((id) => String(id)))];

    const [logs, total] = await Promise.all([
      AuditLog.find({ actor: { $in: uniqueIds } })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actor', 'name email role')
        .lean(),
      AuditLog.countDocuments({ actor: { $in: uniqueIds } })
    ]);

    return res.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Admin console activity error:', error.message);
    return res.status(500).json({ message: 'Failed to load organization activity.' });
  }
};

// ── GET /api/admin-console/teams ─────────────────────────────────────────
const getConsoleTeams = async (req, res) => {
  try {
    const orgId = req.organizationId;

    const teams = await Team.find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .lean();

    const enrichedTeams = await hydrateTeams(orgId, teams);

    return res.json({ teams: enrichedTeams });
  } catch (error) {
    console.error('Admin console teams error:', error.message);
    return res.status(500).json({ message: 'Failed to load teams.' });
  }
};

const createConsoleTeam = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const name = String(req.body?.name || '').trim();
    const slug = normalizeSlug(String(req.body?.slug || name));
    const description = String(req.body?.description || '').trim();
    const recruiterIds = normalizeRecruiterIds(
      req.body?.recruiterIds || (req.body?.recruiterId ? [req.body.recruiterId] : [])
    );

    if (!name) {
      return res.status(400).json({ message: 'name is required.' });
    }

    const organization = await Organization.findById(orgId).select('_id').lean();
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    const existing = await Team.findOne({ organizationId: orgId, slug }).lean();
    if (existing) {
      return res.status(409).json({ message: 'Team slug already exists in this organization.' });
    }

    const team = await Team.create({
      organizationId: orgId,
      name,
      slug,
      description,
      isActive: true,
      createdBy: req.user._id
    });

    if (recruiterIds.length > 0) {
      await upsertRecruiterTeamMemberships({
        organizationId: orgId,
        teamId: team._id,
        recruiterIds,
        invitedBy: req.user._id
      });
    }

    const [enrichedTeam] = await hydrateTeams(orgId, [team.toObject()]);
    return res.status(201).json({ team: enrichedTeam });
  } catch (error) {
    console.error('Admin console create team error:', error.message);
    return res.status(error.status || 500).json({ message: error.message || 'Failed to create team.' });
  }
};

const updateConsoleTeam = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const team = await Team.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    const updates = {};
    if (Object.hasOwn(req.body || {}, 'name')) {
      const name = String(req.body?.name || '').trim();
      if (!name) {
        return res.status(400).json({ message: 'name is required.' });
      }
      updates.name = name;
    }

    if (Object.hasOwn(req.body || {}, 'slug')) {
      const nextSlug = String(req.body?.slug || '').trim();
      if (nextSlug) {
        updates.slug = normalizeSlug(nextSlug);
      }
    }

    if (Object.hasOwn(req.body || {}, 'description')) {
      updates.description = String(req.body?.description || '').trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No team fields were provided to update.' });
    }

    if (updates.slug && updates.slug !== team.slug) {
      const duplicate = await Team.findOne({ organizationId: orgId, slug: updates.slug, _id: { $ne: team._id } }).lean();
      if (duplicate) {
        return res.status(409).json({ message: 'Team slug already exists in this organization.' });
      }
    }

    const updatedTeam = await Team.findOneAndUpdate(
      { _id: team._id, organizationId: orgId },
      { $set: updates },
      { new: true }
    ).lean();

    const [enrichedTeam] = await hydrateTeams(orgId, [updatedTeam]);
    return res.json({ team: enrichedTeam });
  } catch (error) {
    console.error('Admin console update team error:', error.message);
    return res.status(500).json({ message: 'Failed to update team.' });
  }
};

const toggleConsoleTeamActive = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const updatedTeam = await Team.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { $set: { isActive: req.body?.isActive !== false } },
      { new: true }
    ).lean();

    if (!updatedTeam) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    const [enrichedTeam] = await hydrateTeams(orgId, [updatedTeam]);
    return res.json({ team: enrichedTeam });
  } catch (error) {
    console.error('Admin console toggle team error:', error.message);
    return res.status(500).json({ message: 'Failed to update team status.' });
  }
};

const deleteConsoleTeam = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const team = await Team.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    await Promise.all([
      Team.deleteOne({ _id: team._id, organizationId: orgId }),
      Membership.deleteMany({ organizationId: orgId, teamId: team._id }),
      Invitation.updateMany(
        { organizationId: orgId, teamId: team._id, status: 'pending' },
        { $set: { status: 'revoked' } }
      )
    ]);

    return res.json({ message: 'Team deleted successfully.' });
  } catch (error) {
    console.error('Admin console delete team error:', error.message);
    return res.status(500).json({ message: 'Failed to delete team.' });
  }
};

const assignRecruiterToConsoleTeam = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const team = await Team.findOne({ _id: req.params.id, organizationId: orgId, isActive: true }).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    const recruiterId = String(req.body?.recruiterId || '').trim();
    const recruiter = await User.findOne({ _id: recruiterId, organizationId: orgId, role: 'recruiter' }).select('_id').lean();
    if (!recruiter) {
      return res.status(404).json({ message: 'Recruiter not found in this organization.' });
    }

    const existingMembership = await Membership.findOne({
      organizationId: orgId,
      userId: recruiter._id,
      status: 'active',
      teamId: { $ne: null }
    })
      .populate('teamId', 'name')
      .lean();

    if (existingMembership && String(existingMembership.teamId?._id || existingMembership.teamId) !== String(team._id)) {
      const assignedName = existingMembership.teamId?.name || 'another team';
      return res.status(409).json({ message: `Recruiter is already assigned to ${assignedName}.` });
    }

    await Membership.findOneAndUpdate(
      { organizationId: orgId, teamId: team._id, userId: recruiter._id },
      {
        $set: {
          role: 'member',
          status: 'active',
          invitedBy: req.user._id,
          joinedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const [enrichedTeam] = await hydrateTeams(orgId, [team]);
    return res.status(201).json({ team: enrichedTeam });
  } catch (error) {
    console.error('Admin console assign recruiter error:', error.message);
    return res.status(500).json({ message: 'Failed to assign recruiter to team.' });
  }
};

const removeRecruiterFromConsoleTeam = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const team = await Team.findOne({ _id: req.params.id, organizationId: orgId }).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    await Membership.deleteOne({
      organizationId: orgId,
      teamId: team._id,
      userId: req.params.recruiterId
    });

    const [enrichedTeam] = await hydrateTeams(orgId, [team]);
    return res.json({ team: enrichedTeam });
  } catch (error) {
    console.error('Admin console remove recruiter error:', error.message);
    return res.status(500).json({ message: 'Failed to remove recruiter from team.' });
  }
};

// ── GET /api/admin-console/preferences ───────────────────────────────────
const getConsolePreferences = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const organization = await Organization.findById(orgId)
      .select('name slug description createdAt ownerId dashboardConfig')
      .lean();

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    return res.json({
      organization: {
        ...organization,
        dashboardConfig: normalizeDashboardConfig(organization.dashboardConfig)
      }
    });
  } catch (error) {
    console.error('Admin console preferences error:', error.message);
    return res.status(500).json({ message: 'Failed to load organization preferences.' });
  }
};

// ── PATCH /api/admin-console/preferences ─────────────────────────────────
const updateConsolePreferences = async (req, res) => {
  try {
    const orgId = req.organizationId;
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const requestedConfig = normalizeDashboardConfig(req.body?.dashboardConfig || {});

    if (!name) {
      return res.status(400).json({ message: 'Organization name is required.' });
    }

    let defaultTeamId = null;
    if (requestedConfig.defaultTeamId) {
      const team = await Team.findOne({
        _id: requestedConfig.defaultTeamId,
        organizationId: orgId
      })
        .select('_id')
        .lean();

      if (!team) {
        return res.status(400).json({ message: 'Default dashboard team is not part of this organization.' });
      }

      defaultTeamId = team._id;
    }

    const organization = await Organization.findByIdAndUpdate(
      orgId,
      {
        $set: {
          name,
          description,
          dashboardConfig: {
            ...requestedConfig,
            defaultTeamId
          }
        }
      },
      { new: true }
    ).select('name slug description createdAt ownerId dashboardConfig').lean();

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    return res.json({
      organization: {
        ...organization,
        dashboardConfig: normalizeDashboardConfig(organization.dashboardConfig)
      },
      message: 'Organization preferences updated.'
    });
  } catch (error) {
    console.error('Admin console update preferences error:', error.message);
    return res.status(500).json({ message: 'Failed to update organization preferences.' });
  }
};

// ── GET /api/admin-console/performance ───────────────────────────────────
const getConsolePerformance = async (req, res) => {
  try {
    const orgId = req.organizationId || null;
    if (!orgId) {
      return res.status(403).json({ message: 'Organization context is required for this resource.' });
    }
    const days = Math.min(90, Math.max(7, Number.parseInt(String(req.query.days || String(DEFAULT_DASHBOARD_DATE_RANGE)), 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const selectedTeamId = String(req.query.teamId || '').trim();
    const selectedRecruiterId = String(req.query.recruiterId || '').trim();
    const selectedStack = String(req.query.stack || '').trim();
    const rawJobStatus = String(req.query.jobStatus || '').trim().toLowerCase();
    const selectedJobStatus = DEFAULT_JOB_STATUSES.includes(rawJobStatus) ? rawJobStatus : '';

    const [recruiters, teams, memberships, invitations] = await Promise.all([
      User.find({ role: 'recruiter', organizationId: orgId }).select('_id name email isActive createdAt').lean(),
      Team.find({ organizationId: orgId }).select('_id name isActive createdAt').lean(),
      Membership.find({ organizationId: orgId, status: 'active', teamId: { $ne: null } }).select('userId teamId').lean(),
      Invitation.find({ organizationId: orgId }).select('status createdAt').lean()
    ]);

    const membersByTeam = memberships.reduce((map, m) => {
      const teamId = String(m.teamId || '');
      if (!teamId) return map;
      if (!map.has(teamId)) map.set(teamId, []);
      map.get(teamId).push(String(m.userId));
      return map;
    }, new Map());

    const allRecruiterIds = recruiters.map((r) => String(r._id));
    let teamScopedRecruiterIds = [...allRecruiterIds];
    if (selectedTeamId) {
      teamScopedRecruiterIds = (membersByTeam.get(selectedTeamId) || []).filter((id) => allRecruiterIds.includes(id));
    }
    let scopedRecruiterIds = [...teamScopedRecruiterIds];
    if (selectedRecruiterId) {
      scopedRecruiterIds = scopedRecruiterIds.filter((id) => id === selectedRecruiterId);
    }
    const availableRecruiterSet = new Set(teamScopedRecruiterIds);
    const availableRecruiters = recruiters.filter((r) => availableRecruiterSet.has(String(r._id)));
    const scopedSet = new Set(scopedRecruiterIds);
    const scopedRecruiters = recruiters.filter((r) => scopedSet.has(String(r._id)));

    const recruiterById = recruiters.reduce((map, recruiter) => {
      map.set(String(recruiter._id), recruiter);
      return map;
    }, new Map());

    const jobMatch = { organizationId: orgId, recruiterId: { $in: scopedRecruiterIds } };
    if (selectedStack) jobMatch.stack = selectedStack;
    if (selectedJobStatus) jobMatch.status = selectedJobStatus;
    const allJobs = await Job.find(jobMatch)
      .select('_id recruiterId teamId title role status createdAt updatedAt stack')
      .sort({ createdAt: -1 })
      .lean();

    const detailedActivityLogs = await AuditLog.find({
      organizationId: orgId,
      actor: { $in: scopedRecruiterIds },
      timestamp: { $gte: since }
    })
      .sort({ timestamp: -1 })
      .limit(400)
      .select('_id actor action method route statusCode timestamp')
      .lean();

    const activityLogs = detailedActivityLogs.filter((log) => /\/api\/recruiter\/(match|ai-rank)/.test(String(log.route || '')));

    // Candidate pool created/managed by recruiters (if your org is using it).
    const candidateMatch = { createdBy: { $in: scopedRecruiterIds } };
    if (selectedStack) candidateMatch.stack = selectedStack;
    const recentCandidates = await Candidate.find({ ...candidateMatch, createdAt: { $gte: since } })
      .select('createdBy fullName createdAt stack githubScore resumeScore growthPotentialScore skillGaps aiInsight')
      .sort({ createdAt: -1 })
      .lean();

    const pushLimited = (map, key, value, limit = 5) => {
      if (!key) return;
      const current = map.get(key) || [];
      if (current.length < limit) {
        current.push(value);
        map.set(key, current);
      }
    };

    const teamByRecruiter = new Map();
    memberships.forEach((m) => { teamByRecruiter.set(String(m.userId), String(m.teamId)); });

    const jobsByRecruiter = new Map();
    const recentJobsByRecruiter = new Map();
    const lastJobAtByRecruiter = new Map();
    const openJobsByRecruiter = new Map();
    const draftJobsByRecruiter = new Map();
    const closedJobsByRecruiter = new Map();
    const recentJobsListByRecruiter = new Map();
    const recentJobsListByTeam = new Map();
    allJobs.forEach((job) => {
      const key = String(job.recruiterId || '');
      if (!key) return;
      const teamKey = String(job.teamId || teamByRecruiter.get(key) || '');
      jobsByRecruiter.set(key, (jobsByRecruiter.get(key) || 0) + 1);
      if (!lastJobAtByRecruiter.get(key) || new Date(job.createdAt) > lastJobAtByRecruiter.get(key)) {
        lastJobAtByRecruiter.set(key, new Date(job.createdAt));
      }
      if (new Date(job.createdAt) >= since) recentJobsByRecruiter.set(key, (recentJobsByRecruiter.get(key) || 0) + 1);
      if (job.status === 'open') openJobsByRecruiter.set(key, (openJobsByRecruiter.get(key) || 0) + 1);
      if (job.status === 'draft') draftJobsByRecruiter.set(key, (draftJobsByRecruiter.get(key) || 0) + 1);
      if (job.status === 'closed') closedJobsByRecruiter.set(key, (closedJobsByRecruiter.get(key) || 0) + 1);
      const jobSummary = {
        _id: job._id,
        title: String(job.title || job.role || 'Untitled role').trim(),
        status: String(job.status || 'open'),
        stack: String(job.stack || 'Other').trim() || 'Other',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt || job.createdAt
      };
      pushLimited(recentJobsListByRecruiter, key, jobSummary);
      pushLimited(recentJobsListByTeam, teamKey, jobSummary);
    });

    const matchCallsByRecruiter = new Map();
    const aiRankCallsByRecruiter = new Map();
    const lastActivityAtByRecruiter = new Map();
    const recentActivityByRecruiter = new Map();
    const recentActivityByTeam = new Map();
    detailedActivityLogs.forEach((log) => {
      const id = String(log.actor || '');
      if (!id) return;
      const route = String(log.route || '');
      const recruiter = recruiterById.get(id);
      const activityItem = {
        _id: log._id,
        action: String(log.action || route || 'Activity').trim() || 'Activity',
        method: String(log.method || '').trim(),
        route,
        statusCode: Number(log.statusCode || 0),
        timestamp: log.timestamp,
        actorName: recruiter?.name || recruiter?.email || 'Recruiter'
      };
      if (route.includes('/api/recruiter/match')) {
        matchCallsByRecruiter.set(id, (matchCallsByRecruiter.get(id) || 0) + 1);
      }
      if (route.includes('/api/recruiter/ai-rank')) {
        aiRankCallsByRecruiter.set(id, (aiRankCallsByRecruiter.get(id) || 0) + 1);
      }
      const ts = log.timestamp ? new Date(log.timestamp) : null;
      if (ts && (!lastActivityAtByRecruiter.get(id) || ts > lastActivityAtByRecruiter.get(id))) {
        lastActivityAtByRecruiter.set(id, ts);
      }
      pushLimited(recentActivityByRecruiter, id, activityItem);
      pushLimited(recentActivityByTeam, String(teamByRecruiter.get(id) || ''), activityItem);
    });

    const candidatesByRecruiter = new Map();
    const aiEnhancedCandidatesByRecruiter = new Map();
    const lastCandidateAtByRecruiter = new Map();
    const recentCandidatesByRecruiter = new Map();
    const recentCandidatesByTeam = new Map();
    const skillGapCounts = new Map();
    let portfolioQualitySum = { github: 0, resume: 0, growth: 0, count: 0 };

    recentCandidates.forEach((c) => {
      const rid = String(c.createdBy || '');
      if (!rid) return;
      const teamKey = String(teamByRecruiter.get(rid) || '');

      candidatesByRecruiter.set(rid, (candidatesByRecruiter.get(rid) || 0) + 1);

      const aiSummary = String(c.aiInsight?.summary || '').trim();
      const aiStrengths = Array.isArray(c.aiInsight?.strengths) ? c.aiInsight.strengths : [];
      const aiUsed = aiSummary.length > 0 || aiStrengths.length > 0;
      if (aiUsed) {
        aiEnhancedCandidatesByRecruiter.set(rid, (aiEnhancedCandidatesByRecruiter.get(rid) || 0) + 1);
      }

      const ts = c.createdAt ? new Date(c.createdAt) : null;
      if (ts && (!lastCandidateAtByRecruiter.get(rid) || ts > lastCandidateAtByRecruiter.get(rid))) {
        lastCandidateAtByRecruiter.set(rid, ts);
      }

      const candidateSummary = {
        fullName: String(c.fullName || 'Candidate').trim() || 'Candidate',
        stack: String(c.stack || 'Other').trim() || 'Other',
        createdAt: c.createdAt
      };
      pushLimited(recentCandidatesByRecruiter, rid, candidateSummary);
      pushLimited(recentCandidatesByTeam, teamKey, candidateSummary);

      const gaps = Array.isArray(c.skillGaps) ? c.skillGaps : [];
      gaps.forEach((g) => {
        const key = String(g || '').trim();
        if (!key) return;
        skillGapCounts.set(key, (skillGapCounts.get(key) || 0) + 1);
      });

      const gScore = Number(c.githubScore || 0);
      const rScore = Number(c.resumeScore || 0);
      const gpScore = Number(c.growthPotentialScore || 0);
      portfolioQualitySum.github += Number.isFinite(gScore) ? gScore : 0;
      portfolioQualitySum.resume += Number.isFinite(rScore) ? rScore : 0;
      portfolioQualitySum.growth += Number.isFinite(gpScore) ? gpScore : 0;
      portfolioQualitySum.count += 1;
    });

    const recruiterMetrics = scopedRecruiters.map((r) => {
      const id = String(r._id);
      const totalJobs = jobsByRecruiter.get(id) || 0;
      const recentJobs = recentJobsByRecruiter.get(id) || 0;
      const closedJobs = closedJobsByRecruiter.get(id) || 0;
      const matchCalls = matchCallsByRecruiter.get(id) || 0;
      const aiRankCalls = aiRankCallsByRecruiter.get(id) || 0;
      const totalAnalyses = matchCalls + aiRankCalls;
      const candidatesAnalyzed = candidatesByRecruiter.get(id) || 0;
      const aiEnhancedCandidates = aiEnhancedCandidatesByRecruiter.get(id) || 0;
      const matchesGenerated = matchCalls;
      const hiringSuccessRate = totalJobs > 0 ? Math.round((closedJobs / totalJobs) * 100) : 0;
      const aiUsage = totalAnalyses;
      const lastActiveAt = lastActivityAtByRecruiter.get(id) || lastCandidateAtByRecruiter.get(id) || lastJobAtByRecruiter.get(id) || null;
      const activityScore = clamp(recentJobs * 14 + matchCalls * 6 + aiRankCalls * 10 + candidatesAnalyzed * 4 + (r.isActive !== false ? 10 : 0), 0, 100);
      return {
        _id: r._id,
        name: r.name,
        email: r.email,
        isActive: r.isActive !== false,
        teamId: teamByRecruiter.get(id) || null,
        totalJobs,
        recentJobs,
        totalAnalyses,
        githubAnalyses: 0,
        resumeAnalyses: 0,
        hiringSuccessRate,
        matchesGenerated,
        shortlists: matchesGenerated,
        aiUsage,
        activityScore,
        lastActiveAt,
        candidatesAnalyzed,
        aiRankCalls,
        matchCalls,
        aiEnhancedCandidates,
        openJobs: openJobsByRecruiter.get(id) || 0,
        draftJobs: draftJobsByRecruiter.get(id) || 0,
        closedJobs,
        recentJobsList: recentJobsListByRecruiter.get(id) || [],
        recentCandidates: recentCandidatesByRecruiter.get(id) || [],
        recentActivity: recentActivityByRecruiter.get(id) || [],
        score: clamp(totalJobs * 8 + recentJobs * 8 + totalAnalyses * 3 + hiringSuccessRate * 0.5, 0, 100),
        joinedAt: r.createdAt
      };
    }).sort((a, b) => b.score - a.score);

    const scopedTeams = selectedTeamId ? teams.filter((t) => String(t._id) === selectedTeamId) : teams;
    const teamMetrics = scopedTeams.map((t) => {
      const id = String(t._id);
      const allMemberIds = membersByTeam.get(id) || [];
      const scopedMemberIds = allMemberIds.filter((mid) => scopedSet.has(mid));
      const recruiterIdsForTeam = allMemberIds.filter((mid) => allRecruiterIds.includes(String(mid)));
      const teamJobs = allJobs.filter((j) => {
        const recruiterId = String(j.recruiterId || '');
        const jobTeamId = String(j.teamId || '');
        return scopedMemberIds.includes(recruiterId) || (!!jobTeamId && jobTeamId === id);
      });
      const recentTeamJobs = teamJobs.filter((j) => new Date(j.createdAt) >= since);
      const activeMembers = recruiterIdsForTeam.filter((mid) => recruiters.find((r) => String(r._id) === mid && r.isActive !== false)).length;
      const closedTeamJobs = teamJobs.filter((j) => j.status === 'closed').length;
      const openTeamJobs = teamJobs.filter((j) => j.status === 'open').length;
      const draftTeamJobs = teamJobs.filter((j) => j.status === 'draft').length;
      const hiringPerformance = teamJobs.length > 0 ? Math.round((closedTeamJobs / teamJobs.length) * 100) : 0;
      const teamCandidates = scopedMemberIds.reduce((sum, rid) => sum + (candidatesByRecruiter.get(String(rid)) || 0), 0);
      const teamAiCalls = scopedMemberIds.reduce((sum, rid) => sum + (aiRankCallsByRecruiter.get(String(rid)) || 0), 0);
      const teamMatchCalls = scopedMemberIds.reduce((sum, rid) => sum + (matchCallsByRecruiter.get(String(rid)) || 0), 0);
      const teamRecentActions = recentActivityByTeam.get(id) || [];
      const engagementScore = clamp(recentTeamJobs.length * 12 + teamCandidates * 5 + teamAiCalls * 8 + activeMembers * 10 + hiringPerformance * 0.35, 0, 100);
      const performanceScore = Math.round((engagementScore + hiringPerformance) / 2);
      return {
        _id: t._id,
        name: t.name,
        isActive: t.isActive !== false,
        memberCount: allMemberIds.length,
        activeMembers,
        recruiterCount: recruiterIdsForTeam.length,
        totalJobs: teamJobs.length,
        recentJobs: recentTeamJobs.length,
        openJobs: openTeamJobs,
        draftJobs: draftTeamJobs,
        closedJobs: closedTeamJobs,
        candidatesAnalyzed: teamCandidates,
        aiUsage: teamAiCalls,
        matchesGenerated: teamMatchCalls,
        hiringPerformance,
        engagementScore,
        performanceScore,
        activityCount: teamRecentActions.length,
        activityTimeline: teamRecentActions,
        recentActions: teamRecentActions,
        recentJobsList: recentJobsListByTeam.get(id) || [],
        recentCandidates: recentCandidatesByTeam.get(id) || [],
        createdAt: t.createdAt
      };
    }).sort((a, b) => b.engagementScore - a.engagementScore);

    const openJobs = allJobs.filter((j) => j.status === 'open').length;
    const draftJobs = allJobs.filter((j) => j.status === 'draft').length;
    const closedJobs = allJobs.filter((j) => j.status === 'closed').length;
    const recentJobs = allJobs.filter((j) => new Date(j.createdAt) >= since).length;

    const stackMap = new Map();
    allJobs.forEach((j) => {
      const s = String(j.stack || 'Other');
      stackMap.set(s, (stackMap.get(s) || 0) + 1);
    });
    const stackDistribution = [...stackMap.entries()].map(([stack, count]) => ({ stack, count })).sort((a, b) => b.count - a.count).slice(0, 8);

    const invFunnel = {
      total: invitations.length,
      pending: invitations.filter((i) => i.status === 'pending').length,
      accepted: invitations.filter((i) => i.status === 'accepted').length,
      expired: invitations.filter((i) => i.status === 'expired').length,
      revoked: invitations.filter((i) => i.status === 'revoked').length
    };
    const acceptanceRate = invFunnel.total > 0 ? Math.round((invFunnel.accepted / invFunnel.total) * 100) : 0;

    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      const count = allJobs.filter((j) => {
        const jd = new Date(j.createdAt);
        return jd.getMonth() === d.getMonth() && jd.getFullYear() === d.getFullYear();
      }).length;
      monthlyTrend.push({ label, count });
    }

    const allTimeAnalysisLogs = await AuditLog.find({
      actor: { $in: scopedRecruiterIds },
      route: { $regex: /\/api\/recruiter\/(match|ai-rank)/ }
    })
      .select('actor route')
      .lean();
    const totalAnalyses = allTimeAnalysisLogs.length;
    const recentAnalyses = activityLogs.length;
    const allTimeAnalysesByRecruiter = new Map();
    allTimeAnalysisLogs.forEach((log) => {
      const id = String(log.actor || '');
      if (!id) return;
      allTimeAnalysesByRecruiter.set(id, (allTimeAnalysesByRecruiter.get(id) || 0) + 1);
    });

    // Stack options should not disappear when a stack filter is selected.
    const [jobStacks, candidateStacks] = await Promise.all([
      Job.distinct('stack', { organizationId: orgId, recruiterId: { $in: scopedRecruiterIds } }),
      Candidate.distinct('stack', { createdBy: { $in: scopedRecruiterIds } })
    ]);
    const DEFAULT_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
    const stacksRaw = [...DEFAULT_STACKS, ...jobStacks, ...candidateStacks]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const stacks = [...new Set(stacksRaw)].sort((a, b) => a.localeCompare(b));

    const skillGapTrends = [...skillGapCounts.entries()]
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const portfolioQuality = portfolioQualitySum.count > 0 ? {
      avgGithubScore: Math.round(portfolioQualitySum.github / portfolioQualitySum.count),
      avgResumeScore: Math.round(portfolioQualitySum.resume / portfolioQualitySum.count),
      avgGrowthPotential: Math.round(portfolioQualitySum.growth / portfolioQualitySum.count),
      sampleSize: portfolioQualitySum.count
    } : { avgGithubScore: 0, avgResumeScore: 0, avgGrowthPotential: 0, sampleSize: 0 };

    const totalCandidatesAnalyzed = recentCandidates.length;
    const totalAiEnhancedCandidates = Array.from(aiEnhancedCandidatesByRecruiter.values()).reduce((sum, v) => sum + Number(v || 0), 0);
    const totalAiRankCalls = Array.from(aiRankCallsByRecruiter.values()).reduce((sum, v) => sum + Number(v || 0), 0);
    const totalMatchCalls = Array.from(matchCallsByRecruiter.values()).reduce((sum, v) => sum + Number(v || 0), 0);
    const organizationPerformanceScore = Math.round((
      (teamMetrics.length > 0
        ? teamMetrics.reduce((sum, team) => sum + Number(team.performanceScore || 0), 0) / teamMetrics.length
        : 0) +
      (recruiterMetrics.length > 0
        ? recruiterMetrics.reduce((sum, recruiter) => sum + Number(recruiter.score || 0), 0) / recruiterMetrics.length
        : 0) +
      acceptanceRate
    ) / 3);

    // Engagement heatmap (operational intensity) for the selected date range.
    // Uses recruiter-scoped events: job creation, candidate creation, and recruiter AI/match mutation calls.
    const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const HEATMAP_BUCKETS = [
      { label: '0-3', start: 0, end: 3 },
      { label: '4-7', start: 4, end: 7 },
      { label: '8-11', start: 8, end: 11 },
      { label: '12-15', start: 12, end: 15 },
      { label: '16-19', start: 16, end: 19 },
      { label: '20-23', start: 20, end: 23 }
    ];

    const dayToIndex = (d) => {
      // JS: 0=Sun ... 6=Sat. We want 0=Mon ... 6=Sun.
      const js = Number(d);
      return js === 0 ? 6 : js - 1;
    };

    const heatmapGrid = Array.from({ length: 7 }, () => Array.from({ length: HEATMAP_BUCKETS.length }, () => 0));
    const bump = (ts) => {
      if (!ts) return;
      const dt = new Date(ts);
      if (Number.isNaN(dt.getTime()) || dt < since) return;
      const dayIdx = dayToIndex(dt.getDay());
      const hour = dt.getHours();
      const bucketIdx = HEATMAP_BUCKETS.findIndex((b) => hour >= b.start && hour <= b.end);
      if (dayIdx < 0 || dayIdx > 6 || bucketIdx < 0) return;
      heatmapGrid[dayIdx][bucketIdx] += 1;
    };

    allJobs.forEach((j) => bump(j.createdAt));
    recentCandidates.forEach((c) => bump(c.createdAt));
    activityLogs.forEach((l) => bump(l.timestamp));

    let heatmapMax = 0;
    heatmapGrid.forEach((row) => row.forEach((v) => { if (v > heatmapMax) heatmapMax = v; }));

    const engagementHeatmap = {
      days: HEATMAP_DAYS,
      buckets: HEATMAP_BUCKETS.map((b) => b.label),
      grid: heatmapGrid,
      max: heatmapMax
    };

    return res.json({
      period: { days, since },
      filters: {
        selectedTeamId,
        selectedRecruiterId,
        selectedStack,
        selectedJobStatus,
        teams: teams.map((t) => ({ _id: t._id, name: t.name })),
        recruiters: availableRecruiters.map((r) => ({ _id: r._id, name: r.name })),
        stacks,
        jobStatuses: DEFAULT_JOB_STATUSES
      },
      recruiterMetrics,
      teamMetrics,
      hiringAnalytics: {
        total: allJobs.length,
        open: openJobs,
        draft: draftJobs,
        closed: closedJobs,
        recentJobs,
        stackDistribution,
        monthlyTrend,
        invitationFunnel: invFunnel,
        acceptanceRate
      },
      aiStats: {
        totalAnalyses,
        recentAnalyses,
        analysesByRecruiter: recruiterMetrics.map((r) => ({
          name: r.name,
          count: allTimeAnalysesByRecruiter.get(String(r._id)) || 0,
          recentCount: r.totalAnalyses
        }))
      },
      recentActivity: detailedActivityLogs.slice(0, 8).map((log) => {
        const actorId = String(log.actor || '');
        const actor = recruiterById.get(actorId);
        return {
          _id: log._id,
          action: String(log.action || log.route || 'Activity').trim() || 'Activity',
          method: String(log.method || '').trim(),
          route: String(log.route || '').trim(),
          statusCode: Number(log.statusCode || 0),
          timestamp: log.timestamp,
          actorName: actor?.name || actor?.email || 'Recruiter'
        };
      }),
      engagementMeta: {
        // Keep this human-readable so admins understand why engagementScore is low/high.
        formula: 'clamp(recentJobs*12 + candidatesAnalyzed*5 + aiRankCalls*8 + activeRecruiters*10 + hiringPerformance*0.35, 0..100)',
        notes: [
          'recentJobs = jobs created in selected date range',
          'candidatesAnalyzed = candidates created in selected date range',
          'aiRankCalls = /api/recruiter/ai-rank POST count in selected date range',
          'activeRecruiters = active recruiters assigned to the team'
        ]
      },
      skillGapTrends,
      portfolioQuality,
      engagementHeatmap,
      candidateAnalytics: {
        candidatesAnalyzed: totalCandidatesAnalyzed,
        aiEnhancedCandidates: totalAiEnhancedCandidates
      },
      aiEffectiveness: {
        aiRankCalls: totalAiRankCalls,
        matchCalls: totalMatchCalls,
        aiEnhancedRate: totalCandidatesAnalyzed > 0 ? Math.round((totalAiEnhancedCandidates / totalCandidatesAnalyzed) * 100) : 0
      },
      summary: {
        totalRecruiters: scopedRecruiters.length,
        activeRecruiters: scopedRecruiters.filter((r) => r.isActive !== false).length,
        inactiveRecruiters: scopedRecruiters.filter((r) => r.isActive === false).length,
        totalTeams: scopedTeams.length,
        pendingInvitations: invFunnel.pending,
        totalJobs: allJobs.length,
        openJobs,
        draftJobs,
        closedJobs,
        matchesGenerated: totalMatchCalls,
        aiRankUsage: totalAiRankCalls,
        organizationPerformanceScore: clamp(organizationPerformanceScore, 0, 100),
        topRecruiter: recruiterMetrics[0]?.name || null,
        topTeam: teamMetrics[0]?.name || null
      }
    });
  } catch (error) {
    console.error('Admin console performance error:', error.message);
    return res.status(500).json({ message: 'Failed to load performance data.' });
  }
};
module.exports = {
  getConsoleOverview,
  getConsoleAnalytics,
  getConsoleActivity,
  getConsoleTeams,
  createConsoleTeam,
  updateConsoleTeam,
  toggleConsoleTeamActive,
  deleteConsoleTeam,
  assignRecruiterToConsoleTeam,
  removeRecruiterFromConsoleTeam,
  getConsolePreferences,
  updateConsolePreferences,
  getConsolePerformance
};

