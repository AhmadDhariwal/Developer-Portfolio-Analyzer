const {
  DEFAULT_PAGE_LIMIT,
  generateInterviewPrepSessionFromBank,
  generateHybridInterviewQuestions,
  getQuestionBank,
  searchQuestionBank,
  listInterviewPrepHistory,
  sanitizeSkill
} = require('../services/interviewPrepService');

const mapCareerStackToSkill = (careerStack = '') => {
  const normalized = String(careerStack || '').trim().toLowerCase();
  if (normalized.includes('frontend') || normalized.includes('react')) return 'react';
  if (normalized.includes('backend') || normalized.includes('node')) return 'javascript';
  return 'mern';
};

// POST /api/interview-prep
const generateInterviewPrepSession = async (req, res) => {
  try {
    const { skill = '', query = '', skillGaps = [], careerStack, experienceLevel } = req.body || {};
    const inferredSkill = sanitizeSkill(skill)
      || sanitizeSkill(skillGaps[0])
      || mapCareerStackToSkill(careerStack || req.user.careerStack || '');

    const generated = await generateInterviewPrepSessionFromBank({
      userId: req.user._id,
      skill: inferredSkill,
      query,
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
    const { skill = '', page = 1, limit = DEFAULT_PAGE_LIMIT, difficulty = '', tags = '' } = req.query;
    const normalizedSkill = sanitizeSkill(skill);
    if (!normalizedSkill) {
      return res.status(400).json({ message: 'Query parameter skill is required.' });
    }

    const payload = await getQuestionBank({
      skill: normalizedSkill,
      page,
      limit,
      difficulty,
      tags
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
    const { q = '', skill = '', difficulty = '', tags = '', page = 1, limit = DEFAULT_PAGE_LIMIT } = req.query;
    if (!String(q || '').trim()) {
      return res.status(400).json({ message: 'Query parameter q is required.' });
    }

    const payload = await searchQuestionBank({ q, skill, difficulty, tags, page, limit });
    return res.json(payload);
  } catch (error) {
    console.error('Interview prep search error:', error.message);
    return res.status(500).json({ message: 'Failed to search interview questions.' });
  }
};

// POST /api/interview-prep/generate
const generateInterviewPrepQuestions = async (req, res) => {
  try {
    const { skill = '', query = '', page = 1, limit = DEFAULT_PAGE_LIMIT } = req.body || {};
    const normalizedSkill = sanitizeSkill(skill);
    if (!normalizedSkill) {
      return res.status(400).json({ message: 'Body parameter skill is required.' });
    }

    const payload = await generateHybridInterviewQuestions({
      skill: normalizedSkill,
      query,
      page,
      limit
    });

    return res.json(payload);
  } catch (error) {
    console.error('Interview prep hybrid generate error:', error.message);
    return res.status(500).json({ message: 'Failed to generate interview questions.' });
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
  generateInterviewPrepSession,
  getInterviewPrepHistory
};
