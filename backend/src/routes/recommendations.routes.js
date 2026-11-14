const express = require('express');
const router = express.Router();
const {
  getRecommendations,
  generateRecommendations,
  savePreview,
  listSavedPreviews,
  deleteSavedPreview,
  handoffToCareerSprint,
  listRecommendationHistory,
} = require('../controllers/recommendationscontroller');
const { protect, optionalProtect } = require('../middleware/authmiddleware');

const { admit } = require('../middleware/recommendationAdmission');

// POST /api/recommendations  â€” protected: requires a valid JWT (legacy)
router.post('/', protect, admit(true), getRecommendations);

// POST /api/recommendations/generate  â€” supports both temporary and permanent analysis
router.post('/generate', optionalProtect, admit(true), generateRecommendations);

router.post('/saved-previews', protect, admit(), savePreview);
router.get('/saved-previews', protect, admit(), listSavedPreviews);
router.delete('/saved-previews/:id', protect, admit(), deleteSavedPreview);
router.post('/:id/career-sprint', protect, admit(true), handoffToCareerSprint);
router.get('/history', protect, admit(), listRecommendationHistory);

module.exports = router;
