const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../../../core/middleware/authmiddleware');
const { requireOrganizationContext } = require('../../../core/middleware/orgMiddleware');
const { requireRecruiterAccessEnabled } = require('../../../core/middleware/platformSettingsMiddleware');
const {
  getRecruiterDashboard,
  getRecruiterCandidates,
  getRecruiterCandidateById,
  createRecruiterJob,
  updateRecruiterJob,
  deleteRecruiterJob,
  getRecruiterJobs,
  matchCandidates,
  aiRankCandidates
} = require('../controllers/matching');

router.use(protect, authorizeRoles('recruiter'), requireRecruiterAccessEnabled, requireOrganizationContext(['recruiter']));

// Dashboard
router.get('/dashboard', getRecruiterDashboard);

// Candidates
router.get('/candidates', getRecruiterCandidates);
router.get('/candidate/:id', getRecruiterCandidateById);

// Jobs
router.post('/job', createRecruiterJob);
router.get('/jobs', getRecruiterJobs);
router.put('/job/:id', updateRecruiterJob);
router.delete('/job/:id', deleteRecruiterJob);

// Matching
router.post('/match', matchCandidates);
router.post('/ai-rank', aiRankCandidates);

module.exports = router;
