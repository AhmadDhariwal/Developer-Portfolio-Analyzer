const bcrypt = require('bcryptjs');
const User = require('../../models/user');

const sanitizeRecruiter = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
  githubUsername: user.githubUsername,
  createdAt: user.createdAt
});

const getRecruiters = async (req, res) => {
  try {
    const recruiters = await User.find({
      role: 'recruiter',
      organizationId: req.organizationId
    })
      .select('_id name email role organizationId githubUsername createdAt')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ recruiters });
  } catch (error) {
    console.error('Admin recruiters error:', error.message);
    return res.status(500).json({ message: 'Failed to load recruiters.' });
  }
};

const createRecruiter = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      githubUsername = ''
    } = req.body || {};

    const safeName = String(name || '').trim();
    const safeEmail = String(email || '').trim().toLowerCase();
    const safePassword = String(password || '');

    if (!safeName || !safeEmail || !safePassword) {
      return res.status(400).json({ message: 'name, email, and password are required.' });
    }

    if (safePassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ email: safeEmail }).lean();
    if (existing) {
      return res.status(409).json({ message: 'A user with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(safePassword, salt);

    const fallbackGithubUsername = safeEmail.includes('@')
      ? safeEmail.split('@')[0]
      : `recruiter_${Date.now()}`;

    const recruiter = await User.create({
      name: safeName,
      email: safeEmail,
      password: hashedPassword,
      githubUsername: String(githubUsername || '').trim() || fallbackGithubUsername,
      activeGithubUsername: String(githubUsername || '').trim() || fallbackGithubUsername,
      role: 'recruiter',
      organizationId: req.organizationId,
      isPublic: false,
      isVerified: true,
      activeCareerStack: 'Full Stack',
      activeExperienceLevel: 'Student'
    });

    return res.status(201).json({ recruiter: sanitizeRecruiter(recruiter) });
  } catch (error) {
    console.error('Admin create recruiter error:', error.message);
    return res.status(500).json({ message: 'Failed to create recruiter.' });
  }
};

module.exports = {
  getRecruiters,
  createRecruiter
};
