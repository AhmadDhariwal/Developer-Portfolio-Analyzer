const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authcontroller');
const { authRateLimiter, bruteForceGuard } = require('../middleware/securityMiddleware');

router.post('/register', authRateLimiter, registerUser);
router.post('/login', authRateLimiter, bruteForceGuard, loginUser);

module.exports = router;
