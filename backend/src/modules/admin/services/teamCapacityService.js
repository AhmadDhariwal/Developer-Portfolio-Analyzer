const mongoose = require('mongoose');
const Organization = require('../models/organization');
const Team = require('../models/team');

const createTeamLimitError = (limit) =>
  Object.assign(new Error(`Maximum team limit (${limit}) reached for this organization.`), { status: 400 });

const createRecruiterLimitError = (limit) =>
  Object.assign(new Error(`Recruiter limit (${limit}) reached for this organization.`), {
    status: 400,
    statusCode: 400
  });

const isDuplicateOrganizationTeamSlug = (error) =>
  error?.code === 11000 &&
  (Object.prototype.hasOwnProperty.call(error.keyPattern || {}, 'slug') ||
    Object.prototype.hasOwnProperty.call(error.keyValue || {}, 'slug') ||
    /index: organizationId_1_slug_1\b/.test(error.message || ''));

const bumpOrganizationCapacityFence = async (organizationId, session) => {
  const organizationObjectId = new mongoose.Types.ObjectId(String(organizationId));
  const organization = await Organization.findById(organizationObjectId)
    .select('isSuspended updatedAt')
    .session(session)
    .lean();

  if (!organization || organization.isSuspended === true) {
    const status = organization ? 403 : 404;
    const message = organization ? 'Organization access is unavailable.' : 'Organization not found.';
    throw Object.assign(new Error(message), { status, statusCode: status });
  }

  // Advance an existing organization timestamp as the shared transaction write.
  // This serializes capacity checks without adding a schema field or counter.
  const candidateTimestamp = new Date(organization.updatedAt || 0).getTime();
  const previousTimestamp = Number.isFinite(candidateTimestamp) ? candidateTimestamp : 0;
  const nextTimestamp = new Date(Math.max(Date.now(), previousTimestamp + 1));
  const organizationWrite = await Organization.collection.updateOne(
    { _id: organizationObjectId, isSuspended: { $ne: true } },
    { $set: { updatedAt: nextTimestamp } },
    { session }
  );

  if (!organizationWrite.matchedCount) {
    const currentOrganization = await Organization.exists({ _id: organizationObjectId }).session(session);
    const status = currentOrganization ? 403 : 404;
    const error = Object.assign(
      new Error(currentOrganization ? 'Organization access is unavailable.' : 'Organization not found.'),
      { status, statusCode: status }
    );
    throw error;
  }

  return organizationObjectId;
};

const withOrganizationCapacityFence = async ({ organizationId, mutate }) =>
  mongoose.connection.transaction(async (session) => {
    const organizationObjectId = await bumpOrganizationCapacityFence(organizationId, session);
    return mutate(session, organizationObjectId);
  });

const withOrganizationTeamCapacity = async ({ organizationId, limit, create }) => {
  const teamLimit = Number(limit);

  return withOrganizationCapacityFence({
    organizationId,
    mutate: async (session, organizationObjectId) => {
      const teamCount = await Team.countDocuments({ organizationId: organizationObjectId }).session(session);
      if (teamCount >= teamLimit) throw createTeamLimitError(teamLimit);

      return create(session);
    }
  });
};

module.exports = {
  bumpOrganizationCapacityFence,
  createRecruiterLimitError,
  isDuplicateOrganizationTeamSlug,
  withOrganizationCapacityFence,
  withOrganizationTeamCapacity
};
