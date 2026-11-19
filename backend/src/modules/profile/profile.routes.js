const { mediaSession } = require('../../core/middleware/storedImageMiddleware');
const express = require('express');
const router = express.Router();
const { protect } = require('../../core/middleware/authmiddleware');
const avatarUpload = require('../../core/middleware/avatarUploadMiddleware');
const {
  getProfile,
  updateProfile,
  updatePassword,
  deleteAccount,
  updateCareerProfile,
  updateActiveCareerProfile,
  uploadAvatar,
  updateProfileVisibility
} = require('./profilecontroller');

router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

router.get('/me', protect, mediaSession, getProfile);
router.put('/me', protect, mediaSession, updateProfile);
router.put('/career', protect, mediaSession, updateCareerProfile);
router.put('/career/active', protect, mediaSession, updateActiveCareerProfile);
router.put('/password', protect, mediaSession, updatePassword);
router.put('/visibility', protect, mediaSession, updateProfileVisibility);
router.post(
  '/avatar',
  protect,
  mediaSession,
  require('../public-portfolio/middleware/publicPortfolioRateLimit').uploadLimit,
  avatarUpload.single('avatar'),
  uploadAvatar
);
router.delete('/me', protect, mediaSession, deleteAccount);

module.exports = router;
