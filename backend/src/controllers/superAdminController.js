const Organization = require('../models/organization');
const User = require('../models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Analysis = require('../models/analysis');

const parsePage = (q) => ({
  page: Math.max(1, parseInt(q.page, 10) || 1),
  limit: Math.min(100, parseInt(q.limit, 10) || 20)
});

const getMonthlyRange = () => {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ start, end, label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
  }
  return months;
};

const countMonthly = async (Model, filter = {}, months) =>
  Promise.all(months.map(m =>
    Model.countDocuments({ ...filter, createdAt: { $gte: m.start, $lt: m.end } }).catch(() => 0)
  ));

// ── GET /metrics ─────────────────────────────────────────────────────────────
const getPlatformMetrics = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses, recentOrgs, recentUsers] = await Promise.all([
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
      User.find({ role: 'developer' }).sort({ score: -1 }).limit(5).select('name email githubUsername score careerStack').lean(),
      User.find({ role: 'admin', isActive: true }).sort({ createdAt: -1 }).limit(5).select('name email organizationId createdAt').lean()
    ]);

    res.json({
      metrics: { totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses, recentOrgs, recentUsers },
      latestOrgs,
      topDevelopers,
      activeAdmins
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
    const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const months = getMonthlyRange();

    const [
      totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses,
      recentOrgs, priorOrgs, recentUsers,
      latestOrgs, topDevelopers, activeAdmins
    ] = await Promise.all([
      Organization.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'developer' }),
      Team.countDocuments(),
      Analysis.countDocuments(),
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.find().sort({ createdAt: -1 }).limit(5).populate('ownerId', 'name email').lean(),
      User.find({ role: 'developer' }).sort({ score: -1 }).limit(5).select('name email githubUsername score careerStack experienceLevel').lean(),
      User.find({ role: 'admin', isActive: true }).sort({ createdAt: -1 }).limit(5).select('name email organizationId createdAt').lean()
    ]);

    const platformGrowth = priorOrgs > 0 ? Math.round(((recentOrgs - priorOrgs) / priorOrgs) * 100) : 0;

    const [orgMonthly, adminMonthly, recruiterMonthly, developerMonthly, analysisMonthly] = await Promise.all([
      countMonthly(Organization, {}, months),
      countMonthly(User, { role: 'admin' }, months),
      countMonthly(User, { role: 'recruiter' }, months),
      countMonthly(User, { role: 'developer' }, months),
      countMonthly(Analysis, {}, months)
    ]);

    // Role distribution for pie chart
    const roleDistribution = [
      { role: 'Admins',     count: totalAdmins },
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
      metrics: { totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses, recentOrgs, recentUsers, platformGrowth },
      latestOrgs,
      topDevelopers,
      activeAdmins,
      charts: {
        monthLabels: months.map(m => m.label),
        userGrowth: { organizations: orgMonthly, admins: adminMonthly, recruiters: recruiterMonthly, developers: developerMonthly },
        analysisGrowth: analysisMonthly,
        roleDistribution,
        stackDistribution: stackDist.map(s => ({ stack: s._id, count: s.count })),
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
    const months = getMonthlyRange();

    const [orgMonthly, adminMonthly, recruiterMonthly, developerMonthly, analysisMonthly] = await Promise.all([
      countMonthly(Organization, {}, months),
      countMonthly(User, { role: 'admin' }, months),
      countMonthly(User, { role: 'recruiter' }, months),
      countMonthly(User, { role: 'developer' }, months),
      countMonthly(Analysis, {}, months)
    ]);

    res.json({
      monthLabels: months.map(m => m.label),
      userGrowth: { organizations: orgMonthly, admins: adminMonthly, recruiters: recruiterMonthly, developers: developerMonthly },
      analysisGrowth: analysisMonthly
    });
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
      Organization.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('ownerId', 'name email').lean(),
      Organization.countDocuments(filter)
    ]);
    res.json({ organizations, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch organizations', error: err?.message });
  }
};

const suspendOrganization = async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, { isSuspended: true }, { new: true }).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ organization: org });
  } catch (err) {
    res.status(500).json({ message: 'Failed to suspend organization', error: err?.message });
  }
};

const activateOrganization = async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, { isSuspended: false }, { new: true }).lean();
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
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];

    const [admins, total] = await Promise.all([
      User.find(filter).select('-password').populate('organizationId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
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
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (req.query.organizationId) {
      const ids = await Membership.find({ organizationId: req.query.organizationId, status: 'active' }).distinct('userId');
      filter._id = { $in: ids };
    }

    const [recruiters, total] = await Promise.all([
      User.find(filter).select('-password').populate('organizationId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ recruiters, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch recruiters', error: err?.message });
  }
};

// ── GET /developers ───────────────────────────────────────────────────────────
const getAllDevelopers = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'developer' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (req.query.careerStack) filter.careerStack = req.query.careerStack;
    if (req.query.experienceLevel) filter.experienceLevel = req.query.experienceLevel;

    const [developers, total] = await Promise.all([
      User.find(filter).select('-password').sort({ score: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
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
      Team.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('organizationId', 'name').lean(),
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
    if (user.role === 'super_admin') return res.status(403).json({ message: 'Cannot deactivate super admin.' });
    const updated = await User.findByIdAndUpdate(req.params.id, { isActive: !user.isActive }, { new: true }).select('-password').lean();
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle user status', error: err?.message });
  }
};

module.exports = {
  getPlatformMetrics, getDashboard, getAnalytics,
  getAllOrganizations, suspendOrganization, activateOrganization,
  getAllAdmins, getAllRecruiters, getAllDevelopers, getAllTeams, toggleUserActive
};
