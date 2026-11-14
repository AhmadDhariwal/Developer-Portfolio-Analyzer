const express = require('express');
const { rateLimit } = require('../services/interviewCoordinationService');
const { INTERVIEW_CATEGORY_SET } = require('../services/interviewQuestionQualityService');
const router = express.Router();
const { protect } = require('../middleware/authmiddleware');
const {
  getInterviewPrepQuestions,
  searchInterviewPrepQuestions,
  generateInterviewPrepQuestions,
  askInterviewPrepQuestion,
  generateInterviewPrepSession,
  getInterviewSession,
  updateInterviewSession,
  getInterviewPrepHistory
} = require('../controllers/interviewPrepController');

const customQuestionRateLimiter = rateLimit('custom', 20);
const searchRateLimiter = rateLimit('search', 60);
const generateRateLimiter = rateLimit('generate', 30);

// Reject structured query/body values before normalization or provider calls.
router.use(protect, (req, res, next) => {
  const idempotencyKey = req.get('Idempotency-Key') || req.body?.idempotencyKey;
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(idempotencyKey))
  ) {
    return res.status(400).json({ message: 'Invalid idempotency key.' });
  }
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
  if (input.category && !INTERVIEW_CATEGORY_SET.has(input.category))
    return res.status(400).json({ message: 'Invalid category.' });
  if (
    input.source &&
    !['seed', 'database', 'ai', 'scraped', 'ai_generated', 'verified_seed', 'prebuilt'].includes(input.source)
  )
    return res.status(400).json({ message: 'Invalid source.' });
  next();
});

router.get('/questions', getInterviewPrepQuestions);
router.get('/search', searchRateLimiter, searchInterviewPrepQuestions);
router.post('/generate', generateRateLimiter, generateInterviewPrepQuestions);
router.post('/ask-question', customQuestionRateLimiter, askInterviewPrepQuestion);
router.post('/', generateRateLimiter, generateInterviewPrepSession);
router.get('/history', getInterviewPrepHistory);
router.get('/sessions/:id', getInterviewSession);
router.patch('/sessions/:id/progress', updateInterviewSession);
router.post('/sessions/:id/complete', updateInterviewSession);

module.exports = router;
