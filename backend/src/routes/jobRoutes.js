const express = require('express');
const {
  fetchJobs,
  getJobById,
  getSourceHealthStatus,
  getCacheHealthStatus
} = require('../controllers/jobController');
const { protect } = require('../middleware/authmiddleware');
const actions = require('../controllers/jobActionController');
const {
  jobsRateLimit,
  jobsRefreshLimit,
  actionRateLimit,
  validateJobsRequest
} = require('../middleware/jobsRateLimit');

const router = express.Router();

// GET /api/jobs
// Query params: stack, experience, platform, location, skills, jobType, expLevel, page, limit
router.use(protect, validateJobsRequest, jobsRateLimit);
router.get('/', jobsRefreshLimit, fetchJobs);
router.get('/source-health', getSourceHealthStatus);
router.get('/cache-health', getCacheHealthStatus);
router.get('/actions', actions.list);
router.put('/:id/actions', validateJobsRequest, actionRateLimit, actions.update);
for (const [path, field] of [
  ['save', 'saved'],
  ['apply', 'applied'],
  ['hide', 'hidden']
]) {
  router.post(`/:id/${path}`, validateJobsRequest, actionRateLimit, actions.toggle(field, true));
  router.delete(`/:id/${path}`, validateJobsRequest, actionRateLimit, actions.toggle(field, false));
}
router.get('/:id', validateJobsRequest, getJobById);

module.exports = router;
