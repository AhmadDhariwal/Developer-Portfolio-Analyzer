const express = require('express');
const router = express.Router();
const { getRecommendations } = require('../controllers/recommendationscontroller');

// POST /api/recommendations  — public, no auth required
router.post('/', getRecommendations);

module.exports = router;
