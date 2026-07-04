const {
  getPublicProfileBySlug,
  getPublicProfileForOwner,
  updatePublicProfile,
  getPublicProfileAnalytics,
  getPublicProfileResumeDownload
} = require('../services/publicProfileService');

// GET /api/public-profiles/:slug (public)
const getPublicProfile = async (req, res) => {
  try {
    const profile = await getPublicProfileBySlug(req.params.slug, req);
    if (!profile) return res.status(404).json({ message: 'Public profile not found.' });
    res.set('Cache-Control', 'public, max-age=0, must-revalidate, stale-if-error=86400');
    res.json(profile);
  } catch (error) {
    console.error('Public profile fetch error:', error.message);
    res.status(500).json({ message: 'Failed to load public profile.' });
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
    console.info('public-profile update request', {
      userId: String(req.user?._id || ''),
      fields: Object.keys(req.body || {}),
      headline: String(req.body?.headline || '')
    });

    const profile = await updatePublicProfile(req.user._id, req.body || {}, req);

    console.info('public-profile updated', {
      userId: String(req.user?._id || ''),
      slug: profile?.slug,
      headline: profile?.headline
    });

    res.json(profile);
  } catch (error) {
    console.error('Public profile update error:', error.message);
    res.status(500).json({ message: 'Failed to update public profile.' });
  }
};

// GET /api/public-profiles/:slug/resume
const downloadPublicProfileResume = async (req, res) => {
  try {
    const resume = await getPublicProfileResumeDownload(req.params.slug);
    if (!resume) {
      return res.status(404).json({ message: 'Resume not available.' });
    }

    res.set('Cache-Control', 'public, max-age=0, must-revalidate, stale-if-error=86400');
    res.type(resume.mimeType);
    return res.download(resume.filePath, resume.fileName);
  } catch (error) {
    console.error('Public profile resume download error:', error.message);
    return res.status(500).json({ message: 'Failed to download resume.' });
  }
};

// GET /api/public-profiles/me/analytics
const getMyPublicProfileAnalytics = async (req, res) => {
  try {
    const analytics = await getPublicProfileAnalytics(req.user._id);
    res.json(analytics);
  } catch (error) {
    console.error('Public profile analytics error:', error.message);
    res.status(500).json({ message: 'Failed to load profile analytics.' });
  }
};

module.exports = {
  getPublicProfile,
  getMyPublicProfile,
  updateMyPublicProfile,
  getMyPublicProfileAnalytics,
  downloadPublicProfileResume
};
