const { generateInterviewPrep, listInterviewPrepHistory } = require('../services/interviewPrepService');

// POST /api/interview-prep
const generateInterviewPrepSession = async (req, res) => {
  try {
    const { skillGaps = [], careerStack, experienceLevel } = req.body || {};
    const session = await generateInterviewPrep({
      userId: req.user._id,
      careerStack: careerStack || req.user.careerStack || 'Full Stack',
      experienceLevel: experienceLevel || req.user.experienceLevel || 'Student',
      skillGaps: Array.isArray(skillGaps) ? skillGaps : []
    });

    res.json(session);
  } catch (error) {
    console.error('Interview prep generate error:', error.message);
    res.status(500).json({ message: 'Failed to generate interview prep.' });
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
  generateInterviewPrepSession,
  getInterviewPrepHistory
};
