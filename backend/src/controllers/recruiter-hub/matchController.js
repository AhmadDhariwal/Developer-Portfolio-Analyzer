const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const {
  generateRecruiterMatches,
  listRecruiterMatches,
  getRecruiterMatchDetails,
  updateMatchStatus
} = require('../../services/recruiter-hub/matchService');

const generateMatches = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const result = await generateRecruiterMatches({ ...scope, payload: req.body || {} });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Recruiter hub generate matches error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to generate matches.' });
  }
};

const listMatches = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const matches = await listRecruiterMatches({ ...scope, query: req.query || {} });
    return res.status(200).json({ matches });
  } catch (error) {
    console.error('Recruiter hub list matches error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load matches.' });
  }
};

const getMatchDetails = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const match = await getRecruiterMatchDetails({ ...scope, matchId: req.params.id });
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    return res.status(200).json({ match });
  } catch (error) {
    console.error('Recruiter hub match detail error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load match details.' });
  }
};

const patchMatchStatus = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const match = await updateMatchStatus({
      ...scope,
      matchId: req.params.id,
      status: String(req.body?.status || 'generated')
    });
    if (!match) return res.status(404).json({ message: 'Match not found.' });
    return res.status(200).json({ match });
  } catch (error) {
    console.error('Recruiter hub patch match status error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to update match status.' });
  }
};

module.exports = {
  generateMatches,
  listMatches,
  getMatchDetails,
  patchMatchStatus
};
