const Membership = require('../models/membership');
const Team = require('../models/team');

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

const resolveOrganizationRole = async (userId, organizationId) => {
  const direct = await Membership.findOne({
    userId,
    organizationId,
    teamId: null,
    status: 'active'
  })
    .select('role')
    .lean();

  if (direct) return direct.role;

  const teamMembership = await Membership.findOne({
    userId,
    organizationId,
    teamId: { $ne: null },
    status: 'active'
  })
    .sort({ updatedAt: -1 })
    .select('role')
    .lean();

  return teamMembership?.role || null;
};

const resolveTeamRole = async (userId, teamId) => {
  const teamMembership = await Membership.findOne({
    userId,
    teamId,
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

  const team = await Team.findById(teamId).select('organizationId').lean();
  if (!team) return null;

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
