const express = require('express');
const {
  fetchJobs,
  getJobById,
  getSourceHealthStatus,
  getCacheHealthStatus
} = require('./jobController');
const { protect } = require('../../core/middleware/authmiddleware');
const actions = require('./jobActionController');
const {
  jobsRateLimit,
  jobsRefreshLimit,
  actionRateLimit,
  validateJobsRequest,
  limiter
} = require('./middleware/jobsRateLimit');

const router = express.Router();

// GET /api/jobs
// Query params: stack, experience, platform, location, skills, jobType, expLevel, page, limit
router.use(protect, validateJobsRequest, jobsRateLimit);
const applications = require('./jobApplicationController');
router.get('/internal', applications.developerOnly, applications.discover);
router.get('/internal/options', applications.developerOnly, applications.options);
router.get('/internal/applications', applications.developerOnly, applications.mine);
router.post(
  '/internal/applications/:applicationId/withdraw',
  applications.developerOnly,
  applications.withdraw
);
router.post('/internal/:id/applications', applications.developerOnly, applications.submit);
router.get('/', jobsRefreshLimit, fetchJobs);
router.get('/source-health', getSourceHealthStatus);
router.get('/cache-health', getCacheHealthStatus);
router.post(
  '/hidden-access/unlock',
  limiter('hidden-password', 10, 60000, true),
  actions.unlockHidden
);
router.post('/hidden-access/lock', actions.lockHidden);
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
