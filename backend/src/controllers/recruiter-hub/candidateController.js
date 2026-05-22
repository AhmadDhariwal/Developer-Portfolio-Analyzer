const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const {
  listRecruiterCandidates,
  getRecruiterCandidateDetails,
  analyzeRecruiterCandidate,
  logCandidateView
} = require('../../services/recruiter-hub/candidateService');

const listCandidates = async (req, res) => {
  try {
    const result = await listRecruiterCandidates({
      organizationId: req.organizationId,
      query: req.query || {}
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Recruiter hub candidates error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load candidates.' });
  }
};

const getCandidateDetails = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const candidate = await getRecruiterCandidateDetails(req.params.id, scope.organizationId);
    if (!candidate) {
      return res.status(404).json({ message: 'Candidate not found.' });
    }

    await logCandidateView({
      recruiterId: scope.recruiterId,
      organizationId: scope.organizationId,
      teamId: scope.teamIds[0] || null,
      candidateId: candidate.id || req.params.id,
      route: req.originalUrl
    });

    return res.status(200).json({ candidate });
  } catch (error) {
    console.error('Recruiter hub candidate details error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load candidate details.' });
  }
};

const analyzeCandidate = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const analysis = await analyzeRecruiterCandidate({
      recruiterId: scope.recruiterId,
      organizationId: scope.organizationId,
      teamId: scope.teamIds[0] || null,
      candidateId: req.params.id,
      route: req.originalUrl
    });

    if (!analysis) {
      return res.status(404).json({ message: 'Candidate not found.' });
    }

    return res.status(200).json({ analysis });
  } catch (error) {
    console.error('Recruiter hub candidate analysis error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to analyze candidate.' });
  }
};

module.exports = {
  listCandidates,
  getCandidateDetails,
  analyzeCandidate
};
