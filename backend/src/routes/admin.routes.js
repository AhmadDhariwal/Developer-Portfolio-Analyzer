const express = require('express');
const router = express.Router();

const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const { requireOrganizationContext } = require('../middleware/orgMiddleware');
const { getOrganizationOverview, getDevelopers } = require('../controllers/admin/adminController');
const { getRecruiters, createRecruiter } = require('../controllers/admin/recruiterController');
const { getAdminJobs, createAdminJob, aiRankCandidates } = require('../controllers/admin/jobController');

router.use(protect, authorizeRoles('admin'), requireOrganizationContext(['admin']));

router.get('/overview', getOrganizationOverview);
router.get('/recruiters', getRecruiters);
router.post('/recruiter', createRecruiter);
router.get('/developers', getDevelopers);
router.get('/jobs', getAdminJobs);
router.post('/jobs', createAdminJob);
router.post('/ai-rank', aiRankCandidates);

module.exports = router;
