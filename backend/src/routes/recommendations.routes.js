const express = require('express');
const router  = express.Router();
const { getRecommendations, generateRecommendations } = require('../controllers/recommendationscontroller');
const { protect } = require('../middleware/authmiddleware');

// POST /api/recommendations  — protected: requires a valid JWT (legacy)
router.post('/', protect, getRecommendations);

// POST /api/recommendations/generate  — supports both temporary and permanent analysis
// If isTemporary=true, protect middleware is optional
// If isTemporary=false or omitted, requires authentication
const optionalProtect = (req, res, next) => {
  const isTemporary = req.body?.isTemporary === true;
  
  if (isTemporary) {
    // Temporary analysis: not protected
    next();
  } else {
    // Permanent analysis: require authentication
    protect(req, res, next);
  }
};

router.post('/generate', optionalProtect, generateRecommendations);

module.exports = router;

