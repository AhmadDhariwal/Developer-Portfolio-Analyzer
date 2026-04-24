const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  sendOtp,
  verifyOtp,
  forgotPassword,
  resetPassword,
  getInviteDetails,
  acceptInvite
} = require('../controllers/authcontroller');
const { authRateLimiter, bruteForceGuard } = require('../middleware/securityMiddleware');

router.post('/register', authRateLimiter, registerUser);
router.post('/login', authRateLimiter, bruteForceGuard, loginUser);
router.post('/send-otp', authRateLimiter, sendOtp);
router.post('/verify-otp', authRateLimiter, verifyOtp);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password', authRateLimiter, resetPassword);
router.get('/invite-details/:token', authRateLimiter, getInviteDetails);
router.post('/accept-invite', authRateLimiter, acceptInvite);

module.exports = router;
