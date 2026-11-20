const Membership = require('../../../admin/models/membership');
const Team = require('../../../admin/models/team');

const { requireObjectId } = require('../recruiterValidation');

const getRecruiterMemberships = async ({ recruiterId, organizationId }) => {
  return Membership.find({
    userId: recruiterId,
    organizationId,
    status: 'active'
  })
    .populate({
      path: 'teamId',
      select: 'name',
      match: { organizationId, isActive: { $ne: false } }
    })
    .select('teamId role organizationId')
    .lean();
};

const getRecruiterScope = async (req) => {
  const recruiterId = requireObjectId(req.user?._id, 'recruiterId');
  const organizationId = requireObjectId(req.organizationId, 'organizationId');
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
  teamId = requireObjectId(teamId, 'teamId');

  const membership = await Membership.findOne({
    userId: recruiterId,
    organizationId,
    teamId,
    status: 'active'
  })
    .populate({
      path: 'teamId',
      select: 'name',
      match: { organizationId, isActive: { $ne: false } }
    })
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
