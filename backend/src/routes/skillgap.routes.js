const express = require('express');
const router  = express.Router();
const { analyzeSkillGap } = require('../controllers/skillgapcontroller');
const { protect } = require('../middleware/authmiddleware');

const markSkillGapRouteStart = (req, _res, next) => {
  req.skillGapRouteStartedAt = Date.now();
  next();
};

const markSkillGapAuthComplete = (req, _res, next) => {
  req.skillGapAuthCompletedAt = Date.now();
  next();
};

router.post('/skill-gap', markSkillGapRouteStart, protect, markSkillGapAuthComplete, analyzeSkillGap);

module.exports = router;
