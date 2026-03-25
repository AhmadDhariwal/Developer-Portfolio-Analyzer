const { getCandidates } = require('../services/recruiterService');

// GET /api/recruiter/candidates
const getRecruiterCandidates = async (req, res) => {
  try {
    const { search = '', minScore = 0, skills = '', limit = 20 } = req.query;
    const skillList = String(skills || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const candidates = await getCandidates({
      search: String(search || '').trim(),
      minScore: Number(minScore || 0),
      skills: skillList,
      limit: Number(limit || 20)
    });

    res.json({ candidates });
  } catch (error) {
    console.error('Recruiter candidates error:', error.message);
    res.status(500).json({ message: 'Failed to load candidates.' });
  }
};

module.exports = { getRecruiterCandidates };
