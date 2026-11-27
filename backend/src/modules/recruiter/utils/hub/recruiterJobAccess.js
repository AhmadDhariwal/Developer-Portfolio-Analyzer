const Job = require('../../models/Job');
const User = require('../../../auth/models/user');
const Organization = require('../../../admin/models/organization');
const Membership = require('../../../admin/models/membership');
const Team = require('../../../admin/models/team');
const { requireObjectId } = require('../recruiterValidation');
const { isRoleAtLeast } = require('../../../admin/services/tenantService');
const { Types } = require('mongoose');
const workflowBudget = require('./applicationWorkflowBudget');
const { policyValues, restrictionError } = require('../../../admin/config/organizationPolicies');
const { platformInSession } = require('../../../admin/services/organizationGovernanceService');

const denied = (message = 'Job access is unavailable.', statusCode = 403) =>
  Object.assign(new Error(message), { statusCode });

// These writes serialize policy decisions with existing admin updates/deletes.
// Raw counters are internal fences, not schema permissions or cached grants.
async function fence(model, record, filter, session) {
  const result = await model.collection.updateOne(
    { _id: record._id, ...filter },
    { $inc: { recruiterJobAccessRevision: 1 } },
    { session }
  );
  if (!result.matchedCount) throw denied('Job access changed. Refresh and try again.');
}

async function readWithFence(model, filter, session, projection) {
  return model.collection.findOneAndUpdate(
    filter,
    { $inc: { recruiterJobAccessRevision: 1 } },
    { session, projection, returnDocument: 'after', includeResultMetadata: false }
  );
}

async function context(scope, session, atomicActorFence = false) {
  const recruiterId = requireObjectId(scope.recruiterId, 'recruiterId');
  const organizationId = requireObjectId(scope.organizationId, 'organizationId');
  const actorFilter = {
    _id: recruiterId,
    organizationId,
    role: 'recruiter',
    isActive: { $ne: false }
  };
  const fenceFilter = { ...actorFilter };
  delete fenceFilter._id;
  if (scope.sessionRevision !== undefined)
    fenceFilter.$expr = { $eq: [{ $ifNull: ['$sessionRevision', 0] }, scope.sessionRevision] };
  // Acquire the existing actor fence as the first transaction operation. Reading
  // actor/organization before this write creates a stale snapshot on every rival
  // commit and repeats those reads on conflict. The filter retains all authority.
  const actor = atomicActorFence
    ? await readWithFence(
        User,
        {
          ...fenceFilter,
          _id: new Types.ObjectId(recruiterId),
          organizationId: new Types.ObjectId(organizationId)
        },
        session,
        { _id: 1, organizationId: 1, role: 1, isActive: 1, sessionRevision: 1 }
      )
    : await User.findOne(actorFilter).session(session).lean();
  const organization = atomicActorFence
    ? await readWithFence(
        Organization,
        { _id: new Types.ObjectId(organizationId), isSuspended: { $ne: true } },
        session
      )
    : await Organization.findOne({
        _id: organizationId,
        isSuspended: { $ne: true }
      })
        .session(session)
        .setOptions(workflowBudget.cursorOptions(session))
        .lean();
  if (!actor || !organization) throw denied();
  const platform = await platformInSession(session);
  if (platform.recruiter?.enableRecruiterAccess === false)
    throw restrictionError('recruiterAccess', 'platform_policy');
  if (!atomicActorFence)
    await fence(User, actor, { ...fenceFilter, organizationId: organization._id }, session);
  if (!atomicActorFence)
    await fence(Organization, organization, { isSuspended: { $ne: true } }, session);
  const memberships = await Membership.find({ userId: actor._id, organizationId: organization._id })
    .session(session)
    .setOptions(workflowBudget.cursorOptions(session))
    .lean();
  const direct = memberships.find((entry) => !entry.teamId);
  if (direct && direct.status !== 'active') throw denied('Organization membership is not active.');
  const active = memberships.filter((entry) => entry.status === 'active');
  const teams = await Team.find({
    _id: { $in: active.map((entry) => entry.teamId).filter(Boolean) },
    organizationId: organization._id,
    isActive: true
  })
    .session(session)
    .setOptions(workflowBudget.cursorOptions(session))
    .lean();
  const grants = new Map();
  for (const membership of active) {
    const team = teams.find((entry) => String(entry._id) === String(membership.teamId));
    if (membership.teamId && !team) continue;
    await fence(Membership, membership, { status: 'active', role: membership.role }, session);
    if (team) {
      await fence(Team, team, { organizationId: organization._id, isActive: true }, session);
      grants.set(String(team._id), { team, role: membership.role });
    }
  }
  // Legacy direct organization affiliation keeps creator access, never a team grant.
  if (memberships.length && !direct && !grants.size)
    throw denied('Organization membership is not active.');
  return {
    recruiterId,
    organizationId,
    actor,
    grants,
    session,
    organization,
    policies: policyValues(organization),
    platform
  };
}

