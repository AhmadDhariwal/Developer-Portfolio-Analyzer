const express = require('express');
const { protect } = require('../../../../core/middleware/authmiddleware');
const { requireRecruiterTenant } = require('../../middleware/requireRecruiterTenant');
const { requireOrganizationContext } = require('../../../../core/middleware/orgMiddleware');
const {
  requireRecruiterAccessEnabled
} = require('../../../../core/middleware/platformSettingsMiddleware');
const { compare } = require('../../controllers/hub/comparisonController');
const { getProfile, patchProfile } = require('../../controllers/hub/recruiterProfileController');

const candidateRoutes = require('./candidateRoutes');
const recruiterJobRoutes = require('./recruiterJobRoutes');
const matchRoutes = require('./matchRoutes');
const shortlistRoutes = require('./shortlistRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const activityRoutes = require('./activityRoutes');

const router = express.Router();

router.get(
  '/capabilities',
  protect,
  requireRecruiterTenant,
  requireOrganizationContext(['recruiter']),
  require('../../../admin/controllers/organizationGovernanceController').getCapabilities
);

router.use(
  protect,
  requireRecruiterTenant,
  requireRecruiterAccessEnabled,
  requireOrganizationContext(['recruiter'])
);

router.use('/candidates', candidateRoutes);
router.use('/jobs', recruiterJobRoutes);
router.use('/matches', matchRoutes);
router.use('/shortlists', shortlistRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/activity', activityRoutes);
router.post('/comparison', compare);
router.get('/profile', getProfile);
router.patch('/profile', patchProfile);

module.exports = router;
