/**
 * Admin Console Controller
 * Organization-scoped endpoints for the org admin console.
 * All handlers assume req.organizationId is set by requireOrganizationContext middleware.
 */

const { body, param, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { isObjectId } = require('../middleware/validateObjectIdParam');

const User = require('../../auth/models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Invitation = require('../models/invitation');
const AuditLog = require('../models/auditLog');
const Organization = require('../models/organization');
const Job = require('../../recruiter/models/Job');
const { normalizeSlug } = require('../services/tenantService');
const {
  isDuplicateOrganizationTeamSlug,
  withOrganizationTeamCapacity,
  withOrganizationCapacityFence
} = require('../services/teamCapacityService');
const teamAnalyticsService = require('../services/teamAnalyticsService');
const { getOrganizationSettingsSync } = require('../../super-admin/services/platformSettingsService');

const {
  normalizeDashboardConfig,
  hydrateTeams,
  normalizeRecruiterIds,
  upsertRecruiterTeamMemberships,
  getConsolePerformanceData,
} = require('../services/adminConsoleService');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({
    message: 'Validation failed.',
    errors: errors.array().map((error) => ({ field: error.path, message: error.msg }))
  });
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

    const now = new Date();
    const [jobSummary, teams, memberships, recentInvitations, invitationFunnel] = await Promise.all([
      Job.aggregate([
        { $match: { organizationId: new mongoose.Types.ObjectId(orgId) } },
        {
          $facet: {
            byRecruiter: [{ $group: { _id: '$recruiterId', count: { $sum: 1 } } }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }]
          }
        }
      ]),
      Team.find({ organizationId: orgId }).select('_id name createdAt').lean(),
      Membership.find({ organizationId: orgId, status: 'active' }).select('userId teamId role').lean(),
      Invitation.find({ organizationId: orgId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .select('name email role status createdAt expiresAt')
        .lean(),
      Promise.all([
        Invitation.countDocuments({ organizationId: orgId, status: 'pending', expiresAt: { $gt: now } }),
        Invitation.countDocuments({
          organizationId: orgId,
          $or: [{ status: 'expired' }, { status: 'pending', expiresAt: { $lte: now } }]
        }),
        Invitation.countDocuments({ organizationId: orgId, status: 'accepted' }),
        Invitation.countDocuments({ organizationId: orgId, status: 'revoked' })
      ])
    ]);

    // Jobs per recruiter
    const summary = jobSummary[0] || { byRecruiter: [], byStatus: [] };
    const jobsByRecruiter = new Map(
      summary.byRecruiter.filter((entry) => entry._id).map((entry) => [String(entry._id), entry.count])
    );

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
    const jobsByStatus = new Map(summary.byStatus.map((entry) => [String(entry._id), entry.count]));
    const hiringActivity = {
      total: summary.byStatus.reduce((total, entry) => total + entry.count, 0),
      open: jobsByStatus.get('open') || 0,
      draft: jobsByStatus.get('draft') || 0,
      closed: jobsByStatus.get('closed') || 0
    };

    const [pendingInvitations, expiredInvitations, acceptedInvitations, revokedInvitations] = invitationFunnel;

    return res.json({
      recruiterPerformance,
      teamSummary,
      hiringActivity,
      invitationFunnel: {
        pending: pendingInvitations,
        accepted: acceptedInvitations,
        expired: expiredInvitations,
        revoked: revokedInvitations
      },
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

    const filter = { organizationId: orgId, deleted: { $ne: true } };

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .select('actor organizationId teamId action method route statusCode timestamp')
        .populate('actor', 'name email role')
        .lean(),
      AuditLog.countDocuments(filter)
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

    if (req.query.page) {
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10));
      const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '10'), 10)));
      
      const search = String(req.query.search || '').trim().toLowerCase();
      const status = String(req.query.status || 'all').trim().toLowerCase();
      const recruiterId = String(req.query.recruiterId || '').trim();
      const sortBy = String(req.query.sortBy || 'score').trim().toLowerCase();
      const sortOrder = String(req.query.sortOrder || 'desc').trim().toLowerCase();

      const { teamMetrics } = await teamAnalyticsService.computeOrgTeamsMetrics(orgId);

      let filteredTeams = teamMetrics;

      // 1. Search term filter (name or description)
      if (search) {
        filteredTeams = filteredTeams.filter(
          (t) =>
            t.name.toLowerCase().includes(search) ||
            t.description.toLowerCase().includes(search)
        );
      }

      // 2. Status filter
      if (status === 'active') {
        filteredTeams = filteredTeams.filter((t) => t.isActive === true);
      } else if (status === 'inactive') {
        filteredTeams = filteredTeams.filter((t) => t.isActive === false);
      }

      // 3. Recruiter filter
      if (recruiterId) {
        filteredTeams = filteredTeams.filter((t) =>
          t.members.some((m) => String(m._id) === recruiterId)
        );
      }

      // Sort
      filteredTeams.sort((a, b) => {
        let valA, valB;
        if (sortBy === 'recruiters') {
          valA = a.recruiterCount;
          valB = b.recruiterCount;
        } else if (sortBy === 'jobs') {
          valA = a.totalJobs;
          valB = b.totalJobs;
        } else if (sortBy === 'newest') {
          valA = new Date(a.createdAt).getTime();
          valB = new Date(b.createdAt).getTime();
        } else {
          // Default: score
          valA = a.performanceScore;
          valB = b.performanceScore;
        }

        if (sortOrder === 'asc') {
          return valA > valB ? 1 : valA < valB ? -1 : 0;
        } else {
          return valA < valB ? 1 : valA > valB ? -1 : 0;
        }
      });

      const total = filteredTeams.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const skip = (page - 1) * limit;
      const paginatedTeams = filteredTeams.slice(skip, skip + limit);

      return res.json({
        teams: paginatedTeams,
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages
      });
    }

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

    const organizationSettings = getOrganizationSettingsSync();
    const teamLimit = Number(organizationSettings.maxTeamsPerOrganization || 10);
    const organization = await Organization.findById(orgId).select('_id').lean();
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    const existing = await Team.findOne({ organizationId: orgId, slug }).lean();
    if (existing) {
      return res.status(409).json({ message: 'Team slug already exists in this organization.' });
    }

    const team = await withOrganizationTeamCapacity({
      organizationId: orgId,
      limit: teamLimit,
      create: async (session) => {
        const duplicate = await Team.findOne({ organizationId: orgId, slug }).session(session).lean();
        if (duplicate) {
          const error = new Error('Team slug already exists in this organization.');
          error.status = 409;
          throw error;
        }

        const [createdTeam] = await Team.create(
          [
            {
              organizationId: orgId,
              name,
              slug,
              description,
              isActive: true,
              createdBy: req.user._id
            }
          ],
          { session }
        );

        if (recruiterIds.length > 0) {
          await upsertRecruiterTeamMemberships({
            organizationId: orgId,
            teamId: createdTeam._id,
            recruiterIds,
            invitedBy: req.user._id,
            session
          });
        }

        return createdTeam;
      }
    });

    const [enrichedTeam] = await hydrateTeams(orgId, [team.toObject()]);
    return res.status(201).json({ team: enrichedTeam });
  } catch (error) {
    if (isDuplicateOrganizationTeamSlug(error)) {
      return res.status(409).json({ message: 'Team slug already exists in this organization.' });
    }
    if (error?.status && error.status < 500) {
      return res.status(error.status).json({ message: error.message });
    }
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
    await withOrganizationCapacityFence({
      organizationId: req.organizationId,
      mutate: async (session, organizationId) => {
        const teamId = req.params.id;
        const result = await Team.deleteOne({ _id: teamId, organizationId }, { session });
        if (!result.deletedCount) throw Object.assign(new Error('Team not found.'), { status: 404 });
        await Membership.deleteMany({ organizationId, teamId }, { session });
        await Invitation.updateMany(
          { organizationId, teamId, status: 'pending' },
          { $set: { status: 'revoked' } },
          { session }
        );
      }
    });
    return res.json({ message: 'Team deleted successfully.' });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to delete team.' });
  }
};

