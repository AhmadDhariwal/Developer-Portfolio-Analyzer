const express = require('express');
const router  = express.Router();
const { getRecommendations, generateRecommendations, savePreview, listSavedPreviews, deleteSavedPreview } = require('../controllers/recommendationscontroller');
const { protect, optionalProtect } = require('../middleware/authmiddleware');

// POST /api/recommendations  â€” protected: requires a valid JWT (legacy)
router.post('/', protect, getRecommendations);

// POST /api/recommendations/generate  â€” supports both temporary and permanent analysis
router.post('/generate', optionalProtect, generateRecommendations);

router.post('/saved-previews', protect, savePreview);
router.get('/saved-previews', protect, listSavedPreviews);
router.delete('/saved-previews/:id', protect, deleteSavedPreview);

module.exports = router;

