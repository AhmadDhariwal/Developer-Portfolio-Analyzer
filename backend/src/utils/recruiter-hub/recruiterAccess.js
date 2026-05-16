const Membership = require('../../models/membership');
const Team = require('../../models/team');

const toId = (value) => String(value || '').trim();

const getRecruiterMemberships = async ({ recruiterId, organizationId }) => {
  return Membership.find({
    userId: recruiterId,
    organizationId,
    status: 'active'
  })
    .populate('teamId', 'name')
    .select('teamId role organizationId')
    .lean();
};

const getRecruiterScope = async (req) => {
  const recruiterId = toId(req.user?._id);
  const organizationId = toId(req.organizationId);
  const memberships = await getRecruiterMemberships({ recruiterId, organizationId });
  const teams = memberships
    .filter((membership) => membership.teamId?._id)
    .map((membership) => ({
      _id: String(membership.teamId._id),
      name: membership.teamId.name || 'Team'
    }));

  return {
    recruiterId,
    organizationId,
    memberships,
    teamIds: teams.map((team) => team._id),
    teams
  };
};

const assertRecruiterTeamAccess = async ({ recruiterId, organizationId, teamId }) => {
  if (!teamId) return null;

  const membership = await Membership.findOne({
    userId: recruiterId,
    organizationId,
    teamId,
    status: 'active'
  })
    .populate('teamId', 'name')
    .lean();

  if (!membership?.teamId?._id) {
    const team = await Team.findOne({ _id: teamId, organizationId }).select('_id name').lean();
    if (!team) {
      const error = new Error('Team not found in this organization.');
      error.statusCode = 404;
      throw error;
    }

    const forbidden = new Error('You do not have access to this team.');
    forbidden.statusCode = 403;
    throw forbidden;
  }

  return {
    _id: String(membership.teamId._id),
    name: membership.teamId.name || 'Team'
  };
};

module.exports = {
  getRecruiterScope,
  assertRecruiterTeamAccess
};
