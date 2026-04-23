const {
  listCandidates,
  getCandidateById
} = require('../../services/recruiter/matchingService');

const getRecruiterCandidates = async (req, res) => {
  try {
    const { search = '', stack = '', experience = 0, minScore = 0, limit = 50 } = req.query;

    const candidates = await listCandidates({
      search: String(search || '').trim(),
      stack: String(stack || '').trim(),
      experience: Number(experience || 0),
      minScore: Number(minScore || 0),
      limit: Math.min(200, Math.max(1, Number(limit || 50)))
    });

    return res.status(200).json({ candidates });
  } catch (error) {
    console.error('Recruiter candidates error:', error.message);
    return res.status(500).json({ message: 'Failed to load candidates.' });
  }
};

const getRecruiterCandidateById = async (req, res) => {
  try {
    const candidate = await getCandidateById(req.params.id);

    if (!candidate) {
      return res.status(404).json({ message: 'Candidate not found.' });
    }

    return res.status(200).json({ candidate });
  } catch (error) {
    console.error('Recruiter candidate detail error:', error.message);
    return res.status(500).json({ message: 'Failed to load candidate profile.' });
  }
};

module.exports = {
  getRecruiterCandidates,
  getRecruiterCandidateById
};
