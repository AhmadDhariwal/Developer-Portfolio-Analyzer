const Organization = require('../../admin/models/organization');
const User = require('../../auth/models/user');
const Job = require('../../recruiter/models/Job');
const Recruiter = require('../../recruiter/models/Recruiter');
const Membership = require('../../admin/models/membership');
const Team = require('../../admin/models/team');
const Analysis = require('../../skill-gap/models/analysis');
const Recommendation = require('../../recommendations/models/recommendation');
const Invitation = require('../../admin/models/invitation');
const Candidate = require('../../recruiter/models/Candidate');
const bcrypt = require('bcryptjs');
const { validatePasswordAgainstPolicy } = require('../../auth/utils/passwordPolicy');

const parsePage = (q) => ({
  page: Math.max(1, parseInt(q.page, 10) || 1),
  limit: Math.min(100, parseInt(q.limit, 10) || 30)
});
const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const isTruthy = (value) => String(value || '').toLowerCase() === 'true';
const isFalsy = (value) => String(value || '').toLowerCase() === 'false';
const intersectIdSets = (currentIds = null, nextIds = []) => {
  const normalizedNextIds = (nextIds || []).map((value) => String(value || '')).filter(Boolean);
  if (!currentIds) return normalizedNextIds;
  const nextSet = new Set(normalizedNextIds);
  return currentIds.filter((value) => nextSet.has(String(value || '')));
};
const {
  getMonthlyRange,
  countMonthly,
  mapRecentOrganization,
  mapRecentInvite,
  mapRecentDeveloper,
  mapRecentAnalysis,
  getPlatformAnalyticsData,
} = require('../services/superAdminAnalyticsService');

