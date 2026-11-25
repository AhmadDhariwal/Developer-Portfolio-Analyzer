const Membership = require('../models/membership');
const Team = require('../models/team');
const Organization = require('../models/organization');

const ROLE_LEVEL = {
  member: 1,
  manager: 2,
  admin: 3
};

const normalizeSlug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const isRoleAtLeast = (role, minRole) => {
  const current = ROLE_LEVEL[String(role || 'member')] || 0;
  const required = ROLE_LEVEL[String(minRole || 'member')] || 0;
  return current >= required;
};

const canManageRole = (actorRole, targetRole) => {
  if (actorRole === 'admin') return true;
  if (actorRole === 'manager') return targetRole === 'member';
  return false;
};

const resolveOrganizationRole = async (userId, organizationId, session = null) => {
  const organization = await Organization.findOne({ _id: organizationId, isSuspended: { $ne: true } })
    .select('ownerId')
    .session(session)
    .lean();
  if (!organization) return null;

  const direct = await Membership.findOne({
    userId,
    organizationId,
    teamId: null,
    status: 'active'
  })
    .select('role')
    .session(session)
    .lean();

  if (direct) return direct.role;

  return String(organization.ownerId) === String(userId) ? 'admin' : null;
};

const resolveTeamRole = async (userId, teamId) => {
  const team = await Team.findOne({ _id: teamId, isActive: { $ne: false } })
    .select('organizationId')
    .lean();
  if (!team) return null;

  const organization = await Organization.exists({ _id: team.organizationId, isSuspended: { $ne: true } });
  if (!organization) return null;

  const teamMembership = await Membership.findOne({
    userId,
    teamId,
    organizationId: team.organizationId,
    status: 'active'
  })
    .select('organizationId role')
    .lean();

  if (teamMembership) {
    return {
      role: teamMembership.role,
      organizationId: teamMembership.organizationId,
      fromOrganization: false
    };
  }

  const orgRole = await resolveOrganizationRole(userId, team.organizationId);
  if (!orgRole) return null;

  return {
    role: orgRole,
    organizationId: team.organizationId,
    fromOrganization: true
  };
};

module.exports = {
  ROLE_LEVEL,
  normalizeSlug,
  isRoleAtLeast,
  canManageRole,
  resolveOrganizationRole,
  resolveTeamRole
};
