const User     = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const bcrypt   = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const { createNotification } = require('../services/notificationService');

// ─── Helper: format member-since date ─────────────────────────────────────
const formatMemberSince = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const resolveAvatarForResponse = (req, avatarValue) => {
  const raw = String(avatarValue || '').trim();
  if (!raw) return '';
  if (/^data:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  if (raw.startsWith('/uploads/')) {
    return `${req.protocol}://${req.get('host')}${raw}`;
  }

  if (raw.startsWith('uploads/')) {
    return `${req.protocol}://${req.get('host')}/${raw}`;
  }

  return raw;
};

// @desc  Get logged-in user profile + account stats
// @route GET /api/profile/me
// @access Private
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const activeGithubUsername = user.activeGithubUsername || user.githubUsername;

    if (!user.defaultResumeFileId) {
      const latestAnalyzed = await ResumeFile.findOne({ userId: user._id, isAnalyzed: true }).sort({ uploadDate: -1 }).lean();
      const latestAny = latestAnalyzed || await ResumeFile.findOne({ userId: user._id }).sort({ uploadDate: -1 }).lean();
      if (latestAny) {
        user.defaultResumeFileId = latestAny._id;
        user.activeResumeFileId = latestAny._id;
        await user.save();
      }
    } else if (!user.activeResumeFileId) {
      user.activeResumeFileId = user.defaultResumeFileId;
      await user.save();
    }

    const [defaultResumeFile, activeResumeFile] = await Promise.all([
      user.defaultResumeFileId ? ResumeFile.findOne({ _id: user.defaultResumeFileId, userId: user._id }).lean() : null,
      user.activeResumeFileId ? ResumeFile.findOne({ _id: user.activeResumeFileId, userId: user._id }).lean() : null
    ]);
    const resolvedActiveResumeFile = activeResumeFile || defaultResumeFile;

    // Pull stats from latest analyses
    const [analysis, latestResumeAnalysis] = await Promise.all([
      Analysis.findOne({ userId: req.user._id }).sort({ updatedAt: -1 }),
      ResumeAnalysis.findOne({ userId: req.user._id }).sort({ analyzedAt: -1 }).lean()
    ]);

    const githubScore = Number(analysis?.githubScore || 0);
    const resumeScore = latestResumeAnalysis
      ? Math.round((
        Number(latestResumeAnalysis.atsScore || 0)
        + Number(latestResumeAnalysis.keywordDensity || 0)
        + Number(latestResumeAnalysis.formatScore || 0)
        + Number(latestResumeAnalysis.contentQuality || 0)
      ) / 4)
      : 0;

    const scoreInputs = [githubScore, resumeScore].filter((s) => Number.isFinite(s) && s > 0);
    const developerScore = scoreInputs.length
      ? Math.round(scoreInputs.reduce((sum, v) => sum + v, 0) / scoreInputs.length)
      : 0;

    const resumeSkills = latestResumeAnalysis?.skills
      ? (latestResumeAnalysis.skills instanceof Map
        ? Array.from(latestResumeAnalysis.skills.values()).flat()
        : Object.values(latestResumeAnalysis.skills).flat())
      : [];

    const githubSkills = analysis?.languageDistribution
      ? Object.keys(analysis.languageDistribution instanceof Map
        ? Object.fromEntries(analysis.languageDistribution)
        : analysis.languageDistribution)
      : [];

    const skillsDetected = new Set(
      [...resumeSkills, ...githubSkills]
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
    ).size;

    const stats = {
      developerScore,
      reposAnalyzed:   analysis?.githubStats?.repos ?? 0,
      skillsDetected,
      memberSince:     formatMemberSince(user.createdAt),
    };

    if (!user.activeCareerStack) user.activeCareerStack = user.careerStack || 'Full Stack';
    if (!user.activeExperienceLevel) user.activeExperienceLevel = user.experienceLevel || 'Student';
    if (user.isModified('activeCareerStack') || user.isModified('activeExperienceLevel')) {
      await user.save();
    }

    res.json({
      _id:               user._id,
      name:              user.name,
      email:             user.email,
      githubUsername:    user.githubUsername,
      activeGithubUsername,
      avatar:            resolveAvatarForResponse(req, user.avatar),
      jobTitle:          user.jobTitle   || '',
      location:          user.location   || '',
      bio:               user.bio        || '',
      website:           user.website    || '',
      twitter:           user.twitter    || '',
      linkedin:          user.linkedin   || '',
      notifications:     user.notifications || {
        weeklyScoreReport: true,
        skillTrendAlerts:  true,
        newRecommendations:false,
        jobMatchAlerts:    true,
      },
      careerStack:        user.careerStack        || 'Full Stack',
      experienceLevel:    user.experienceLevel    || 'Student',
      activeCareerStack:  user.activeCareerStack  || user.careerStack || 'Full Stack',
      activeExperienceLevel: user.activeExperienceLevel || user.experienceLevel || 'Student',
      careerGoal:         user.careerGoal         || '',
      careerProfileSetAt: user.careerProfileSetAt || null,
      isConfigured:       !!user.careerProfileSetAt,
      defaultResume: defaultResumeFile ? {
        fileId: defaultResumeFile._id,
        fileName: defaultResumeFile.fileName,
        uploadDate: defaultResumeFile.uploadDate,
        isAnalyzed: defaultResumeFile.isAnalyzed
      } : null,
      activeResume: resolvedActiveResumeFile ? {
        fileId: resolvedActiveResumeFile._id,
        fileName: resolvedActiveResumeFile.fileName,
        uploadDate: resolvedActiveResumeFile.uploadDate,
        isAnalyzed: resolvedActiveResumeFile.isAnalyzed
      } : null,
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
      name, githubUsername, defaultResumeFileId,
      jobTitle, location, bio,
      website, twitter, linkedin,
      notifications,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    let hasChanges = false;

    if (name !== undefined && name !== user.name) {
      user.name = name;
      hasChanges = true;
    }
    if (githubUsername !== undefined) {
      const normalizedGithub = String(githubUsername || '').trim();
      if (!normalizedGithub) {
        return res.status(400).json({ message: 'GitHub username cannot be empty.' });
      }
      if (normalizedGithub !== user.githubUsername) {
        user.githubUsername = normalizedGithub;
        user.activeGithubUsername = normalizedGithub;
        user.lastSearchedGithub = '';
        hasChanges = true;
      }
    }

    if (defaultResumeFileId !== undefined) {
      if (!defaultResumeFileId) {
        if (user.defaultResumeFileId || user.activeResumeFileId) {
          user.defaultResumeFileId = null;
          user.activeResumeFileId = null;
          hasChanges = true;
        }
      } else {
        const resumeFile = await ResumeFile.findOne({ _id: defaultResumeFileId, userId: user._id });
        if (!resumeFile) {
          return res.status(400).json({ message: 'Selected default resume file is invalid.' });
        }
        if (String(user.defaultResumeFileId || '') !== String(resumeFile._id)) {
          user.defaultResumeFileId = resumeFile._id;
          user.activeResumeFileId = resumeFile._id;
          hasChanges = true;
        }
      }
    }

    if (jobTitle !== undefined && jobTitle !== user.jobTitle) {
      user.jobTitle = jobTitle;
      hasChanges = true;
    }
    if (location !== undefined && location !== user.location) {
      user.location = location;
      hasChanges = true;
    }
    if (bio !== undefined && bio !== user.bio) {
      user.bio = bio;
      hasChanges = true;
    }
    if (website !== undefined && website !== user.website) {
      user.website = website;
      hasChanges = true;
    }
    if (twitter !== undefined && twitter !== user.twitter) {
      user.twitter = twitter;
      hasChanges = true;
    }
    if (linkedin !== undefined && linkedin !== user.linkedin) {
      user.linkedin = linkedin;
      hasChanges = true;
    }
    if (notifications !== undefined) {
      // Merge only valid notification keys, fallback to defaults if missing
      const nextNotifications = {
        weeklyScoreReport: notifications.weeklyScoreReport ?? user.notifications.weeklyScoreReport ?? true,
        skillTrendAlerts:  notifications.skillTrendAlerts  ?? user.notifications.skillTrendAlerts  ?? true,
        newRecommendations:notifications.newRecommendations?? user.notifications.newRecommendations?? false,
        jobMatchAlerts:    notifications.jobMatchAlerts    ?? user.notifications.jobMatchAlerts    ?? true
      };

      if (JSON.stringify(nextNotifications) !== JSON.stringify(user.notifications || {})) {
        user.notifications = nextNotifications;
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return res.json({ message: 'No changes detected.' });
    }

    const updated = await user.save();

    await createNotification({
      userId: updated._id,
      type: 'profile_update',
      title: 'Profile Updated',
      message: 'Your profile settings were updated successfully.'
    });

    const [defaultResume, activeResume] = await Promise.all([
      updated.defaultResumeFileId
        ? ResumeFile.findOne({ _id: updated.defaultResumeFileId, userId: updated._id }).lean()
        : null,
      updated.activeResumeFileId
        ? ResumeFile.findOne({ _id: updated.activeResumeFileId, userId: updated._id }).lean()
        : null
    ]);

    res.json({
      _id:           updated._id,
      name:          updated.name,
      email:         updated.email,
      githubUsername:updated.githubUsername,
      activeGithubUsername: updated.activeGithubUsername || updated.githubUsername,
      defaultResume: defaultResume ? {
        fileId: defaultResume._id,
        fileName: defaultResume.fileName,
        uploadDate: defaultResume.uploadDate,
        isAnalyzed: defaultResume.isAnalyzed
      } : null,
      activeResume: activeResume ? {
        fileId: activeResume._id,
        fileName: activeResume.fileName,
        uploadDate: activeResume.uploadDate,
        isAnalyzed: activeResume.isAnalyzed
      } : null,
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

    await createNotification({
      userId: user._id,
      type: 'career_update',
      title: 'Career Defaults Updated',
      message: `Default career profile set to ${user.careerStack} (${user.experienceLevel}).`,
      dedupeKey: `career_default:${user._id}:${user.careerStack}:${user.experienceLevel}`,
      dedupeWindowHours: 2
    });

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

// @desc  Save career stack, experience level, and career goal
// @route PUT /api/profile/career
// @access Private
const updateCareerProfile = async (req, res) => {
  try {
    const { careerStack, experienceLevel, careerGoal } = req.body;

    const validStacks = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
    const validLevels = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
    const validGoals  = ['Get first job', 'Improve portfolio', 'Prepare for interviews', 'Switch tech stack', ''];

    if (!careerStack || !validStacks.includes(careerStack)) {
      return res.status(400).json({ message: 'Invalid or missing careerStack.' });
    }
    if (!experienceLevel || !validLevels.includes(experienceLevel)) {
      return res.status(400).json({ message: 'Invalid or missing experienceLevel.' });
    }
    if (careerGoal !== undefined && !validGoals.includes(careerGoal)) {
      return res.status(400).json({ message: 'Invalid careerGoal.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.careerStack     = careerStack;
    user.experienceLevel = experienceLevel;
    user.activeCareerStack = careerStack;
    user.activeExperienceLevel = experienceLevel;
    if (careerGoal !== undefined) user.careerGoal = careerGoal;

    // Mark profile as configured on first save
    if (!user.careerProfileSetAt) {
      user.careerProfileSetAt = new Date();
    }

    await user.save();

    res.json({
      careerStack:        user.careerStack,
      experienceLevel:    user.experienceLevel,
      activeCareerStack:  user.activeCareerStack,
      activeExperienceLevel: user.activeExperienceLevel,
      careerGoal:         user.careerGoal,
      careerProfileSetAt: user.careerProfileSetAt,
      isConfigured:       !!user.careerProfileSetAt
    });
  } catch (error) {
    console.error('Career profile update error:', error.message);
    res.status(500).json({ message: 'Server error updating career profile.' });
  }
};

// @desc  Update active (session-level) career stack + level only
// @route PUT /api/profile/career/active
// @access Private
const updateActiveCareerProfile = async (req, res) => {
  try {
    const { careerStack, experienceLevel } = req.body;

    const validStacks = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
    const validLevels = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];

    if (!careerStack || !validStacks.includes(careerStack)) {
      return res.status(400).json({ message: 'Invalid or missing careerStack.' });
    }
    if (!experienceLevel || !validLevels.includes(experienceLevel)) {
      return res.status(400).json({ message: 'Invalid or missing experienceLevel.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.activeCareerStack = careerStack;
    user.activeExperienceLevel = experienceLevel;
    await user.save();

    await createNotification({
      userId: user._id,
      type: 'career_update',
      title: 'Session Career Filter Changed',
      message: `Active career filter switched to ${user.activeCareerStack} (${user.activeExperienceLevel}).`,
      dedupeKey: `career_active:${user._id}:${user.activeCareerStack}:${user.activeExperienceLevel}`,
      dedupeWindowHours: 2
    });

    return res.json({
      careerStack: user.activeCareerStack,
      experienceLevel: user.activeExperienceLevel,
      isConfigured: !!user.careerProfileSetAt
    });
  } catch (error) {
    console.error('Active career profile update error:', error.message);
    return res.status(500).json({ message: 'Server error updating active career profile.' });
  }
};

// @desc  Upload or replace avatar image
// @route POST /api/profile/avatar
// @access Private
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Avatar file is required.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const nextAvatarPath = `/uploads/avatars/${req.file.filename}`;

    // Best-effort cleanup of previous local avatar file.
    if (user.avatar?.includes('/uploads/avatars/')) {
      const previous = user.avatar.split('/uploads/avatars/')[1]?.split('?')[0];
      if (previous) {
        const absoluteOldPath = path.join(__dirname, '..', '..', 'uploads', 'avatars', previous);
        if (fs.existsSync(absoluteOldPath)) {
          fs.unlinkSync(absoluteOldPath);
        }
      }
    }

    user.avatar = resolveAvatarForResponse(req, nextAvatarPath);
    await user.save();

    await createNotification({
      userId: user._id,
      type: 'profile_update',
      title: 'Profile Photo Updated',
      message: 'Your profile photo has been updated.',
      dedupeKey: `profile_avatar:${user._id}`,
      dedupeWindowHours: 1
    });

    return res.json({
      message: 'Avatar updated successfully.',
      avatar: resolveAvatarForResponse(req, user.avatar)
    });
  } catch (error) {
    console.error('Avatar upload error:', error.message);
    return res.status(500).json({ message: 'Server error uploading avatar.' });
  }
};

module.exports = { getProfile, updateProfile, updatePassword, deleteAccount, updateCareerProfile, updateActiveCareerProfile, uploadAvatar };
