const Invitation = require('../models/invitation');
const Membership = require('../models/membership');
const Team = require('../models/team');
const User = require('../../auth/models/user');
const { canManageRole, resolveOrganizationRole } = require('./tenantService');
const { bumpOrganizationCapacityFence, createRecruiterLimitError } = require('./teamCapacityService');
const {
  getOrganizationSettingsSync,
  getRecruiterSettingsSync
} = require('../../super-admin/services/platformSettingsService');

const invitationError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function claimInvitation({ selector, session }) {
  const invitation = await Invitation.findOneAndUpdate(
    { ...selector, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'accepted' } },
    { session, returnDocument: 'after' }
  );
  if (!invitation) throw invitationError(400, 'Invitation is no longer pending or has expired.');

  await bumpOrganizationCapacityFence(invitation.organizationId, session);
  if (invitation.teamId) {
    const team = await Team.exists({
      _id: invitation.teamId,
      organizationId: invitation.organizationId,
      isActive: { $ne: false }
    }).session(session);
    if (!team) throw invitationError(409, 'The assigned team is unavailable.');
  }

  const inviter = await User.findOne({ _id: invitation.invitedBy, isActive: { $ne: false } })
    .select('role organizationId')
    .session(session)
    .lean();
  if (!inviter) throw invitationError(403, 'The inviter is no longer authorized.');

  const settings = getOrganizationSettingsSync();
  if (invitation.role === 'recruiter') {
    if (
      getRecruiterSettingsSync().enableRecruiterAccess === false ||
      inviter.role !== 'admin' ||
      String(inviter.organizationId) !== String(invitation.organizationId)
    ) {
      throw invitationError(403, 'Recruiter invitation is unavailable.');
    }
  } else {
    const role = await resolveOrganizationRole(inviter._id, invitation.organizationId, session);
    if (
      !['member', 'manager', 'admin'].includes(invitation.role) ||
      !canManageRole(role, invitation.role) ||
      (invitation.role === 'admin' && settings.adminInvitesRequireApproval)
    ) {
      throw invitationError(403, 'The inviter is no longer authorized.');
    }
  }
  return invitation;
}

async function assertRecipient({ account, invitation, session }) {
  if (
    !account ||
    account.isActive === false ||
    !account.isVerified ||
    account.email.trim().toLowerCase() !== invitation.email ||
    !['user', 'developer', 'recruiter'].includes(account.role)
  ) {
    throw invitationError(403, 'Invitation requires an eligible verified recipient.');
  }
  if (account.organizationId && !account.organizationId.equals(invitation.organizationId)) {
    throw invitationError(403, 'This invitation cannot transfer an account between organizations.');
  }
  const foreignMembership = await Membership.exists({
    userId: account._id,
    organizationId: { $ne: invitation.organizationId },
    status: 'active'
  }).session(session);
  if (foreignMembership)
    throw invitationError(403, 'This invitation cannot transfer an account between organizations.');
}

async function assertRecruiterCapacity(invitation, account, session) {
  if (account?.role === 'recruiter' && account.organizationId?.equals(invitation.organizationId)) return;
  const activeCount = await User.countDocuments({
    role: 'recruiter',
    organizationId: invitation.organizationId,
    isActive: { $ne: false }
  }).session(session);
  const limit = Number(getOrganizationSettingsSync().recruiterLimitPerOrg || 5);
  if (activeCount >= limit) throw createRecruiterLimitError(limit);
}

async function acceptMembership(invitation, userId, session) {
  const recruiterInvite = invitation.role === 'recruiter';
  const teamIds = recruiterInvite && invitation.teamId ? [null, invitation.teamId] : [invitation.teamId ?? null];
  let membership;
  for (const teamId of teamIds) {
    const existing = await Membership.findOne({
      organizationId: invitation.organizationId,
      userId,
      teamId
    }).session(session);
    membership =
      existing?.status === 'active'
        ? existing
        : await Membership.findOneAndUpdate(
            { organizationId: invitation.organizationId, userId, teamId },
            {
              $set: {
                role: recruiterInvite ? 'member' : invitation.role,
                status: 'active',
                invitedBy: invitation.invitedBy,
                joinedAt: new Date()
              }
            },
            { session, upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
          );
  }
  invitation.acceptedBy = userId;
  await invitation.save({ session });
  return membership;
}

module.exports = { invitationError, claimInvitation, assertRecipient, assertRecruiterCapacity, acceptMembership };
