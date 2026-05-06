const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const {
  getAllOrganizations, suspendOrganization, activateOrganization,
  getAllAdmins, getAllRecruiters, getAllDevelopers, getAllTeams,
  toggleUserActive, getPlatformMetrics, getDashboard, getAnalytics,
  getUserDetails, createUser, updateUser,
  deleteUser,
  getRecruiterAnalytics, assignTeamToRecruiter, removeRecruiterTeam
} = require('../controllers/superAdminController');
const {
  getPlatformSettings,
  updatePlatformSettings
} = require('../controllers/superAdminSettingsController');

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
// Recruiter-team management (assign/remove teams) and recruiter analytics
router.get('/recruiters/:id/analytics',     getRecruiterAnalytics);
router.post('/recruiters/:id/teams',         assignTeamToRecruiter);
router.delete('/recruiters/:id/teams/:teamId', removeRecruiterTeam);
router.patch('/users/:id/toggle-active',    toggleUserActive);
router.get('/users/:id',                    getUserDetails);
router.post('/users',                       createUser);
router.patch('/users/:id',                  updateUser);
router.delete('/users/:id',                 deleteUser);
router.get('/settings',                     getPlatformSettings);
router.put('/settings',                     updatePlatformSettings);

module.exports = router;
