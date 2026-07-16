const express = require('express');
const router = express.Router();
const { protect, attachOptionalUser } = require('../middleware/authmiddleware');
const {
  getPublicProfile,
  getMyPublicProfile,
  updateMyPublicProfile,
  getMyPublicProfileAnalytics,
  downloadPublicProfileResume
} = require('../controllers/publicProfileController');

router.get('/me', protect, getMyPublicProfile);
router.put('/me', protect, updateMyPublicProfile);
router.get('/me/analytics', protect, getMyPublicProfileAnalytics);
router.get('/:slug/resume', downloadPublicProfileResume);
router.get('/:slug', attachOptionalUser, getPublicProfile);

module.exports = router;
