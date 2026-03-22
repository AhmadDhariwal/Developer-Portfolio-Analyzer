const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authmiddleware');
const avatarUpload = require('../middleware/avatarUploadMiddleware');
const {
  getProfile,
  updateProfile,
  updatePassword,
  deleteAccount,
  updateCareerProfile,
  updateActiveCareerProfile,
  uploadAvatar,
} = require('../controllers/profilecontroller');

router.get   ('/me',       protect, getProfile);
router.put   ('/me',       protect, updateProfile);
router.put   ('/career',   protect, updateCareerProfile);
router.put   ('/career/active', protect, updateActiveCareerProfile);
router.put   ('/password', protect, updatePassword);
router.post  ('/avatar',   protect, avatarUpload.single('avatar'), uploadAvatar);
router.delete('/me',       protect, deleteAccount);

module.exports = router;
