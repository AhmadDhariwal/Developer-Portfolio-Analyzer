const Team = require('../models/team');
const {
  isRoleAtLeast,
  resolveOrganizationRole,
  resolveTeamRole
} = require('../services/tenantService');

const extractOrganizationId = (req) =>
  req.params.organizationId || req.body.organizationId || req.query.organizationId;

const extractTeamId = (req) =>
  req.params.teamId || req.body.teamId || req.query.teamId;

const requireOrganizationRole = (minRole = 'member') => {
  return async (req, res, next) => {
    try {
      const organizationId = extractOrganizationId(req);
      if (!organizationId) {
        return res.status(400).json({ message: 'organizationId is required.' });
      }

      const role = await resolveOrganizationRole(req.user._id, organizationId);
      if (!role || !isRoleAtLeast(role, minRole)) {
        return res.status(403).json({ message: 'Insufficient organization role.' });
      }

      req.tenantContext = {
        ...req.tenantContext,
        organizationId,
        role
      };

      next();
    } catch (error) {
      console.error('Organization RBAC error:', error.message);
      res.status(500).json({ message: 'Failed to evaluate organization permissions.' });
    }
  };
};

const requireTeamRole = (minRole = 'member') => {
  return async (req, res, next) => {
    try {
      const teamId = extractTeamId(req);
      if (!teamId) {
        return res.status(400).json({ message: 'teamId is required.' });
      }

      const teamRole = await resolveTeamRole(req.user._id, teamId);
      if (!teamRole || !isRoleAtLeast(teamRole.role, minRole)) {
        return res.status(403).json({ message: 'Insufficient team role.' });
      }

      const team = await Team.findById(teamId).select('organizationId').lean();
      if (!team) {
        return res.status(404).json({ message: 'Team not found.' });
      }

      req.tenantContext = {
        ...req.tenantContext,
        teamId,
        organizationId: String(team.organizationId),
        role: teamRole.role
      };

      next();
    } catch (error) {
      console.error('Team RBAC error:', error.message);
      res.status(500).json({ message: 'Failed to evaluate team permissions.' });
    }
  };
};

module.exports = {
  requireOrganizationRole,
  requireTeamRole
};
