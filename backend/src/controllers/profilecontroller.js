const User     = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const bcrypt   = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createNotification } = require('../services/notificationService');
const { getDeveloperSettingsSync } = require('../services/platformSettingsService');
const { invalidateNewsSignalCache } = require('../services/newsService');
const { invalidateDashboardSummaryCache } = require('./dashboardcontroller');
const { validatePasswordAgainstPolicy } = require('../utils/passwordPolicy');

const VALID_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const VALID_LEVELS = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
const VALID_GOALS = ['Get first job', 'Improve portfolio', 'Prepare for interviews', 'Switch tech stack', ''];
const VALID_TIMELINES = ['Immediately', '1-3 months', '3-6 months', '6+ months', ''];
const VALID_LEARNING_PREFERENCES = ['Project-based', 'Reading', 'Video courses', 'Mentorship', 'Mixed', ''];
const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

const sanitizeText = (value, maxLength = 240) => String(value || '')
  .replace(/[<>]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const buildProfileHash = (user) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    activeGithubUsername: sanitizeText(user?.activeGithubUsername || user?.githubUsername || '', 80).toLowerCase(),
    activeCareerStack: sanitizeText(user?.activeCareerStack || user?.careerStack || 'Full Stack', 40),
    activeExperienceLevel: sanitizeText(user?.activeExperienceLevel || user?.experienceLevel || 'Student', 40),
    careerGoal: sanitizeText(user?.careerGoal || '', 80),
    targetTimeline: sanitizeText(user?.targetTimeline || '', 40),
    learningPreference: sanitizeText(user?.learningPreference || '', 40)
  }))
  .digest('hex');

const invalidateProfileDependentRuntimeCaches = (userId) => {
  invalidateNewsSignalCache(userId);
  invalidateDashboardSummaryCache(userId);
};

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

const isRecruiterProfileComplete = (user) => {
  if (String(user?.role || '').toLowerCase() !== 'recruiter') {
    return true;
  }

  const hasName = Boolean(String(user?.name || '').trim());
  const hasPhone = Boolean(String(user?.phoneNumber || '').trim());
  const hasProfessionalLink = Boolean(String(user?.linkedin || '').trim() || String(user?.githubUsername || '').trim());
  const hasBasicInfo = Boolean(String(user?.jobTitle || '').trim() || String(user?.bio || '').trim());

  return hasName && hasPhone && hasProfessionalLink && hasBasicInfo;
};

const computeDeveloperProfileCompletion = (user) => {
  const fields = [
    user?.name,
    user?.githubUsername,
    user?.jobTitle,
    user?.location,
    user?.bio,
    user?.linkedin || user?.website,
    user?.careerStack,
    user?.experienceLevel
  ];
  const completed = fields.filter((value) => String(value || '').trim().length > 0).length;
  return Math.round((completed / fields.length) * 100);
};
const VALID_CAREER_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const VALID_EXPERIENCE_LEVELS = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
const VALID_CAREER_GOALS = ['Get first job', 'Improve portfolio', 'Prepare for interviews', 'Switch tech stack', ''];
const GITHUB_USERNAME_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const sanitizeText = (value) => String(value ?? '').trim();
const sanitizeGithubUsername = (value) => sanitizeText(value).replace(/^@+/, '');

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
      phoneNumber:       user.phoneNumber || '',
      countryCode:       user.countryCode || '',
      githubUsername:    user.githubUsername,
      activeGithubUsername,
      avatar:            resolveAvatarForResponse(req, user.avatar),
      jobTitle:          user.jobTitle   || '',
      location:          user.location   || '',
      bio:               user.bio        || '',
      website:           user.website    || '',
      twitter:           user.twitter    || '',
      linkedin:          user.linkedin   || '',
      isPublic:          Boolean(user.isPublic),
      role:              user.role       || 'developer',
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
      targetTimeline:     user.targetTimeline     || '',
      learningPreference: user.learningPreference || '',
      profileHash:        buildProfileHash(user),
      careerProfileSetAt: user.careerProfileSetAt || null,
      isConfigured:       !!user.careerProfileSetAt,
      profileCompleted:   isRecruiterProfileComplete(user),
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
      website, twitter, linkedin, phoneNumber,
      notifications,
      targetTimeline,
      learningPreference,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const previousProfileHash = buildProfileHash(user);
    const developerSettings = getDeveloperSettingsSync();

    let hasChanges = false;

