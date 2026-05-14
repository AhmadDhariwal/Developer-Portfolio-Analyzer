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
const { normalizeSlug } = require('../services/tenantService');

// ── helpers ───────────────────────────────────────────────────────────────
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v || 0)));

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

    const [
      organization,
      recruitersCount,
      activeRecruitersCount,
      teamsCount,
      jobsCount,
      pendingInvitationsCount,
      membersCount
    ] = await Promise.all([
      Organization.findById(orgId).select('name slug description createdAt').lean(),
      User.countDocuments({ role: 'recruiter', organizationId: orgId }),
      User.countDocuments({ role: 'recruiter', organizationId: orgId, isActive: true }),
      Team.countDocuments({ organizationId: orgId }),
      Job.countDocuments({ organizationId: orgId }),
      Invitation.countDocuments({ organizationId: orgId, status: 'pending', expiresAt: { $gt: new Date() } }),
      Membership.countDocuments({ organizationId: orgId, status: 'active', teamId: null })
    ]);

    return res.json({
      organization,
      stats: {
        recruitersCount,
        activeRecruitersCount,
        inactiveRecruitersCount: recruitersCount - activeRecruitersCount,
        teamsCount,
        jobsCount,
        pendingInvitationsCount,
        membersCount
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
      .select('name slug description createdAt ownerId')
      .lean();

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    return res.json({ organization });
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

    if (!name) {
      return res.status(400).json({ message: 'Organization name is required.' });
    }

    const organization = await Organization.findByIdAndUpdate(
      orgId,
      { $set: { name, description } },
      { new: true }
    ).select('name slug description createdAt').lean();

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    return res.json({ organization, message: 'Organization preferences updated.' });
  } catch (error) {
    console.error('Admin console update preferences error:', error.message);
    return res.status(500).json({ message: 'Failed to update organization preferences.' });
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
  updateConsolePreferences
};