// ── GET /metrics ─────────────────────────────────────────────────────────────
const getPlatformMetrics = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalOrgs,
      totalAdmins,
      totalRecruiters,
      totalDevelopers,
      totalTeams,
      totalAnalyses,
      recentOrgs,
      recentUsers
    ] = await Promise.all([
      Organization.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'developer' }),
      Team.countDocuments(),
      Analysis.countDocuments(),
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
    ]);

    const [latestOrgs, topDevelopers, activeAdmins] = await Promise.all([
      Organization.find().sort({ createdAt: -1 }).limit(5).populate('ownerId', 'name email').lean(),
      User.find({ role: 'developer' })
        .sort({ score: -1 })
        .limit(5)
        .select('name email githubUsername score careerStack')
        .lean(),
      User.find({ role: 'admin', isActive: true })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name email organizationId createdAt')
        .lean()
    ]);

    const [
      recentOrganizations,
      recentRecruiterInvites,
      recentDeveloperRegistrations,
      recentAiAnalyses
    ] = await Promise.all([
      Organization.find().sort({ createdAt: -1 }).limit(4).populate('ownerId', 'name email').lean(),
      Invitation.find({ role: 'recruiter' })
        .sort({ createdAt: -1 })
        .limit(4)
        .populate('organizationId', 'name')
        .populate('invitedBy', 'name email')
        .select('name email role status createdAt organizationId invitedBy')
        .lean(),
      User.find({ role: 'developer' })
        .sort({ createdAt: -1 })
        .limit(4)
        .populate('organizationId', 'name')
        .select('name email careerStack experienceLevel isActive createdAt organizationId')
        .lean(),
      Analysis.find()
        .sort({ createdAt: -1 })
        .limit(4)
        .populate('userId', 'name email careerStack')
        .select('githubScore readinessScore createdAt userId')
        .lean()
    ]);

    res.json({
      metrics: {
        totalOrgs,
        totalAdmins,
        totalRecruiters,
        totalDevelopers,
        totalTeams,
        totalAnalyses,
        recentOrgs,
        recentUsers
      },
      latestOrgs,
      topDevelopers,
      activeAdmins,
      recentActivity: {
        organizations: recentOrganizations.map(mapRecentOrganization),
        recruiterInvites: recentRecruiterInvites.map(mapRecentInvite),
        developerRegistrations: recentDeveloperRegistrations.map(mapRecentDeveloper),
        aiAnalyses: recentAiAnalyses.map(mapRecentAnalysis)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch platform metrics', error: err?.message });
  }
};

// ── GET /dashboard ────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const months = getMonthlyRange();

    const [
      totalOrgs,
      activeOrgs,
      totalAdmins,
      totalRecruiters,
      totalDevelopers,
      totalTeams,
      totalAnalyses,
      recentOrgs,
      priorOrgs,
      recentUsers,
      latestOrgs,
      topDevelopers,
      activeAdmins
    ] = await Promise.all([
      Organization.countDocuments(),
      Organization.countDocuments({ isSuspended: { $ne: true } }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'developer' }),
      Team.countDocuments(),
      Analysis.countDocuments(),
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.find().sort({ createdAt: -1 }).limit(5).populate('ownerId', 'name email').lean(),
      User.find({ role: 'developer' })
        .sort({ score: -1 })
        .limit(5)
        .select('name email githubUsername score careerStack experienceLevel')
        .lean(),
      User.find({ role: 'admin', isActive: true })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name email organizationId createdAt')
        .lean()
    ]);

    const platformGrowth =
      priorOrgs > 0 ? Math.round(((recentOrgs - priorOrgs) / priorOrgs) * 100) : 0;

    const [orgMonthly, adminMonthly, recruiterMonthly, developerMonthly, analysisMonthly] =
      await Promise.all([
        countMonthly(Organization, {}, months),
        countMonthly(User, { role: 'admin' }, months),
        countMonthly(User, { role: 'recruiter' }, months),
        countMonthly(User, { role: 'developer' }, months),
        countMonthly(Analysis, {}, months)
      ]);

    // Role distribution for pie chart
    const roleDistribution = [
      { role: 'Admins', count: totalAdmins },
      { role: 'Recruiters', count: totalRecruiters },
      { role: 'Developers', count: totalDevelopers }
    ];

    // Stack distribution
    const stackDist = await User.aggregate([
      { $match: { role: 'developer', careerStack: { $ne: null, $ne: '' } } },
      { $group: { _id: '$careerStack', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).catch(() => []);

    // Top orgs by member count
    const topOrgs = await Membership.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$organizationId', memberCount: { $sum: 1 } } },
      { $lookup: { from: 'organizations', localField: '_id', foreignField: '_id', as: 'org' } },
      { $unwind: '$org' },
      { $project: { _id: 0, name: '$org.name', memberCount: 1, isSuspended: '$org.isSuspended' } },
      { $sort: { memberCount: -1 } },
      { $limit: 5 }
    ]).catch(() => []);

    res.json({
      metrics: {
        totalOrgs,
        activeOrgs,
        totalAdmins,
        totalRecruiters,
        totalDevelopers,
        totalTeams,
        totalAnalyses,
        recentOrgs,
        recentUsers,
        platformGrowth
      },
      latestOrgs,
      topDevelopers,
      activeAdmins,
      charts: {
        monthLabels: months.map((m) => m.label),
        userGrowth: {
          organizations: orgMonthly,
          admins: adminMonthly,
          recruiters: recruiterMonthly,
          developers: developerMonthly
        },
        analysisGrowth: analysisMonthly,
        roleDistribution,
        stackDistribution: stackDist.map((s) => ({ stack: s._id, count: s.count })),
        topOrgs
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch dashboard', error: err?.message });
  }
};


// ── GET /analytics ────────────────────────────────────────────────────────────
const getAnalytics = async (req, res) => {
  try {
    const payload = await getPlatformAnalyticsData(req.query);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch analytics', error: err?.message });
  }
};

// ── GET /organizations ────────────────────────────────────────────────────────
const getAllOrganizations = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = {};
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };
    if (req.query.suspended === 'true') filter.isSuspended = true;
    if (req.query.suspended === 'false') filter.isSuspended = false;

    const [organizations, total] = await Promise.all([
      Organization.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('ownerId', 'name email')
        .lean(),
      Organization.countDocuments(filter)
    ]);
    res.json({ organizations, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch organizations', error: err?.message });
  }
};

const suspendOrganization = async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(
      req.params.id,
      { isSuspended: true },
      { returnDocument: 'after' }
    ).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ organization: org });
  } catch (err) {
    res.status(500).json({ message: 'Failed to suspend organization', error: err?.message });
  }
};

