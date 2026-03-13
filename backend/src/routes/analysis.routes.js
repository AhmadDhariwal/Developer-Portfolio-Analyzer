const express = require('express');
const router = express.Router();
const { getPortfolioReadiness } = require('../controllers/analysiscontroller');
const { protect } = require('../middleware/authmiddleware');

/**
 * @desc  Get overall portfolio strength score (Readiness Score)
 * @route POST /api/analysis/portfolio-score
 */
router.post('/portfolio-score', protect, getPortfolioReadiness);

module.exports = router;
