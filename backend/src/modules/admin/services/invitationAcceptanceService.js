const Invitation = require('../models/invitation');
const Membership = require('../models/membership');
const Team = require('../models/team');
const User = require('../../auth/models/user');
const {
  actorInSession,
  organizationPolicyInSession,
  platformInSession
} = require('./organizationGovernanceService');
const { canManageRole } = require('./tenantService');
const {
  bumpOrganizationCapacityFence,
  createRecruiterLimitError
} = require('./teamCapacityService');
const {
  getOrganizationSettingsSync
} = require('../../super-admin/services/platformSettingsService');

const invitationError = (statusCode, message) =>
  Object.assign(new Error(message), { status: statusCode, statusCode });

function assertRecruiterInviterAuthority({
  inviter,
  organization,
  organizationRole,
  owner,
  membership,
  platform
}) {
  if (platform?.recruiter?.enableRecruiterAccess === false) {
    throw invitationError(403, 'Recruiter invitation is unavailable.');
  }

  const sameOrgOrUnbound =
    !inviter?.organizationId || String(inviter.organizationId) === String(organization._id);
  const directAdmin =
    Boolean(membership) &&
    membership.status === 'active' &&
    membership.role === 'admin' &&
    inviter?.role === 'admin' &&
    sameOrgOrUnbound;
  const legacyAffiliatedAdmin =
    !membership &&
    inviter?.role === 'admin' &&
    String(inviter.organizationId) === String(organization._id);
  // Exact organization ownership remains supported for active admin and super_admin
  // owners unless explicit direct-membership precedence restricts their role.
  const authorizedOwner =
    Boolean(owner) &&
    organizationRole === 'admin' &&
    ['admin', 'super_admin'].includes(inviter?.role);

  if (!directAdmin && !legacyAffiliatedAdmin && !authorizedOwner) {
    throw invitationError(403, 'Recruiter invitation is unavailable.');
  }
}

async function assertInviterAuthority({ invitation, organization, platform, session }) {
  // Reuse the session-fenced actor and direct-membership authority contract so
  // acceptance observes concurrent account, role, affiliation and membership revocations.
  const {
    actor: inviter,
    organizationRole,
    owner,
    membership
  } = await actorInSession({ actorId: invitation.invitedBy }, organization, session, false);

  if (invitation.role === 'recruiter') {
    assertRecruiterInviterAuthority({
      inviter,
      organization,
      organizationRole,
      owner,
      membership,
      platform
    });
    return { inviter, organizationRole, owner, membership };
  }

  const settings = platform.organization || getOrganizationSettingsSync();
  if (
    !['member', 'manager', 'admin'].includes(invitation.role) ||
    !canManageRole(organizationRole, invitation.role) ||
    (invitation.role === 'admin' && settings.adminInvitesRequireApproval)
  ) {
    throw invitationError(403, 'The inviter is no longer authorized.');
  }

  return { inviter, organizationRole, owner, membership };
}

async function claimInvitation({ selector, session }) {
  const invitation = await Invitation.findOneAndUpdate(
    { ...selector, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'accepted' } },
    { session, returnDocument: 'after' }
  );
  if (!invitation) throw invitationError(400, 'Invitation is no longer pending or has expired.');

  await bumpOrganizationCapacityFence(invitation.organizationId, session);
  const organization = await organizationPolicyInSession(
    invitation.organizationId,
    session,
    'invitationCreation'
  );
  const platform = await platformInSession(session);
  if (invitation.teamId) {
    const team = await Team.exists({
      _id: invitation.teamId,
      organizationId: invitation.organizationId,
      isActive: { $ne: false }
    }).session(session);
    if (!team) throw invitationError(409, 'The assigned team is unavailable.');
  }

  await assertInviterAuthority({ invitation, organization, platform, session });
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
  if (account?.role === 'recruiter' && account.organizationId?.equals(invitation.organizationId))
    return;
  const activeCount = await User.countDocuments({
    role: 'recruiter',
    organizationId: invitation.organizationId,
    isActive: { $ne: false }
  }).session(session);
  const platform = await platformInSession(session);
  const limit = Number(platform.organization?.recruiterLimitPerOrg ?? 5);
  if (activeCount >= limit) throw createRecruiterLimitError(limit);
}

async function acceptMembership(invitation, userId, session) {
  const recruiterInvite = invitation.role === 'recruiter';
  const teamIds =
    recruiterInvite && invitation.teamId ? [null, invitation.teamId] : [invitation.teamId ?? null];
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

module.exports = {
  invitationError,
  assertRecruiterInviterAuthority,
  assertInviterAuthority,
  claimInvitation,
  assertRecipient,
  assertRecruiterCapacity,
  acceptMembership
};
