const {
  DEFAULT_PAGE_LIMIT,
  generateInterviewPrepSessionFromBank,
  generateHybridInterviewQuestions,
  answerCustomInterviewQuestion,
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
    const { skill = '', page = 1, limit = DEFAULT_PAGE_LIMIT, difficulty = '', tags = '' } = req.query;
    const topicInput = readTopicInput(req.query || {});
    const normalizedSkill = sanitizeSkill(skill || topicInput.topic || topicInput.language || topicInput.framework || topicInput.technology || topicInput.stack);
    if (!normalizedSkill && !topicInput.topic) {
      return res.status(400).json({ message: 'Query parameter skill or topic is required.' });
    }

    const payload = await getQuestionBank({
      skill: normalizedSkill,
      ...topicInput,
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
    const topicInput = readTopicInput(req.query || {});
    if (!String(q || '').trim()) {
      return res.status(400).json({ message: 'Query parameter q is required.' });
    }

    const payload = await searchQuestionBank({ q, skill, difficulty, tags, page, limit, ...topicInput });
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
    const topicInput = readTopicInput(req.body || {});
    const normalizedSkill = sanitizeSkill(skill || topicInput.topic || topicInput.language || topicInput.framework || topicInput.technology || topicInput.stack);
    if (!normalizedSkill && !topicInput.topic) {
      return res.status(400).json({ message: 'Body parameter skill or topic is required.' });
    }

    const payload = await generateHybridInterviewQuestions({
      skill: normalizedSkill,
      ...topicInput,
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

// POST /api/interview-prep/ask-question
const askInterviewPrepQuestion = async (req, res) => {
  try {
    const { question = '', skill = '' } = req.body || {};
    const topicInput = readTopicInput(req.body || {});

    if (!String(question || '').trim()) {
      return res.status(400).json({ message: 'Body parameter question is required.' });
    }

    const payload = await answerCustomInterviewQuestion({
      userId: req.user._id,
      question,
      skill,
      ...topicInput
    });

    return res.json(payload);
  } catch (error) {
    console.error('Interview prep ask-question error:', error.message);
    return res.status(500).json({ message: 'Failed to answer interview question.' });
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
