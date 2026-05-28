const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getInterviewPrepQuestions,
  searchInterviewPrepQuestions,
  generateInterviewPrepQuestions,
  askInterviewPrepQuestion,
  generateInterviewPrepSession,
  getInterviewPrepHistory
} = require('../controllers/interviewPrepController');

const customQuestionRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_INTERVIEW_CUSTOM_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${String(req.user._id)}`,
  message: { message: 'Too many custom interview questions. Please try again later.' }
});

router.get('/questions', protect, getInterviewPrepQuestions);
router.get('/search', protect, searchInterviewPrepQuestions);
router.post('/generate', protect, generateInterviewPrepQuestions);
router.post('/ask-question', protect, customQuestionRateLimiter, askInterviewPrepQuestion);
router.post('/', protect, generateInterviewPrepSession);
router.get('/history', protect, getInterviewPrepHistory);

module.exports = router;
