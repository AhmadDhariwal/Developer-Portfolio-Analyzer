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

const searchRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_INTERVIEW_SEARCH_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${String(req.user._id)}`,
  message: { message: 'Too many search requests. Please try again later.' }
});

const generateRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_INTERVIEW_GENERATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${String(req.user._id)}`,
  message: { message: 'Too many generation requests. Please try again later.' }
});

// Reject structured query/body values before normalization or provider calls.
router.use(protect, (req, res, next) => {
  const input = req.method === 'GET' ? req.query : req.body || {};
  const fields = [
    'skill',
    'topic',
    'stack',
    'technology',
    'language',
    'framework',
    'difficulty',
    'category',
    'source',
    'block',
    'top',
    'lookupOnly',
    'q',
    'query',
    'question',
    'tags',
    'careerStack',
    'experienceLevel'
  ];
  for (const field of fields) {
    if (
      input[field] !== undefined &&
      (typeof input[field] !== 'string' ||
        input[field].length > (['q', 'query', 'question', 'tags'].includes(field) ? 500 : 100))
    ) {
      return res.status(400).json({ message: `Invalid ${field}.` });
    }
  }
  for (const field of ['page', 'limit', 'target']) {
    if (
      input[field] !== undefined &&
      (!['string', 'number'].includes(typeof input[field]) ||
        !Number.isFinite(Number(input[field])) ||
        Number(input[field]) < 1)
    ) {
      return res.status(400).json({ message: `Invalid ${field}.` });
    }
  }
  if (input.difficulty && !['easy', 'medium', 'hard', 'senior'].includes(input.difficulty))
    return res.status(400).json({ message: 'Invalid difficulty.' });
  next();
});

router.get('/questions', getInterviewPrepQuestions);
router.get('/search', searchRateLimiter, searchInterviewPrepQuestions);
router.post('/generate', generateRateLimiter, generateInterviewPrepQuestions);
router.post('/ask-question', customQuestionRateLimiter, askInterviewPrepQuestion);
router.post('/', generateRateLimiter, generateInterviewPrepSession);
router.get('/history', getInterviewPrepHistory);

module.exports = router;
