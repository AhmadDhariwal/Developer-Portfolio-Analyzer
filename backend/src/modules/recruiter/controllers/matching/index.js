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

const { getRecruiterDashboard } = require('./dashboardController');

module.exports = {
  getRecruiterDashboard,
  getRecruiterCandidates,
  getRecruiterCandidateById,
  createRecruiterJob,
  updateRecruiterJob,
  deleteRecruiterJob,
  getRecruiterJobs,
  matchCandidates,
  aiRankCandidates
};