<<<<<<< HEAD
    if (name !== undefined && name !== user.name) {
      user.name = sanitizeText(name, 120);
      hasChanges = true;
=======
    if (name !== undefined) {
      const normalizedName = sanitizeText(name);
      if (!normalizedName) {
        return res.status(400).json({ message: 'Full name is required.' });
      }
      if (normalizedName !== user.name) {
        user.name = normalizedName;
        hasChanges = true;
      }
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
    }

    if (githubUsername !== undefined) {
<<<<<<< HEAD
      const normalizedGithub = sanitizeText(githubUsername, 80);
      if (!normalizedGithub && (user.role !== 'recruiter' || developerSettings.githubRequirement !== false)) {
        return res.status(400).json({ message: 'GitHub username cannot be empty.' });
      }
      if (normalizedGithub && !GITHUB_USERNAME_RE.test(normalizedGithub)) {
=======
      const normalizedGithub = sanitizeGithubUsername(githubUsername);
      if (!normalizedGithub && (user.role !== 'recruiter' || developerSettings.githubRequirement !== false)) {
        return res.status(400).json({ message: 'GitHub username cannot be empty.' });
      }
      if (normalizedGithub && !GITHUB_USERNAME_PATTERN.test(normalizedGithub)) {
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
        return res.status(400).json({ message: 'Invalid GitHub username.' });
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

<<<<<<< HEAD
    if (jobTitle !== undefined && jobTitle !== user.jobTitle) {
      user.jobTitle = sanitizeText(jobTitle, 120);
      hasChanges = true;
    }
    if (location !== undefined && location !== user.location) {
      user.location = sanitizeText(location, 120);
      hasChanges = true;
    }
    if (bio !== undefined && bio !== user.bio) {
      user.bio = sanitizeText(bio, 600);
      hasChanges = true;
    }
    if (website !== undefined && website !== user.website) {
      user.website = sanitizeText(website, 180);
      hasChanges = true;
    }
    if (twitter !== undefined && twitter !== user.twitter) {
      user.twitter = sanitizeText(twitter, 80);
      hasChanges = true;
    }
    if (linkedin !== undefined && linkedin !== user.linkedin) {
      user.linkedin = sanitizeText(linkedin, 180);
      hasChanges = true;
    }
    if (phoneNumber !== undefined && phoneNumber !== user.phoneNumber) {
      user.phoneNumber = sanitizeText(phoneNumber, 40);
      hasChanges = true;
    }
    if (targetTimeline !== undefined) {
      const normalizedTimeline = sanitizeText(targetTimeline, 40);
      if (!VALID_TIMELINES.includes(normalizedTimeline)) {
        return res.status(400).json({ message: 'Invalid targetTimeline.' });
      }
      if (normalizedTimeline !== user.targetTimeline) {
        user.targetTimeline = normalizedTimeline;
        hasChanges = true;
      }
    }
    if (learningPreference !== undefined) {
      const normalizedPreference = sanitizeText(learningPreference, 40);
      if (!VALID_LEARNING_PREFERENCES.includes(normalizedPreference)) {
        return res.status(400).json({ message: 'Invalid learningPreference.' });
      }
      if (normalizedPreference !== user.learningPreference) {
        user.learningPreference = normalizedPreference;
        hasChanges = true;
      }
    }
=======
    const textFields = [
      ['jobTitle', jobTitle],
      ['location', location],
      ['bio', bio],
      ['website', website],
      ['twitter', twitter],
      ['linkedin', linkedin],
      ['phoneNumber', phoneNumber]
    ];

    for (const [field, value] of textFields) {
      if (value === undefined) continue;
      const normalizedValue = sanitizeText(value);
      if (normalizedValue !== String(user[field] || '')) {
        user[field] = normalizedValue;
        hasChanges = true;
      }
    }

>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
    if (notifications !== undefined) {
      const nextNotifications = {
        weeklyScoreReport: notifications.weeklyScoreReport ?? user.notifications.weeklyScoreReport ?? true,
        skillTrendAlerts: notifications.skillTrendAlerts ?? user.notifications.skillTrendAlerts ?? true,
        newRecommendations: notifications.newRecommendations ?? user.notifications.newRecommendations ?? false,
        jobMatchAlerts: notifications.jobMatchAlerts ?? user.notifications.jobMatchAlerts ?? true
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
    const nextProfileHash = buildProfileHash(updated);
    if (previousProfileHash !== nextProfileHash) {
      invalidateProfileDependentRuntimeCaches(updated._id);
    }

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
      _id: updated._id,
      name: updated.name,
      email: updated.email,
      phoneNumber: updated.phoneNumber || '',
      countryCode: updated.countryCode || '',
      githubUsername: updated.githubUsername,
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
<<<<<<< HEAD
      jobTitle:      updated.jobTitle,
      location:      updated.location,
      bio:           updated.bio,
      website:       updated.website,
      twitter:       updated.twitter,
      linkedin:      updated.linkedin,
      targetTimeline: updated.targetTimeline || '',
      learningPreference: updated.learningPreference || '',
      profileHash:   buildProfileHash(updated),
=======
      jobTitle: updated.jobTitle,
      location: updated.location,
      bio: updated.bio,
      website: updated.website,
      twitter: updated.twitter,
      linkedin: updated.linkedin,
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
      profileCompleted: isRecruiterProfileComplete(updated),
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
    const passwordPolicy = validatePasswordAgainstPolicy(newPassword);
    if (!passwordPolicy.valid) {
      return res.status(400).json({ message: passwordPolicy.message });
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
      type: 'profile_update',
      title: 'Password Updated',
      message: 'Your password was updated successfully.',
      dedupeKey: `password_update:${user._id}`,
      dedupeWindowHours: 1
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
<<<<<<< HEAD
    const { careerStack, experienceLevel, careerGoal, targetTimeline, learningPreference } = req.body;

    if (!careerStack || !VALID_STACKS.includes(careerStack)) {
      return res.status(400).json({ message: 'Invalid or missing careerStack.' });
    }
    if (!experienceLevel || !VALID_LEVELS.includes(experienceLevel)) {
      return res.status(400).json({ message: 'Invalid or missing experienceLevel.' });
    }
    if (careerGoal !== undefined && !VALID_GOALS.includes(sanitizeText(careerGoal, 80))) {
=======
    const normalizedCareerStack = sanitizeText(req.body?.careerStack);
    const normalizedExperienceLevel = sanitizeText(req.body?.experienceLevel);
    const normalizedCareerGoal = req.body?.careerGoal === undefined ? undefined : sanitizeText(req.body.careerGoal);

    if (!normalizedCareerStack || !VALID_CAREER_STACKS.includes(normalizedCareerStack)) {
      return res.status(400).json({ message: 'Invalid or missing careerStack.' });
    }
    if (!normalizedExperienceLevel || !VALID_EXPERIENCE_LEVELS.includes(normalizedExperienceLevel)) {
      return res.status(400).json({ message: 'Invalid or missing experienceLevel.' });
    }
    if (normalizedCareerGoal !== undefined && !VALID_CAREER_GOALS.includes(normalizedCareerGoal)) {
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
      return res.status(400).json({ message: 'Invalid careerGoal.' });
    }
    if (targetTimeline !== undefined && !VALID_TIMELINES.includes(sanitizeText(targetTimeline, 40))) {
      return res.status(400).json({ message: 'Invalid targetTimeline.' });
    }
    if (learningPreference !== undefined && !VALID_LEARNING_PREFERENCES.includes(sanitizeText(learningPreference, 40))) {
      return res.status(400).json({ message: 'Invalid learningPreference.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const previousProfileHash = buildProfileHash(user);

<<<<<<< HEAD
    user.careerStack     = careerStack;
    user.experienceLevel = experienceLevel;
    user.activeCareerStack = careerStack;
    user.activeExperienceLevel = experienceLevel;
    if (careerGoal !== undefined) user.careerGoal = sanitizeText(careerGoal, 80);
    if (targetTimeline !== undefined) user.targetTimeline = sanitizeText(targetTimeline, 40);
    if (learningPreference !== undefined) user.learningPreference = sanitizeText(learningPreference, 40);
=======
    user.careerStack = normalizedCareerStack;
    user.experienceLevel = normalizedExperienceLevel;
    user.activeCareerStack = normalizedCareerStack;
    user.activeExperienceLevel = normalizedExperienceLevel;
    if (normalizedCareerGoal !== undefined) user.careerGoal = normalizedCareerGoal;
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2

    if (!user.careerProfileSetAt) {
      user.careerProfileSetAt = new Date();
    }

    await user.save();
    if (previousProfileHash !== buildProfileHash(user)) {
      invalidateProfileDependentRuntimeCaches(user._id);
    }

    res.json({
      careerStack: user.careerStack,
      experienceLevel: user.experienceLevel,
      activeCareerStack: user.activeCareerStack,
      activeExperienceLevel: user.activeExperienceLevel,
<<<<<<< HEAD
      careerGoal:         user.careerGoal,
      targetTimeline:     user.targetTimeline || '',
      learningPreference: user.learningPreference || '',
      profileHash:        buildProfileHash(user),
=======
      careerGoal: user.careerGoal,
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
      careerProfileSetAt: user.careerProfileSetAt,
      isConfigured: !!user.careerProfileSetAt
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
    const normalizedCareerStack = sanitizeText(req.body?.careerStack);
    const normalizedExperienceLevel = sanitizeText(req.body?.experienceLevel);

<<<<<<< HEAD
    if (!careerStack || !VALID_STACKS.includes(careerStack)) {
      return res.status(400).json({ message: 'Invalid or missing careerStack.' });
    }
    if (!experienceLevel || !VALID_LEVELS.includes(experienceLevel)) {
=======
    if (!normalizedCareerStack || !VALID_CAREER_STACKS.includes(normalizedCareerStack)) {
      return res.status(400).json({ message: 'Invalid or missing careerStack.' });
    }
    if (!normalizedExperienceLevel || !VALID_EXPERIENCE_LEVELS.includes(normalizedExperienceLevel)) {
>>>>>>> d84a3821e3ac7e5f8248ebe85bae0317ef5c6cc2
      return res.status(400).json({ message: 'Invalid or missing experienceLevel.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const previousProfileHash = buildProfileHash(user);

    user.activeCareerStack = normalizedCareerStack;
    user.activeExperienceLevel = normalizedExperienceLevel;
    await user.save();
    if (previousProfileHash !== buildProfileHash(user)) {
      invalidateProfileDependentRuntimeCaches(user._id);
    }

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
      activeCareerStack: user.activeCareerStack,
      activeExperienceLevel: user.activeExperienceLevel,
      careerGoal: user.careerGoal || '',
      targetTimeline: user.targetTimeline || '',
      learningPreference: user.learningPreference || '',
      profileHash: buildProfileHash(user),
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

    // Store only the relative path in DB — full URL is resolved per-request
    user.avatar = nextAvatarPath;
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
      avatar: resolveAvatarForResponse(req, nextAvatarPath)
    });
  } catch (error) {
    console.error('Avatar upload error:', error.message);
    return res.status(500).json({ message: 'Server error uploading avatar.' });
  }
};

// @desc  Toggle profile visibility in the talent pool (developers & recruiters only)
// @route PUT /api/profile/visibility
// @access Private
const updateProfileVisibility = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const developerSettings = getDeveloperSettingsSync();

    // Admins are not part of the talent pool — block them from enabling visibility.
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Admins cannot appear in the talent pool.' });
    }

    const { isPublic } = req.body;
    if (typeof isPublic !== 'boolean') {
      return res.status(400).json({ message: 'isPublic must be a boolean.' });
    }

    if (isPublic && developerSettings.publicPortfolioVisibility === false) {
      return res.status(403).json({ message: 'Public portfolio visibility is disabled by Super Admin settings.' });
    }

    if (isPublic && developerSettings.githubRequirement !== false && !String(user.githubUsername || '').trim()) {
      return res.status(400).json({ message: 'A GitHub username is required before enabling public visibility.' });
    }

    if (isPublic) {
      const completion = computeDeveloperProfileCompletion(user);
      const requiredCompletion = Number(developerSettings.profileCompletionRequirement || 0);
      if (completion < requiredCompletion) {
        return res.status(400).json({ message: `Profile must be at least ${requiredCompletion}% complete before enabling public visibility.` });
      }
    }

    user.isPublic = isPublic;
    await user.save();

    await createNotification({
      userId: user._id,
      type: 'profile_update',
      title: 'Profile Visibility Updated',
      message: isPublic
        ? 'Your profile is now visible to recruiters in the talent pool.'
        : 'Your profile is now hidden from the talent pool.',
      dedupeKey: `profile_visibility:${user._id}`,
      dedupeWindowHours: 1
    });

    return res.json({ isPublic: user.isPublic });
  } catch (error) {
    console.error('Profile visibility update error:', error.message);
    return res.status(500).json({ message: 'Server error updating profile visibility.' });
  }
};

module.exports = { getProfile, updateProfile, updatePassword, deleteAccount, updateCareerProfile, updateActiveCareerProfile, uploadAvatar, updateProfileVisibility };