function permissions(job, ctx) {
  const isOwner = String(job.recruiterId) === ctx.recruiterId;
  const policies = ctx.policies || policyValues(ctx.organization);
  const grant =
    job.teamShared === true && policies.teamSharedJobs ? ctx.grants.get(String(job.teamId)) : null;
  const view = isOwner || Boolean(grant);
  const manage = isOwner || Boolean(grant && isRoleAtLeast(grant.role, 'manager'));
  return {
    isOwner,
    view,
    edit: manage,
    publish: manage && policies.recruiterJobPublication,
    archive: manage,
    delete: isOwner,
    manageSharing: isOwner,
    privateEvidence: isOwner,
    matching: isOwner && policies.candidateMatching,
    evaluationView:
      isOwner ||
      Boolean(grant && job.evaluationShared === true && policies.sharedPublicEvaluations),
    evaluationManage:
      isOwner ||
      Boolean(
        grant &&
        job.evaluationShared === true &&
        manage &&
        policies.sharedPublicEvaluations &&
        policies.teamManagerEvaluationManagement
      )
  };
}

function requirePermission(job, ctx, action) {
  const access = permissions(job, ctx);
  if (!access.view) throw denied('Job not found.', 404);
  if (!access[action]) throw denied('You do not have permission for this job action.');
  return access;
}

function sharingTeam(ctx, teamId) {
  const id = requireObjectId(teamId, 'teamId');
  const grant = ctx.grants.get(id);
  if (!grant) throw denied('An active membership in the selected team is required.');
  return grant.team;
}

async function jobView(job, ctx) {
  const access = requirePermission(job, ctx, 'view');
  await fence(
    Job,
    job,
    { organizationId: job.organizationId, recruiterId: job.recruiterId },
    ctx.session
  );
  const owner = await User.findById(job.recruiterId).select('name').session(ctx.session).lean();
  const team = job.teamId
    ? await Team.findOne({ _id: job.teamId, organizationId: ctx.organizationId, isActive: true })
        .select('name')
        .session(ctx.session)
        .lean()
    : null;
  const metadata = { ...job };
  delete metadata.recruiterJobAccessRevision;
  return {
    ...metadata,
    teamShared: job.teamShared === true,
    evaluationShared: job.evaluationShared === true,
    version: Number(job.__v || 0),
    owner: { _id: job.recruiterId, name: owner?.name || 'Job owner' },
    sharedTeam: team ? { _id: team._id, name: team.name } : null,
    access
  };
}

async function withAccess(scope, work, { deadline } = {}) {
  await Promise.all([Job, User, Organization, Membership, Team].map((model) => model.init()));
  const beforeAttempt = deadline === undefined ? null : workflowBudget.retryGuard(deadline);
  return Job.db.transaction(
    async (session) => {
      if (beforeAttempt) await beforeAttempt();
      const ctx = await context(scope, session, deadline !== undefined);
      return work({ ...ctx, deadline });
    },
    {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      ...(deadline === undefined
        ? {}
        : {
            timeoutMS: workflowBudget.remaining(deadline),
            maxCommitTimeMS: Math.min(2000, workflowBudget.remaining(deadline))
          })
    }
  );
}

module.exports = {
  withAccess,
  permissions,
  requirePermission,
  sharingTeam,
  jobView,
  denied,
  fence,
  readWithFence
};
