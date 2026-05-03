const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const {
  getAllOrganizations, suspendOrganization, activateOrganization,
  getAllAdmins, getAllRecruiters, getAllDevelopers, getAllTeams,
  toggleUserActive, getPlatformMetrics, getDashboard, getAnalytics
} = require('../controllers/superAdminController');

router.use(protect, authorizeRoles('super_admin'));

router.get('/metrics',                      getPlatformMetrics);
router.get('/dashboard',                    getDashboard);
router.get('/analytics',                    getAnalytics);
router.get('/organizations',                getAllOrganizations);
router.patch('/organizations/:id/suspend',  suspendOrganization);
router.patch('/organizations/:id/activate', activateOrganization);
router.get('/admins',                       getAllAdmins);
router.get('/recruiters',                   getAllRecruiters);
router.get('/developers',                   getAllDevelopers);
router.get('/teams',                        getAllTeams);
router.patch('/users/:id/toggle-active',    toggleUserActive);

module.exports = router;
