const User     = require('../models/user');
const Analysis = require('../models/analysis');
const bcrypt   = require('bcryptjs');

// ─── Helper: format member-since date ─────────────────────────────────────
const formatMemberSince = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

// @desc  Get logged-in user profile + account stats
// @route GET /api/profile/me
// @access Private
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Pull stats from latest analysis (optional — zero-out if none exists)
    const analysis = await Analysis.findOne({ userId: req.user._id });

    const stats = {
      developerScore:  analysis?.readinessScore ?? user.score ?? 0,
      reposAnalyzed:   analysis?.githubStats?.repos ?? 0,
      skillsDetected:  analysis?.githubStats?.stars  ?? 0,   // using stars as proxy until skills count stored
      memberSince:     formatMemberSince(user.createdAt),
    };

    res.json({
      _id:           user._id,
      name:          user.name,
      email:         user.email,
      githubUsername:user.githubUsername,
      avatar:        user.avatar,
      jobTitle:      user.jobTitle   || '',
      location:      user.location   || '',
      bio:           user.bio        || '',
      website:       user.website    || '',
      twitter:       user.twitter    || '',
      linkedin:      user.linkedin   || '',
      notifications: user.notifications || {
        weeklyScoreReport: true,
        skillTrendAlerts:  true,
        newRecommendations:false,
        jobMatchAlerts:    true,
      },
      stats,
    });
  } catch (error) {
    console.error('Profile GET error:', error.message);
    res.status(500).json({ message: 'Server error fetching profile.' });
  }
};

// @desc  Update profile fields + notification preferences
// @route PUT /api/profile/me
// @access Private
const updateProfile = async (req, res) => {
  try {
    const {
      name, jobTitle, location, bio,
      website, twitter, linkedin,
      notifications,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (name        !== undefined) user.name        = name;
    if (jobTitle    !== undefined) user.jobTitle    = jobTitle;
    if (location    !== undefined) user.location    = location;
    if (bio         !== undefined) user.bio         = bio;
    if (website     !== undefined) user.website     = website;
    if (twitter     !== undefined) user.twitter     = twitter;
    if (linkedin    !== undefined) user.linkedin    = linkedin;
    if (notifications !== undefined) {
      // Merge only valid notification keys, fallback to defaults if missing
      user.notifications = {
        weeklyScoreReport: notifications.weeklyScoreReport ?? user.notifications.weeklyScoreReport ?? true,
        skillTrendAlerts:  notifications.skillTrendAlerts  ?? user.notifications.skillTrendAlerts  ?? true,
        newRecommendations:notifications.newRecommendations?? user.notifications.newRecommendations?? false,
        jobMatchAlerts:    notifications.jobMatchAlerts    ?? user.notifications.jobMatchAlerts    ?? true
      };
    }

    const updated = await user.save();

    res.json({
      _id:           updated._id,
      name:          updated.name,
      email:         updated.email,
      githubUsername:updated.githubUsername,
      jobTitle:      updated.jobTitle,
      location:      updated.location,
      bio:           updated.bio,
      website:       updated.website,
      twitter:       updated.twitter,
      linkedin:      updated.linkedin,
      notifications: updated.notifications,
    });
  } catch (error) {
    console.error('Profile PUT error:', error.message);
    res.status(500).json({ message: 'Server error updating profile.' });
  }
};

// @desc  Change password
// @route PUT /api/profile/password
// @access Private
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both current and new passwords are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const salt           = await bcrypt.genSalt(10);
    user.password        = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Password update error:', error.message);
    res.status(500).json({ message: 'Server error updating password.' });
  }
};

// @desc  Delete account and all associated data
// @route DELETE /api/profile/me
// @access Private
const deleteAccount = async (req, res) => {
  try {
    await Analysis.deleteMany({ userId: req.user._id });
    await User.findByIdAndDelete(req.user._id);
    res.json({ message: 'Account deleted successfully.' });
  } catch (error) {
    console.error('Delete account error:', error.message);
    res.status(500).json({ message: 'Server error deleting account.' });
  }
};

module.exports = { getProfile, updateProfile, updatePassword, deleteAccount };
