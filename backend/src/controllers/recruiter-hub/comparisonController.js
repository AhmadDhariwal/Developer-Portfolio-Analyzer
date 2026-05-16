const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const { compareCandidates } = require('../../services/recruiter-hub/comparisonService');

const compare = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const comparison = await compareCandidates({
      recruiterId: scope.recruiterId,
      organizationId: scope.organizationId,
      payload: req.body || {}
    });
    return res.status(200).json({ comparison });
  } catch (error) {
    console.error('Recruiter hub comparison error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to compare candidates.' });
  }
};

module.exports = {
  compare
};
