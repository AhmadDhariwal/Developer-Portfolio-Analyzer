const express = require('express');
const { protect } = require('../middleware/authmiddleware');
const { requireOrganizationRole, requireTeamRole } = require('../middleware/rbacMiddleware');
const {
  createOrganizationValidators,
  createOrganization,
  listOrganizations,
  createTeamValidators,
  createTeam,
  listTeamsValidators,
  listTeams,
  inviteUserValidators,
  inviteUser,
  acceptInvitationValidators,
  acceptInvitation,
  acceptInvitationTokenValidators,
  acceptInvitationByToken,
  invitationDetailsValidators,
  getInvitationDetailsByToken,
  acceptInvitationOnboardValidators,
  acceptInvitationOnboard,
  listOrganizationMembersValidators,
  listOrganizationMembers,
  listTeamMembersValidators,
  listTeamMembers,
  updateMembershipRoleValidators,
  updateMembershipRole,
  listPendingInvitationsValidators,
  listPendingInvitations,
  revokeInvitationValidators,
  revokeInvitation,
  getTeamSharedDashboardValidators,
  getTeamSharedDashboard,
  getTeamAnalyticsValidators,
  getTeamAnalytics
} = require('../controllers/tenantcontroller');

const router = express.Router();

router.post('/organizations', protect, createOrganizationValidators, createOrganization);
router.get('/organizations', protect, listOrganizations);

router.post(
  '/organizations/:organizationId/teams',
  protect,
  requireOrganizationRole('manager'),
  createTeamValidators,
  createTeam
);

router.get(
  '/organizations/:organizationId/teams',
  protect,
  requireOrganizationRole('member'),
  listTeamsValidators,
  listTeams
);

router.post(
  '/organizations/:organizationId/invitations',
  protect,
  requireOrganizationRole('manager'),
  inviteUserValidators,
  inviteUser
);

router.get(
  '/organizations/:organizationId/invitations',
  protect,
  requireOrganizationRole('manager'),
  listPendingInvitationsValidators,
  listPendingInvitations
);

router.patch(
  '/organizations/:organizationId/invitations/:invitationId/revoke',
  protect,
  requireOrganizationRole('manager'),
  revokeInvitationValidators,
  revokeInvitation
);

router.post('/invitations/:invitationId/accept', protect, acceptInvitationValidators, acceptInvitation);
router.post('/invitations/accept/:token', protect, acceptInvitationTokenValidators, acceptInvitationByToken);
router.get('/invitations/:token/details', invitationDetailsValidators, getInvitationDetailsByToken);
router.post('/invitations/accept/:token/onboard', acceptInvitationOnboardValidators, acceptInvitationOnboard);

router.get(
  '/organizations/:organizationId/members',
  protect,
  requireOrganizationRole('member'),
  listOrganizationMembersValidators,
  listOrganizationMembers
);

router.get('/teams/:teamId/members', protect, requireTeamRole('member'), listTeamMembersValidators, listTeamMembers);

router.patch('/memberships/:membershipId/role', protect, updateMembershipRoleValidators, updateMembershipRole);

router.get(
  '/teams/:teamId/shared-dashboard',
  protect,
  requireTeamRole('member'),
  getTeamSharedDashboardValidators,
  getTeamSharedDashboard
);

router.get('/teams/:teamId/analytics', protect, requireTeamRole('member'), getTeamAnalyticsValidators, getTeamAnalytics);

module.exports = router;
