const express = require('express');
const router = express.Router();
const { protect, attachOptionalUser } = require('../middleware/authmiddleware');
const {
  contactPublicProfile,
  getPublicProfile,
  getMyPublicProfile,
  updateMyPublicProfile,
  getMyPublicProfileAnalytics,
  downloadPublicProfileResume
} = require('../controllers/publicProfileController');

const {
  publicViewLimit,
  resumeLimit,
  analyticsLimit,
  mutationLimit,
  uploadLimit,
  contactLimit,
  contactRecipientLimit
} = require('../middleware/publicPortfolioRateLimit');
const { uploadPortfolioImage } = require('../middleware/portfolioImageUpload');
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.param('slug', (req, res, next, slug) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60)
    return res.status(400).json({ message: 'Invalid slug.' });
  next();
});
router.get('/me', protect, analyticsLimit, getMyPublicProfile);
router.put('/me', protect, mutationLimit, updateMyPublicProfile);
router.post('/me/project-image', protect, uploadLimit, uploadPortfolioImage);
router.get('/me/resume', protect, resumeLimit, downloadPublicProfileResume);
router.get('/me/analytics', protect, analyticsLimit, getMyPublicProfileAnalytics);
router.post('/:slug/contact', protect, contactLimit, contactRecipientLimit, contactPublicProfile);
router.get('/:slug/resume', resumeLimit, downloadPublicProfileResume);
router.get('/:slug', publicViewLimit, attachOptionalUser, getPublicProfile);

module.exports = router;
