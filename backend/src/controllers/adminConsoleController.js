/**
 * Admin Console Controller
 * Organization-scoped endpoints for the org admin console.
 * All handlers assume req.organizationId is set by requireOrganizationContext middleware.
 */

const User = require('../models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Invitation = require('../models/invitation');
const AuditLog = require('../models/auditLog');
const Organization = require('../models/organization');
const Analysis = require('../models/analysis');
const AnalysisCache = require('../models/analysisCache');
const Job = require('../models/Job');

// ── helpers ───────────────────────────────────────────────────────────────
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v || 0)));

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

    const teamIds = teams.map((t) => t._id);
    const memberships = await Membership.find({
      organizationId: orgId,
      teamId: { $in: teamIds },
      status: 'active'
    })
      .populate('userId', 'name email role isActive')
      .lean();

    const membersByTeam = new Map();
    memberships.forEach((m) => {
      const key = String(m.teamId);
      if (!membersByTeam.has(key)) membersByTeam.set(key, []);
      membersByTeam.get(key).push({
        _id: m.userId?._id,
        name: m.userId?.name,
        email: m.userId?.email,
        role: m.role,
        isActive: m.userId?.isActive !== false
      });
    });

    const enrichedTeams = teams.map((t) => ({
      ...t,
      members: membersByTeam.get(String(t._id)) || [],
      memberCount: (membersByTeam.get(String(t._id)) || []).length
    }));

    return res.json({ teams: enrichedTeams });
  } catch (error) {
    console.error('Admin console teams error:', error.message);
    return res.status(500).json({ message: 'Failed to load teams.' });
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
  getConsolePreferences,
  updateConsolePreferences
};