const activateOrganization = async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(
      req.params.id,
      { isSuspended: false },
      { returnDocument: 'after' }
    ).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ organization: org });
  } catch (err) {
    res.status(500).json({ message: 'Failed to activate organization', error: err?.message });
  }
};

// ── GET /admins ───────────────────────────────────────────────────────────────
const getAllAdmins = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'admin' };
    if (req.query.search)
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    if (req.query.organizationId) filter.organizationId = req.query.organizationId;
    if (isTruthy(req.query.active)) filter.isActive = true;
    if (isFalsy(req.query.active)) filter.isActive = false;
    if (req.query.teamId) {
      const teamMemberIds = await Membership.find({
        teamId: req.query.teamId,
        status: 'active'
      }).distinct('userId');
      filter._id = { $in: teamMemberIds };
    }

    const [admins, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .populate('organizationId', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);
    res.json({ admins, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch admins', error: err?.message });
  }
};

// ── GET /recruiters ───────────────────────────────────────────────────────────
const getAllRecruiters = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'recruiter' };
    let scopedIds = null;
    // basic text search
    if (req.query.search)
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    if (isTruthy(req.query.active)) filter.isActive = true;
    if (isFalsy(req.query.active)) filter.isActive = false;
    // organization scope
    if (req.query.organizationId) {
      const ids = await Membership.find({
        organizationId: req.query.organizationId,
        status: 'active'
      }).distinct('userId');
      scopedIds = intersectIdSets(scopedIds, ids);
    }
    // team scope
    if (req.query.teamId) {
      const teamMemberIds = await Membership.find({
        teamId: req.query.teamId,
        status: 'active'
      }).distinct('userId');
      scopedIds = intersectIdSets(scopedIds, teamMemberIds);
    }
    // stack/experience filter
    if (req.query.stack) filter.careerStack = req.query.stack;
    // joined date range
    if (req.query.joinedFrom || req.query.joinedTo) {
      filter.createdAt = {};
      if (req.query.joinedFrom) filter.createdAt.$gte = new Date(req.query.joinedFrom);
      if (req.query.joinedTo) filter.createdAt.$lte = new Date(req.query.joinedTo);
    }
    // sorting
    const sortField = req.query.sort || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    if (scopedIds) filter._id = { $in: scopedIds };

    const [recruiters, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .populate('organizationId', 'name')
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    // enrich each recruiter with analytics-like data
    const enriched = await Promise.all(
      recruiters.map(async (rec) => {
        const recruiterId = rec._id;
        // assigned teams
        const memberships = await Membership.find({ userId: recruiterId, status: 'active' })
          .populate('teamId', 'name _id')
          .lean();
        const assignedTeams = memberships
          .map((m) => (m.teamId ? { _id: m.teamId._id, name: m.teamId.name } : null))
          .filter(Boolean);

        // analytics-like metrics
        const totalCandidatesAnalyzed = await Candidate.countDocuments({ createdBy: recruiterId });
        const candidateIds = await Candidate.find({ createdBy: recruiterId }).distinct('_id');
        const matchesGenerated = await Recommendation.countDocuments({
          userId: { $in: candidateIds }
        });
        const totalJobs = await Job.countDocuments({ recruiterId });
        const closedJobs = await Job.countDocuments({ recruiterId, status: 'closed' });
        const hiringRate = totalJobs > 0 ? Math.round((closedJobs / totalJobs) * 100) : 0;
        // activity score based on last activity (candidate or job) vs now
        const lastCandidate = await Candidate.find({ createdBy: recruiterId })
          .sort({ createdAt: -1 })
          .limit(1)
          .lean();
        const lastJob = await Job.find({ recruiterId }).sort({ createdAt: -1 }).limit(1).lean();
        const lastActiveDate =
          [lastCandidate[0]?.createdAt, lastJob[0]?.createdAt, rec.createdAt]
            .filter(Boolean)
            .sort((a, b) => b - a)[0] || rec.createdAt;
        const daysSince = Math.floor(
          (Date.now() - new Date(lastActiveDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        const activityScore = Math.max(0, Math.min(100, 100 - daysSince * 2));

        return {
          ...rec,
          organizationName: rec?.organizationId?.name,
          assignedTeams,
          totalCandidatesAnalyzed,
          matchesGenerated,
          hiringRate,
          activityScore,
          lastActive: lastActiveDate,
          status: rec.isActive ? 'Active' : 'Inactive',
          applicationRoute: '/super-admin/users/' + rec._id
        };
      })
    );

    res.json({ recruiters: enriched, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch recruiters', error: err?.message });
  }
};

// ── GET /recruiters/:id/analytics ─────────────────────────────────────────────
const getRecruiterAnalytics = async (req, res) => {
  try {
    const recruiterId = req.params.id;
    const recruiter = await User.findById(recruiterId).select('-password').lean();
    if (!recruiter) return res.status(404).json({ message: 'Recruiter not found.' });

    // compute a small analytics snapshot
    const totalCandidatesAnalyzed = await Candidate.countDocuments({ createdBy: recruiterId });
    const candidateIds = await Candidate.find({ createdBy: recruiterId }).distinct('_id');
    const matchesGenerated = await Recommendation.countDocuments({ userId: { $in: candidateIds } });
    const totalJobs = await Job.countDocuments({ recruiterId });
    const closedJobs = await Job.countDocuments({ recruiterId, status: 'closed' });
    const hiringRate = totalJobs > 0 ? Math.round((closedJobs / totalJobs) * 100) : 0;
    const lastCandidate = await Candidate.find({ createdBy: recruiterId })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean();
    const lastJob = await Job.find({ recruiterId }).sort({ createdAt: -1 }).limit(1).lean();
    const lastActiveDate =
      [lastCandidate[0]?.createdAt, lastJob[0]?.createdAt, recruiter.createdAt]
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || recruiter.createdAt;
    const daysSince = Math.floor(
      (Date.now() - new Date(lastActiveDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    const activityScore = Math.max(0, Math.min(100, 100 - daysSince * 2));

    res.json({
      recruiter,
      analytics: {
        totalCandidatesAnalyzed,
        matchesGenerated,
        hiringRate,
        activityScore,
        lastActive: lastActiveDate
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch recruiter analytics', error: err?.message });
  }
};

// ── POST /recruiters/:id/teams ───────────────────────────────────────────────
const assignTeamToRecruiter = async (req, res) => {
  try {
    const recruiterId = req.params.id;
    const teamId = req.body.teamId;
    if (!teamId) return res.status(400).json({ message: 'teamId is required' });
    const team = await Team.findById(teamId).lean();
    if (!team) return res.status(404).json({ message: 'Team not found' });

    // upsert membership for recruiter to team
    const MembershipModel = Membership;
    const exist = await MembershipModel.findOne({
      userId: recruiterId,
      teamId,
      status: 'active'
    }).lean();
    if (exist) return res.json({ message: 'Already assigned', membership: exist });
    const membership = await MembershipModel.create({
      organizationId: team.organizationId,
      teamId,
      userId: recruiterId,
      role: 'member',
      status: 'active'
    });
    res.status(201).json({ membership });
  } catch (err) {
    res.status(500).json({ message: 'Failed to assign team to recruiter', error: err?.message });
  }
};

// ── DELETE /recruiters/:id/teams/:teamId ───────────────────────────────────
const removeRecruiterTeam = async (req, res) => {
  try {
    const recruiterId = req.params.id;
    const teamId = req.params.teamId;
    if (!teamId) return res.status(400).json({ message: 'teamId is required' });
    await Membership.deleteOne({ userId: recruiterId, teamId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to remove recruiter from team', error: err?.message });
  }
};

// ── DELETE /users/:id ────────────────────────────────────────────────
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.role === 'super_admin')
      return res.status(403).json({ message: 'Cannot delete super admin.' });

    await require('../../integrations/services/integrationPersistenceService').deleteAccount(
      user._id,
      async (session) => {
        await User.deleteOne({ _id: user._id }, { session });
      }
    );
    await Promise.all([
      Membership.deleteMany({ userId: user._id }),
      Invitation.updateMany(
        { email: user.email, role: 'recruiter', status: 'pending' },
        { $set: { status: 'revoked' } }
      )
    ]);

    return res.json({ message: 'User deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete user.', error: err?.message });
  }
};

// ── GET /developers ───────────────────────────────────────────────────────────
const getAllDevelopers = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'developer' };
    let scopedIds = null;
    if (req.query.search)
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    if (req.query.careerStack) filter.careerStack = req.query.careerStack;
    if (req.query.experienceLevel) filter.experienceLevel = req.query.experienceLevel;
    if (isTruthy(req.query.active)) filter.isActive = true;
    if (isFalsy(req.query.active)) filter.isActive = false;
    if (req.query.organizationId) {
      const ids = await Membership.find({
        organizationId: req.query.organizationId,
        status: 'active'
      }).distinct('userId');
      scopedIds = intersectIdSets(scopedIds, ids);
    }
    if (req.query.teamId) {
      const teamMemberIds = await Membership.find({
        teamId: req.query.teamId,
        status: 'active'
      }).distinct('userId');
      scopedIds = intersectIdSets(scopedIds, teamMemberIds);
    }
    if (scopedIds) filter._id = { $in: scopedIds };

    const [developers, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ score: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);
    res.json({ developers, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch developers', error: err?.message });
  }
};

// ── GET /teams ────────────────────────────────────────────────────────────────
const getAllTeams = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = {};
    if (req.query.organizationId) filter.organizationId = req.query.organizationId;
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };

    const [teams, total] = await Promise.all([
      Team.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('organizationId', 'name')
        .lean(),
      Team.countDocuments(filter)
    ]);
    res.json({ teams, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch teams', error: err?.message });
  }
};

// ── PATCH /users/:id/toggle-active ───────────────────────────────────────────
const toggleUserActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.role === 'super_admin')
      return res.status(403).json({ message: 'Cannot deactivate super admin.' });
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: !user.isActive },
      { returnDocument: 'after' }
    )
      .select('-password')
      .lean();
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle user status', error: err?.message });
  }
};

// ── GET /users/:id (full details) ──────────────────────────────────────────────
const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('organizationId', 'name isSuspended createdAt')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const memberships = await Membership.find({ userId: user._id, status: 'active' })
      .populate('organizationId', 'name')
      .populate('teamId', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ user, memberships });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch user details', error: err?.message });
  }
};

