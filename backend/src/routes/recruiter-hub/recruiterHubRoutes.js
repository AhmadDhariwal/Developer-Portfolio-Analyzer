const express = require('express');
const { protect, authorizeRoles } = require('../../middleware/authmiddleware');
const { requireOrganizationContext } = require('../../middleware/orgMiddleware');
const { requireRecruiterAccessEnabled } = require('../../middleware/platformSettingsMiddleware');
const { compare } = require('../../controllers/recruiter-hub/comparisonController');
const { getProfile, patchProfile } = require('../../controllers/recruiter-hub/recruiterProfileController');

const candidateRoutes = require('./candidateRoutes');
const recruiterJobRoutes = require('./recruiterJobRoutes');
const matchRoutes = require('./matchRoutes');
const shortlistRoutes = require('./shortlistRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const activityRoutes = require('./activityRoutes');

const router = express.Router();

router.use(protect, authorizeRoles('recruiter'), requireRecruiterAccessEnabled, requireOrganizationContext(['recruiter']));

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
