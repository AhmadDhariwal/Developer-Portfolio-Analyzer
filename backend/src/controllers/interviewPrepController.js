const {
  DEFAULT_PAGE_LIMIT,
  generateInterviewPrepSessionFromBank,
  generateFreshInterviewQuestions,
  answerCustomInterviewQuestion,
  getQuestionBank,
  searchQuestionBank,
  listInterviewPrepHistory,
  sanitizeSkill
} = require('../services/interviewPrepService');

const MAX_QUERY_LENGTH = 500;
const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'senior', '']);
const VALID_SOURCES = new Set(['seed', 'database', 'ai', 'scraped', 'ai_generated', 'verified_seed', 'prebuilt', '']);

const clampInt = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const mapCareerStackToSkill = (careerStack = '') => {
  const normalized = String(careerStack || '').trim().toLowerCase();
  if (normalized.includes('frontend') || normalized.includes('react')) return 'react';
  if (normalized.includes('backend') || normalized.includes('node')) return 'javascript';
  return 'mern';
};

const readTopicInput = (payload = {}) => ({
  topic: payload.topic || '',
  stack: payload.stack || '',
  technology: payload.technology || '',
  language: payload.language || '',
  framework: payload.framework || ''
});

// POST /api/interview-prep
const generateInterviewPrepSession = async (req, res) => {
  try {
    const { skill = '', query = '', skillGaps = [], careerStack, experienceLevel } = req.body || {};
    const inferredSkill = sanitizeSkill(skill)
      || sanitizeSkill(skillGaps[0])
      || mapCareerStackToSkill(careerStack || req.user.careerStack || '');
    const topicInput = readTopicInput(req.body || {});

    const generated = await generateInterviewPrepSessionFromBank({
      userId: req.user._id,
      skill: inferredSkill,
      query,
      ...topicInput,
      careerStack: careerStack || req.user.careerStack || 'Full Stack',
      experienceLevel: experienceLevel || req.user.experienceLevel || 'Student'
    });

    res.json(generated);
  } catch (error) {
    console.error('Interview prep generate error:', error.message);
    res.status(500).json({ message: 'Failed to generate interview prep.' });
  }
};

// GET /api/interview-prep/questions
const getInterviewPrepQuestions = async (req, res) => {
  try {
    const {
      skill = '',
      page = 1,
      limit = DEFAULT_PAGE_LIMIT,
      difficulty = '',
      tags = '',
      block = 'top',
      top = '',
      category = '',
      source = ''
    } = req.query;
    const topicInput = readTopicInput(req.query || {});
    const normalizedSkill = sanitizeSkill(skill || topicInput.topic || topicInput.language || topicInput.framework || topicInput.technology || topicInput.stack);
    if (!normalizedSkill && !topicInput.topic) {
      return res.status(400).json({ message: 'Query parameter skill or topic is required.' });
    }
    const safeDifficulty = String(difficulty || '').trim().toLowerCase();
    if (!VALID_DIFFICULTIES.has(safeDifficulty)) {
      return res.status(400).json({ message: `Invalid difficulty. Must be one of: easy, medium, hard, senior, or empty.` });
    }
    const safeSource = String(source || '').trim().toLowerCase();
    if (!VALID_SOURCES.has(safeSource)) {
      return res.status(400).json({ message: `Invalid source filter.` });
    }

    const payload = await getQuestionBank({
      skill: normalizedSkill,
      ...topicInput,
      page: clampInt(page, 1, 1000, 1),
      limit: clampInt(limit, 1, 50, DEFAULT_PAGE_LIMIT),
      difficulty: safeDifficulty,
      tags,
      block: String(top).toLowerCase() === 'true' ? 'top' : block,
      category,
      source: safeSource
    });

    return res.json(payload);
  } catch (error) {
    console.error('Interview prep question list error:', error.message);
    return res.status(500).json({ message: 'Failed to load interview questions.' });
  }
};