// ── POST /users (create admin/recruiter/developer) ─────────────────────────────
const createUser = async (req, res) => {
  try {
    const role = String(req.body.role || '').toLowerCase();
    if (!['admin', 'recruiter', 'developer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role.' });
    }

    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const organizationId = req.body.organizationId || null;

    if (!name) return res.status(400).json({ message: 'Name is required.' });
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    const passwordPolicy = validatePasswordAgainstPolicy(password);
    if (!passwordPolicy.valid) return res.status(400).json({ message: passwordPolicy.message });

    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) return res.status(409).json({ message: 'Email already exists.' });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      role,
      isVerified: true,
      isActive: true,
      organizationId: organizationId || null,
      careerStack: req.body.careerStack || undefined,
      experienceLevel: req.body.experienceLevel || undefined
    });

    // Best-effort membership for org-scoped access and filtering
    if (organizationId) {
      const membershipRole = role === 'admin' ? 'admin' : 'member';
      await Membership.updateOne(
        { organizationId, userId: user._id, teamId: null },
        {
          $setOnInsert: {
            organizationId,
            userId: user._id,
            teamId: null,
            role: membershipRole,
            status: 'active',
            invitedBy: req.user?._id || null
          }
        },
        { upsert: true }
      );
    }

    const created = await User.findById(user._id)
      .select('-password')
      .populate('organizationId', 'name')
      .lean();
    return res.status(201).json({ user: created });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create user', error: err?.message });
  }
};

