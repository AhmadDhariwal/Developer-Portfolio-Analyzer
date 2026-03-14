const express = require('express');
const router  = express.Router();
const { analyzeSkillGap } = require('../controllers/skillgapcontroller');
const { protect } = require('../middleware/authmiddleware');

router.post('/skill-gap', protect, analyzeSkillGap);

module.exports = router;