const assignRecruiterToConsoleTeam = async (req, res) => {
  const recruiterId = req.body?.recruiterId;
  if (typeof recruiterId !== 'string' || !/^[a-f\d]{24}$/i.test(recruiterId)) {
    return res.status(400).json({ message: 'recruiterId is invalid.' });
  }

  try {
    const team = await withOrganizationCapacityFence({
      organizationId: req.organizationId,
      mutate: async (session, organizationId) => {
        const team = await Team.findOne({ _id: req.params.id, organizationId, isActive: true }).session(session).lean();
        if (!team) throw Object.assign(new Error('Team not found.'), { status: 404 });
        await upsertRecruiterTeamMemberships({
          organizationId,
          teamId: team._id,
          recruiterIds: [recruiterId],
          invitedBy: req.user._id,
          session
        });
        return team;
      }
    });
    const [enrichedTeam] = await hydrateTeams(req.organizationId, [team]);
    return res.status(201).json({ team: enrichedTeam });
  } catch (error) {
    return res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : 'Failed to assign recruiter to team.' });
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
    const config = req.body?.dashboardConfig;
    if (config !== undefined && (!config || typeof config !== 'object' || Array.isArray(config))) {
      return res.status(400).json({ message: 'dashboardConfig is invalid.' });
    }
    if (config?.defaultTeamId && !isObjectId(config.defaultTeamId)) {
      return res.status(400).json({ message: 'defaultTeamId is invalid.' });
    }
    if (config?.preferredDateRangeDays !== undefined && ![7, 14, 30, 60, 90].includes(config.preferredDateRangeDays)) {
      return res.status(400).json({ message: 'preferredDateRangeDays is invalid.' });
    }
    const requestedConfig = normalizeDashboardConfig(config || {});

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

// ── GET /api/admin-console/performance ───────────────────────────────────
const getConsolePerformance = async (req, res) => {
  try {
    const orgId = req.organizationId || null;
    if (!orgId) {
      return res.status(403).json({ message: 'Organization context is required for this resource.' });
    }

    const { days, teamId, recruiterId, stack, jobStatus } = req.query;
    if (
      (days !== undefined &&
        (typeof days !== 'string' || !/^\d+$/.test(days) || Number(days) < 7 || Number(days) > 90)) ||
      [teamId, recruiterId].some((id) => id !== undefined && id !== '' && !isObjectId(id)) ||
      (stack !== undefined && (typeof stack !== 'string' || stack.length > 100)) ||
      (jobStatus !== undefined && !['', 'open', 'draft', 'closed'].includes(jobStatus))
    ) {
      return res.status(400).json({ message: 'Invalid performance filters.' });
    }
    const [team, recruiter] = await Promise.all([
      teamId && Team.exists({ _id: teamId, organizationId: orgId }),
      recruiterId && User.exists({ _id: recruiterId, organizationId: orgId, role: 'recruiter' })
    ]);
    if ((teamId && !team) || (recruiterId && !recruiter)) {
      return res.status(404).json({ message: 'Performance filter resource not found.' });
    }
    const payload = await getConsolePerformanceData(orgId, req.query);
    return res.json(payload);
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
