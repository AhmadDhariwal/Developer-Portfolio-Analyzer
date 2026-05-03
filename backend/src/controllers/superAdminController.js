const Organization = require('../models/organization');
const User = require('../models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Analysis = require('../models/analysis');

const parsePage = (q) => ({ page: Math.max(1, parseInt(q.page, 10) || 1), limit: Math.min(100, parseInt(q.limit, 10) || 20) });

const getAllOrganizations = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = {};
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };
    if (req.query.suspended === 'true') filter.isSuspended = true;
    if (req.query.suspended === 'false') filter.isSuspended = false;

    const [organizations, total] = await Promise.all([
      Organization.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('ownerId', 'name email').lean(),
      Organization.countDocuments(filter)
    ]);

    res.json({ organizations, total, page, totalPages: Math.ceil(total / limit) });
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

const getAllAdmins = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'admin' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];

    const [admins, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ admins, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch admins', error: err?.message });
  }
};

const getAllRecruiters = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'recruiter' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (req.query.organizationId) {
      const memberUserIds = await Membership.find({ organizationId: req.query.organizationId, status: 'active' }).distinct('userId');
      filter._id = { $in: memberUserIds };
    }

    const [recruiters, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ recruiters, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch recruiters', error: err?.message });
  }
};

const getAllDevelopers = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'developer' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (req.query.careerStack) filter.careerStack = req.query.careerStack;
    if (req.query.experienceLevel) filter.experienceLevel = req.query.experienceLevel;

    const [developers, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ developers, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch developers', error: err?.message });
  }
};

const getAllTeams = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = {};
    if (req.query.organizationId) filter.organizationId = req.query.organizationId;
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };

    const [teams, total] = await Promise.all([
      Team.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('organizationId', 'name').lean(),
      Team.countDocuments(filter)
    ]);
    res.json({ teams, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch teams', error: err?.message });
  }
};

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

const getPlatformMetrics = async (req, res) => {
  try {
    const [totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses] = await Promise.all([
      Organization.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'developer' }),
      Team.countDocuments(),
      Analysis.countDocuments()
    ]);

    // Growth: orgs created in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [recentOrgs, recentUsers] = await Promise.all([
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
    ]);

    // Latest organizations
    const latestOrgs = await Organization.find().sort({ createdAt: -1 }).limit(5)
      .populate('ownerId', 'name email').lean();

    // Top developers by score
    const topDevelopers = await User.find({ role: 'developer' }).sort({ score: -1 }).limit(5)
      .select('name email githubUsername score careerStack').lean();

    // Active admins
    const activeAdmins = await User.find({ role: 'admin', isActive: true }).sort({ createdAt: -1 }).limit(5)
      .select('name email organizationId createdAt').lean();

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

module.exports = {
  getAllOrganizations,
  suspendOrganization,
  activateOrganization,
  getAllAdmins,
  getAllRecruiters,
  getAllDevelopers,
  getAllTeams,
  toggleUserActive,
  getPlatformMetrics
};
