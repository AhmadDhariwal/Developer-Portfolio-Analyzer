/**
 * Admin Console Routes — /api/admin-console
 * Organization-scoped management for org admins.
 * Super admins are excluded (they use /super-admin instead).
 */
const express = require('express');
const router = express.Router();

const { protect, authorizeRoles } = require('../middleware/authmiddleware');
const { requireOrganizationContext } = require('../middleware/orgMiddleware');
const {
  getConsoleOverview,
  getConsoleAnalytics,
  getConsoleActivity,
  getConsoleTeams,
  createConsoleTeam,
  updateConsoleTeam,
  toggleConsoleTeamActive,
  deleteConsoleTeam,
  assignRecruiterToConsoleTeam,
  removeRecruiterFromConsoleTeam,
  getConsolePreferences,
  updateConsolePreferences
} = require('../controllers/adminConsoleController');

// All routes: must be authenticated, must be admin role (not super_admin — they have their own module),
// and must have a valid organization context.
router.use(protect, authorizeRoles('admin'), requireOrganizationContext(['admin']));

router.get('/overview',     getConsoleOverview);
router.get('/analytics',    getConsoleAnalytics);
router.get('/activity',     getConsoleActivity);
router.get('/teams',        getConsoleTeams);
router.post('/teams',       createConsoleTeam);
router.patch('/teams/:id',  updateConsoleTeam);
router.patch('/teams/:id/active', toggleConsoleTeamActive);
router.delete('/teams/:id', deleteConsoleTeam);
router.post('/teams/:id/recruiters', assignRecruiterToConsoleTeam);
router.delete('/teams/:id/recruiters/:recruiterId', removeRecruiterFromConsoleTeam);
router.get('/preferences',  getConsolePreferences);
router.patch('/preferences', updateConsolePreferences);

module.exports = router;
