const express = require('express');
const router = express.Router();
const { getAnalysis } = require('../controllers/analysiscontroller');
const { protect } = require('../middleware/authmiddleware');

router.get('/', protect, getAnalysis);

module.exports = router;
