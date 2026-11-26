const express = require('express');
const router = express.Router();

const { protect } = require('../../../core/middleware/authmiddleware');
const { requireOrganizationContext } = require('../../../core/middleware/orgMiddleware');
const requireAdminAccountRole = require('../middleware/requireAdminAccountRole');
const { validateObjectIdParam } = require('../middleware/validateObjectIdParam');
const { getOrganizationOverview, getDevelopers } = require('../controllers/adminController');
const {
  getRecruiters,
  inviteRecruiter,
  addRecruiterDirect,
  updateRecruiter,
  setRecruiterActive,
  revokeRecruiterAccess,
  deleteRecruiter,
  getPendingInvitations,
  resendInvitation,
  revokeInvitation,
  expireInvitation,
  deleteInvitation
} = require('../controllers/recruiterController');
const {
  getAdminJobs,
  createAdminJob,
  updateAdminJob,
  closeAdminJob,
  deleteAdminJob,
  aiRankCandidates
} = require('../controllers/jobController');

router.use(protect, requireAdminAccountRole, requireOrganizationContext(['admin']));
router.param('id', validateObjectIdParam);

router.get('/overview', getOrganizationOverview);
router.get('/recruiters', getRecruiters);
router.post('/invite-recruiter', inviteRecruiter);
router.post('/recruiter', inviteRecruiter);
router.post('/recruiters/direct', addRecruiterDirect);
router.put('/recruiters/:id', updateRecruiter);
router.patch('/recruiters/:id/active', setRecruiterActive);
router.patch('/recruiters/:id/revoke', revokeRecruiterAccess);
router.delete('/recruiters/:id', deleteRecruiter);
router.get('/invitations/pending', getPendingInvitations);
router.post('/invitations/:id/resend', resendInvitation);
router.patch('/invitations/:id/revoke', revokeInvitation);
router.patch('/invitations/:id/expire', expireInvitation);
router.delete('/invitations/:id', deleteInvitation);
router.get('/developers', getDevelopers);
router.get('/jobs', getAdminJobs);
router.post('/jobs', createAdminJob);
router.put('/jobs/:id', updateAdminJob);
router.patch('/jobs/:id/close', closeAdminJob);
router.delete('/jobs/:id', deleteAdminJob);
router.post('/ai-rank', aiRankCandidates);

module.exports = router;
