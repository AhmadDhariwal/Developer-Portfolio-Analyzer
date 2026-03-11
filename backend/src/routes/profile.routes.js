const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getProfile,
  updateProfile,
  updatePassword,
  deleteAccount,
} = require('../controllers/profilecontroller');

router.get   ('/me',       protect, getProfile);
router.put   ('/me',       protect, updateProfile);
router.put   ('/password', protect, updatePassword);
router.delete('/me',       protect, deleteAccount);

module.exports = router;
