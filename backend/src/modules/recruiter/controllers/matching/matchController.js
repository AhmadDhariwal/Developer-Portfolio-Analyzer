const {
  matchCandidatesToJob,
  rankRecruiterCandidates
} = require('../../services/matching/matchingService');
const matchCandidates = async (req, res) => {
  try {
    const { jobId, candidateIds = [] } = req.body || {};

    if (!jobId) {
      return res.status(400).json({ message: 'jobId is required.' });
    }

    const result = await matchCandidatesToJob({
      organizationId: req.organizationId,
      recruiterId: req.user._id,
      sessionRevision: Number(req.user.sessionRevision || 0),
      jobId,
      candidateIds
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error.statusCode)
      return res
        .status(error.statusCode)
        .json({ message: error.message, restriction: error.restriction });
    if (error.code === 404) {
      return res.status(404).json({ message: error.message });
    }

    if (error.code === 400) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Match candidates error:', error.message);
    return res.status(500).json({ message: 'Failed to match candidates to job.' });
  }
};

const aiRankCandidates = async (req, res) => {
  try {
    return res.json(
      await rankRecruiterCandidates({
        recruiterId: req.user._id,
        sessionRevision: Number(req.user.sessionRevision || 0),
        organizationId: req.organizationId,
        payload: req.body || {}
      })
    );
  } catch (error) {
    return res
      .status(error.statusCode || error.code || 500)
      .json({ message: error.message, restriction: error.restriction });
  }
};

module.exports = {
  matchCandidates,
  aiRankCandidates
};
