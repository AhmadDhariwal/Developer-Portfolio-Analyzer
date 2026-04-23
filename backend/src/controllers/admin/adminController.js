const User = require('../../models/user');
const PublicProfile = require('../../models/publicProfile');
const Job = require('../../models/Job');

const DEVELOPER_ROLE_VALUES = ['developer', 'user'];

const resolveVisibleDeveloperUsers = async () => {
  const [publicUsers, publicProfiles] = await Promise.all([
    User.find({ role: { $in: DEVELOPER_ROLE_VALUES }, isPublic: true })
      .select('_id')
      .lean(),
    PublicProfile.find({ isPublic: true })
      .select('userId slug')
      .lean()
  ]);

  const visibleIds = new Set();
  const slugByUserId = new Map();

  publicUsers.forEach((entry) => visibleIds.add(String(entry._id)));
  publicProfiles.forEach((entry) => {
    if (entry?.userId) {
      const key = String(entry.userId);
      visibleIds.add(key);
      if (entry.slug) slugByUserId.set(key, String(entry.slug));
    }
  });

  if (!visibleIds.size) {
    return [];
  }

  const users = await User.find({
    _id: { $in: Array.from(visibleIds) },
    role: { $in: DEVELOPER_ROLE_VALUES }
  })
    .select('name email githubUsername jobTitle location avatar isPublic createdAt')
    .sort({ createdAt: -1 })
    .lean();

  return users.map((user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    githubUsername: user.githubUsername,
    jobTitle: user.jobTitle || '',
    location: user.location || '',
    avatar: user.avatar || '',
    isPublic: Boolean(user.isPublic || slugByUserId.has(String(user._id))),
    publicProfileSlug: slugByUserId.get(String(user._id)) || null,
    createdAt: user.createdAt
  }));
};

const getOrganizationOverview = async (req, res) => {
  try {
    const organizationId = req.organizationId;

    const [recruitersCount, jobsCount, developers] = await Promise.all([
      User.countDocuments({ role: 'recruiter', organizationId }),
      Job.countDocuments({ organizationId }),
      resolveVisibleDeveloperUsers()
    ]);

    return res.status(200).json({
      overview: {
        organizationId,
        recruitersCount,
        jobsCount,
        globalDevelopersCount: developers.length
      }
    });
  } catch (error) {
    console.error('Admin organization overview error:', error.message);
    return res.status(500).json({ message: 'Failed to load admin overview.' });
  }
};

const getDevelopers = async (_req, res) => {
  try {
    const developers = await resolveVisibleDeveloperUsers();
    return res.status(200).json({ developers });
  } catch (error) {
    console.error('Admin developers error:', error.message);
    return res.status(500).json({ message: 'Failed to load public developers.' });
  }
};

module.exports = {
  getOrganizationOverview,
  getDevelopers
};
