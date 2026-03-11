const express = require('express');
const router = express.Router();
const { analyzeGitHub, analyzeAndSaveGitHubProfile, getActiveUsername } = require('../controllers/githubcontroller');
const { protect } = require('../middleware/authmiddleware');

// Public — analyze any GitHub username without login
router.post('/analyze', analyzeGitHub);

// Private — analyze and persist results to the logged-in user's profile
router.post('/analyze-save', protect, analyzeAndSaveGitHubProfile);

// Private — get the active username for the analyzer
router.get('/active-username', protect, getActiveUsername);

module.exports = router;
