const express = require('express');
const router  = express.Router();
const { getRecommendations } = require('../controllers/recommendationscontroller');
const { protect } = require('../middleware/authmiddleware');

// POST /api/recommendations  — protected: requires a valid JWT
router.post('/', protect, getRecommendations);

module.exports = router;
