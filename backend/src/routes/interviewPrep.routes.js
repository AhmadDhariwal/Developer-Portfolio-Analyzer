const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getInterviewPrepQuestions,
  searchInterviewPrepQuestions,
  generateInterviewPrepQuestions,
  generateInterviewPrepSession,
  getInterviewPrepHistory
} = require('../controllers/interviewPrepController');

router.get('/questions', protect, getInterviewPrepQuestions);
router.get('/search', protect, searchInterviewPrepQuestions);
router.post('/generate', protect, generateInterviewPrepQuestions);
router.post('/', protect, generateInterviewPrepSession);
router.get('/history', protect, getInterviewPrepHistory);

module.exports = router;
