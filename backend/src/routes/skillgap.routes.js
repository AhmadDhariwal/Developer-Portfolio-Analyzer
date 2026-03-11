const express = require('express');
const router  = express.Router();
const { analyzeSkillGap } = require('../controllers/skillgapcontroller');

// Public — analyze skill gap for any GitHub username
router.post('/skill-gap', analyzeSkillGap);

module.exports = router;
