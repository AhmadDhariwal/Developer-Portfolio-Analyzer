const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const { generateSkillGraph, getLatestSkillGraph } = require('../controllers/skillgraphcontroller');

router.post('/generate', protect, generateSkillGraph);
router.get('/latest', protect, getLatestSkillGraph);

module.exports = router;
