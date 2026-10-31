const {
  getPublicProfileBySlug,
  getPublicProfileForOwner,
  updatePublicProfile,
  getPublicProfileAnalytics,
  getPublicProfileResumeDownload,
  getOwnerResumeDownload
} = require('../services/publicProfileService');

const invalidatePublicProfileDependentCaches = (userId) => {
  try {
    require('./dashboardcontroller').invalidateDashboardSummaryCache(userId);
    require('../services/scenarioSimulatorService').invalidateContextCache(userId);
  } catch (error) {
    console.warn('Public profile dependent cache invalidation failed:', error.message);
  }
};

// GET /api/public-profiles/:slug (public)
const getPublicProfile = async (req, res) => {
  try {
    const profile = await getPublicProfileBySlug(req.params.slug, req);
    if (!profile) return res.status(404).json({ message: 'Public profile not found.' });
    res.set('Cache-Control', 'private, no-store');
    res.json(profile);
  } catch (error) {
    console.error('Public profile fetch error:', error.message);
    res.status(error.statusCode || 503).json({ message: 'Failed to load public profile.' });
  }
};

// GET /api/public-profiles/me
const getMyPublicProfile = async (req, res) => {
  try {
    const profile = await getPublicProfileForOwner(req.user._id, req);
    res.set('Cache-Control', 'no-store');
    res.json(profile);
  } catch (error) {
    console.error('Public profile owner fetch error:', error.message);
    res.status(500).json({ message: 'Failed to load profile settings.' });
  }
};

// PUT /api/public-profiles/me
const updateMyPublicProfile = async (req, res) => {
  try {
    const profile = await updatePublicProfile(req.user._id, req.body || {}, req);

    invalidatePublicProfileDependentCaches(req.user._id);

    res.set('Cache-Control', 'no-store');
    res.json(profile);
  } catch (error) {
    console.error('Public profile update error:', error.message);
    res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : 'Failed to update public profile.' });
  }
};

// GET /api/public-profiles/:slug/resume
const downloadPublicProfileResume = async (req, res) => {
  try {
    const resume = req.params.slug
      ? await getPublicProfileResumeDownload(req.params.slug)
      : await getOwnerResumeDownload(req.user._id);
    if (!resume) {
      return res.status(404).json({ message: 'Resume not available.' });
    }

    res.set('Cache-Control', 'private, no-store');
    res.type(resume.mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    if (require('../services/storedAssetService').parse(resume.filePath)) {
      const bytes = await require('../services/resumeStorageService').read(
        resume.filePath,
        resume.ownerId
      );
      return res.attachment(resume.fileName).send(bytes);
    }
    return res.download(resume.filePath, resume.fileName, (error) => {
      if (error && !res.headersSent)
        res.status(error.statusCode === 404 ? 404 : 500).json({ message: 'Resume not available.' });
    });
  } catch (error) {
    console.error('Public profile resume download unavailable.');
    return res
      .status([404, 503].includes(error.status) ? error.status : 500)
      .json({ message: 'Failed to download resume.' });
  }
};

// GET /api/public-profiles/me/analytics
const getMyPublicProfileAnalytics = async (req, res) => {
  try {
    const analytics = await getPublicProfileAnalytics(req.user._id);
    res.set('Cache-Control', 'private, no-store');
    res.json(analytics);
  } catch (error) {
    console.error('Public profile analytics error:', error.message);
    res.status(500).json({ message: 'Failed to load profile analytics.' });
  }
};

const contactPublicProfile = async (req, res) => {
  try {
    const result = await require('../services/publicPortfolioContactService').deliverContact(
      req.params.slug,
      req.user,
      req.body
    );
    res.json(result);
  } catch (error) {
    res
      .status(error.statusCode || 503)
      .json({ message: error.statusCode ? error.message : 'Contact delivery unavailable.' });
  }
};

module.exports = {
  contactPublicProfile,
  getPublicProfile,
  getMyPublicProfile,
  updateMyPublicProfile,
  getMyPublicProfileAnalytics,
  downloadPublicProfileResume
};
