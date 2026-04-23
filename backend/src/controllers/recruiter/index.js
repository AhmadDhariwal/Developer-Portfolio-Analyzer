const {
  getRecruiterCandidates,
  getRecruiterCandidateById
} = require('./candidateController');

const {
  createRecruiterJob,
  updateRecruiterJob,
  deleteRecruiterJob,
  getRecruiterJobs
} = require('./jobController');

const {
  matchCandidates,
  aiRankCandidates
} = require('./matchController');

module.exports = {
  getRecruiterCandidates,
  getRecruiterCandidateById,
  createRecruiterJob,
  updateRecruiterJob,
  deleteRecruiterJob,
  getRecruiterJobs,
  matchCandidates,
  aiRankCandidates
};