// ── PATCH /users/:id (edit user) ───────────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.role === 'super_admin')
      return res.status(403).json({ message: 'Cannot modify super admin.' });

    const update = {};

    if (req.body.name !== undefined) update.name = String(req.body.name || '').trim();
    if (req.body.email !== undefined) update.email = normalizeEmail(req.body.email);
    if (req.body.phoneNumber !== undefined) update.phoneNumber = String(req.body.phoneNumber || '');
    if (req.body.countryCode !== undefined) update.countryCode = String(req.body.countryCode || '');
    if (req.body.githubUsername !== undefined)
      update.githubUsername = String(req.body.githubUsername || '');
    if (req.body.linkedin !== undefined) update.linkedin = String(req.body.linkedin || '');
    if (req.body.website !== undefined) update.website = String(req.body.website || '');
    if (req.body.bio !== undefined) update.bio = String(req.body.bio || '');
    if (req.body.location !== undefined) update.location = String(req.body.location || '');
    if (req.body.jobTitle !== undefined) update.jobTitle = String(req.body.jobTitle || '');
    if (req.body.careerStack !== undefined) update.careerStack = req.body.careerStack;
    if (req.body.experienceLevel !== undefined) update.experienceLevel = req.body.experienceLevel;
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);

    if (req.body.role !== undefined) {
      const nextRole = String(req.body.role || '').toLowerCase();
      if (!['admin', 'recruiter', 'developer'].includes(nextRole)) {
        return res.status(400).json({ message: 'Invalid role.' });
      }
      update.role = nextRole;
    }

    const nextOrgId =
      req.body.organizationId === undefined ? user.organizationId : req.body.organizationId || null;
    update.organizationId = nextOrgId;

    if (req.body.password) {
      const nextPassword = String(req.body.password);
      const passwordPolicy = validatePasswordAgainstPolicy(nextPassword);
      if (!passwordPolicy.valid) return res.status(400).json({ message: passwordPolicy.message });
      update.password = await bcrypt.hash(nextPassword, 10);
    }

    // Ensure email uniqueness on change
    if (update.email && update.email !== user.email) {
      const existing = await User.findOne({ email: update.email }).select('_id').lean();
      if (existing) return res.status(409).json({ message: 'Email already exists.' });
    }

    const updated = await User.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' })
      .select('-password')
      .populate('organizationId', 'name')
      .lean();

    // Best-effort membership sync if org is set
    if (nextOrgId) {
      const effectiveRole = String(updated.role || user.role);
      const membershipRole = effectiveRole === 'admin' ? 'admin' : 'member';
      await Membership.updateOne(
        { organizationId: nextOrgId, userId: updated._id, teamId: null },
        {
          $setOnInsert: {
            organizationId: nextOrgId,
            userId: updated._id,
            teamId: null,
            role: membershipRole,
            status: 'active',
            invitedBy: req.user?._id || null
          }
        },
        { upsert: true }
      );
    }

    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update user', error: err?.message });
  }
};

module.exports = {
  getPlatformMetrics,
  getDashboard,
  getAnalytics,
  getAllOrganizations,
  suspendOrganization,
  activateOrganization,
  getAllAdmins,
  getAllRecruiters,
  getAllDevelopers,
  getAllTeams,
  toggleUserActive,
  getUserDetails,
  createUser,
  updateUser,
  deleteUser,
  getRecruiterAnalytics,
  assignTeamToRecruiter,
  removeRecruiterTeam
};