// GET /api/interview-prep/search
const searchInterviewPrepQuestions = async (req, res) => {
  try {
    const { q = '', skill = '', difficulty = '', tags = '', page = 1, limit = DEFAULT_PAGE_LIMIT, lookupOnly = '' } = req.query;
    const topicInput = readTopicInput(req.query || {});
    const trimmedQuery = String(q || '').trim();
    if (!trimmedQuery) {
      return res.status(400).json({ message: 'Query parameter q is required.' });
    }
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ message: `Query must be at most ${MAX_QUERY_LENGTH} characters.` });
    }
    const safeDifficulty = String(difficulty || '').trim().toLowerCase();
    if (!VALID_DIFFICULTIES.has(safeDifficulty)) {
      return res.status(400).json({ message: `Invalid difficulty. Must be one of: easy, medium, hard, senior, or empty.` });
    }

    const payload = await searchQuestionBank({
      q: trimmedQuery,
      skill,
      difficulty: safeDifficulty,
      tags,
      page: clampInt(page, 1, 1000, 1),
      limit: clampInt(limit, 1, 50, DEFAULT_PAGE_LIMIT),
      ...topicInput,
      allowEnrichment: String(lookupOnly).toLowerCase() !== 'true'
    });
    return res.json(payload);
  } catch (error) {
    console.error('Interview prep search error:', error.message);
    return res.status(500).json({ message: 'Failed to search interview questions.' });
  }
};

// POST /api/interview-prep/generate
const generateInterviewPrepQuestions = async (req, res) => {
  try {
    const { skill = '', query = '', difficulty = '', page = 1, limit = DEFAULT_PAGE_LIMIT, target = '' } = req.body || {};
    const topicInput = readTopicInput(req.body || {});
    const normalizedSkill = sanitizeSkill(skill || topicInput.topic || topicInput.language || topicInput.framework || topicInput.technology || topicInput.stack);
    if (!normalizedSkill && !topicInput.topic) {
      return res.status(400).json({ message: 'Body parameter skill or topic is required.' });
    }

    const payload = await generateFreshInterviewQuestions({
      skill: normalizedSkill,
      ...topicInput,
      query,
      difficulty,
      page,
      limit: target || limit
    });

    return res.json(payload);
  } catch (error) {
    console.error('Generate questions error:', error);
    return res.status(500).json({
      message: 'Failed to generate interview questions.',
      error: error.message
    });
  }
};

// POST /api/interview-prep/ask-question
const askInterviewPrepQuestion = async (req, res) => {
  try {
    const { question = '', skill = '' } = req.body || {};
    const topicInput = readTopicInput(req.body || {});
    const cleanQuestion = String(question || '').replace(/\s+/g, ' ').trim();

    if (!cleanQuestion) {
      return res.status(400).json({ message: 'Body parameter question is required.' });
    }
    if (cleanQuestion.length < 12 || cleanQuestion.length > 500) {
      return res.status(400).json({ message: 'Question must be between 12 and 500 characters.' });
    }

    const payload = await answerCustomInterviewQuestion({
      userId: req.user._id,
      question: cleanQuestion,
      skill,
      ...topicInput
    });

    return res.json(payload);
  } catch (error) {
    console.error('Interview prep ask-question error:', error.message);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to answer interview question.'
    });
  }
};

// GET /api/interview-prep/history
const getInterviewPrepHistory = async (req, res) => {
  try {
    const limit = Number(req.query.limit || 5);
    const sessions = await listInterviewPrepHistory(req.user._id, limit);
    res.json({ sessions });
  } catch (error) {
    console.error('Interview prep history error:', error.message);
    res.status(500).json({ message: 'Failed to load interview prep history.' });
  }
};

module.exports = {
  getInterviewPrepQuestions,
  searchInterviewPrepQuestions,
  generateInterviewPrepQuestions,
  askInterviewPrepQuestion,
  generateInterviewPrepSession,
  getInterviewPrepHistory
};
