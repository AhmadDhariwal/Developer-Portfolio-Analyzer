const mongoose = require('mongoose');
const Organization = require('../models/organization');
const Membership = require('../models/membership');
const Team = require('../models/team');
const Invitation = require('../models/invitation');
const AuditLog = require('../models/auditLog');
const User = require('../../auth/models/user');
const Settings = require('../../super-admin/models/platformSettings');
const { DEFAULT_SETTINGS } = require('../../super-admin/services/platformSettingsService');
const { withOrganizationCapacityFence } = require('./teamCapacityService');
const {
  POLICY_CATALOG,
  policyValues,
  assertPolicy,
  restrictionError
} = require('../config/organizationPolicies');

const fail = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, allowed) => {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw fail(400, 'Unsupported configuration fields.');
};

async function platformInSession(session) {
  const settings = await Settings.findOne({ scope: 'global' })
    .select('organization recruiter general.defaultTimezone')
    .session(session)
    .lean();
  if (settings) {
    // Conflict with platform updates, rather than trusting the process cache.
    await Settings.collection.updateOne(
      { _id: settings._id },
      { $inc: { governanceAccessRevision: 1 } },
      { session }
    );
  }
  // Same defaults as the accepted uninitialized installation contract.
  return settings || DEFAULT_SETTINGS;
}

async function organizationPolicyInSession(organizationId, session, capability) {
  const organization = await Organization.findById(organizationId).session(session).lean();
  if (!organization || organization.isSuspended)
    throw fail(403, 'Organization access is unavailable.');
  assertPolicy(organization, capability);
  return organization;
}

async function actorInSession(scope, organization, session, adminOnly = false) {
  if (!organization || organization.isSuspended)
    throw fail(403, 'Organization access is unavailable.');
  if (!mongoose.isValidObjectId(scope?.actorId))
    throw fail(403, 'Organization Admin authority required.');
  const filter = {
    _id: new mongoose.Types.ObjectId(String(scope.actorId)),
    isActive: { $ne: false },
    ...(scope.sessionRevision === undefined
      ? {}
      : { $expr: { $eq: [{ $ifNull: ['$sessionRevision', 0] }, scope.sessionRevision] } })
  };
  const actor = await User.collection.findOneAndUpdate(
    filter,
    { $inc: { governanceAccessRevision: 1 } },
    {
      session,
      returnDocument: 'after',
      includeResultMetadata: false,
      projection: { role: 1, organizationId: 1 }
    }
  );
  if (!actor || (adminOnly && actor.role !== 'admin'))
    throw fail(403, 'Organization Admin authority required.');
  const membership = await Membership.findOne({
    organizationId: organization._id,
    userId: actor._id,
    teamId: null
  })
    .session(session)
    .lean();
  if (membership && membership.status !== 'active')
    throw fail(403, 'Organization membership is not active.');
  const owner = String(organization.ownerId) === String(actor._id);
  const organizationRole = membership?.role || (owner ? 'admin' : null);
  if (adminOnly && !(owner || organizationRole === 'admin'))
    throw fail(403, 'Organization ownership or active organization Admin membership required.');
  if (
    !adminOnly &&
    !owner &&
    !membership &&
    String(actor.organizationId) !== String(organization._id)
  )
    throw fail(403, 'Organization access is unavailable.');
  if (membership) {
    const membershipFence = await Membership.collection.updateOne(
      { _id: membership._id, status: 'active', role: membership.role },
      { $inc: { governanceAccessRevision: 1 } },
      { session }
    );
    if (!membershipFence.matchedCount) throw fail(403, 'Organization membership is not active.');
  }
  return { actor, organizationRole, owner, membership };
}

const withGovernance = (scope, work, adminOnly = true) =>
  withOrganizationCapacityFence({
    organizationId: scope.organizationId,
    mutate: async (session, organizationId) => {
      const organization = await Organization.findById(organizationId).session(session).lean();
      const authority = await actorInSession(scope, organization, session, adminOnly);
      return work({ organization, session, ...authority });
    }
  });

function generalView(organization) {
  return {
    _id: organization._id,
    name: organization.name,
    slug: organization.slug,
    description: organization.description || '',
    industry: organization.industry || '',
    website: organization.website || '',
    timezone: organization.timezone || '',
    branding: { logoUrl: organization.branding?.logoUrl || '' }
  };
}

function configurationView(organization) {
  return {
    organization: generalView(organization),
    version: Number(organization.governance?.version || 0),
    policies: policyValues(organization)
  };
}

async function getGovernance(scope) {
  return withGovernance(scope, async ({ organization, session }) => {
    const settings = await platformInSession(session);
    const activeRecruiters = await User.countDocuments({
      organizationId: organization._id,
      role: 'recruiter',
      isActive: { $ne: false }
    }).session(session);
    const teams = await Team.countDocuments({ organizationId: organization._id }).session(session);
    const activeTeams = await Team.countDocuments({
      organizationId: organization._id,
      isActive: { $ne: false }
    }).session(session);
    return {
      ...configurationView(organization),
      resources: {
        limits: {
          activeRecruiters: settings.organization?.recruiterLimitPerOrg ?? 5,
          teams: settings.organization?.maxTeamsPerOrganization ?? 10
        },
        usage: { activeRecruiters, teams, activeTeams },
        editable: false
      },
      catalog: Object.entries(POLICY_CATALOG).map(([id, label]) => ({
        id,
        label,
        type: 'boolean',
        default: true
      })),
      defaultTimezone: settings.general?.defaultTimezone || 'Asia/Karachi'
    };
  });
}

function validateGeneral(general) {
  keysOnly(general, ['name', 'description', 'industry', 'website', 'timezone', 'branding']);
  const patch = {};
  for (const [key, max] of [
    ['name', 80],
    ['description', 500],
    ['industry', 100],
    ['website', 500],
    ['timezone', 100]
  ]) {
    if (!Object.hasOwn(general, key)) continue;
    if (typeof general[key] !== 'string') throw fail(400, `${key} must be a string.`);
    const value = general[key].trim();
    if (value.length > max || (key === 'name' && value.length < 2))
      throw fail(400, `${key} has an invalid length.`);
    patch[key] = value;
  }
  const url = (value, key) => {
    if (!value) return;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw fail(400, `${key} must be an HTTPS URL.`);
    }
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw fail(400, `${key} must be an HTTPS URL without credentials, query or fragment.`);
  };
  url(patch.website, 'website');
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: patch.timezone });
    } catch {
      throw fail(400, 'timezone must be an IANA timezone.');
    }
  }
  if (general.branding !== undefined) {
    keysOnly(general.branding, ['logoUrl']);
    if (typeof general.branding.logoUrl !== 'string' || general.branding.logoUrl.length > 500)
      throw fail(400, 'logoUrl is invalid.');
    const logoUrl = general.branding.logoUrl.trim();
    url(logoUrl, 'logoUrl');
    patch.branding = { logoUrl };
  }
  return patch;
}

async function updateGovernance(scope, payload, { preferences = false } = {}) {
  keysOnly(
    payload,
    preferences
      ? ['expectedVersion', 'name', 'description', 'dashboardConfig']
      : ['expectedVersion', 'general', 'policies']
  );
  if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0)
    throw fail(400, 'expectedVersion must be a non-negative integer.');
  const general = validateGeneral(
    preferences
      ? { name: payload.name, description: payload.description ?? '' }
      : Object.hasOwn(payload, 'general')
        ? payload.general
        : {}
  );
  const policies = Object.hasOwn(payload, 'policies') ? payload.policies : {};
  keysOnly(policies, Object.keys(POLICY_CATALOG));
  for (const value of Object.values(policies))
    if (typeof value !== 'boolean') throw fail(400, 'Policy values must be booleans.');
  if (!Object.keys(general).length && !Object.keys(policies).length)
    throw fail(400, 'No configuration changes supplied.');
  return withGovernance(scope, async ({ organization, session }) => {
    if (Number(organization.governance?.version || 0) !== payload.expectedVersion)
      throw fail(409, 'Organization configuration changed. Refresh and review before retrying.');
    const patch = { ...general };
    const before = {};
    const after = {};
    for (const key of Object.keys(general)) {
      // Free-form display text is never copied to security audit records.
      (before.general ||= {})[key] = '[REDACTED]';
      (after.general ||= {})[key] = '[REDACTED]';
    }
    for (const [key, value] of Object.entries(policies)) {
      before[key] = policyValues(organization)[key];
      after[key] = value;
      patch[`governance.policies.${key}`] = value;
    }
    if (preferences && payload.dashboardConfig !== undefined) {
      const config = payload.dashboardConfig;
      const booleans = [
        'showKpiCards',
        'showTeamAnalytics',
        'showRecruiterPerformance',
        'showJobTrends',
        'showActivityFeed'
      ];
      keysOnly(config, ['preferredDateRangeDays', 'defaultTeamId', ...booleans]);
      if (
        config.preferredDateRangeDays !== undefined &&
        ![7, 14, 30, 60, 90].includes(config.preferredDateRangeDays)
      )
        throw fail(400, 'preferredDateRangeDays is invalid.');
      for (const key of booleans)
        if (config[key] !== undefined && typeof config[key] !== 'boolean')
          throw fail(400, `${key} must be a boolean.`);
      if (config.defaultTeamId) {
        if (
          typeof config.defaultTeamId !== 'string' ||
          !/^[a-f\d]{24}$/i.test(config.defaultTeamId)
        )
          throw fail(400, 'defaultTeamId is invalid.');
        if (
          !(await Team.exists({
            _id: config.defaultTeamId,
            organizationId: organization._id
          }).session(session))
        )
          throw fail(400, 'Default team must belong to this organization.');
      }
      if (
        config.defaultTeamId !== undefined &&
        config.defaultTeamId !== null &&
        typeof config.defaultTeamId !== 'string'
      )
        throw fail(400, 'defaultTeamId is invalid.');
      for (const [key, value] of Object.entries(config))
        patch[`dashboardConfig.${key}`] = key === 'defaultTeamId' ? value || null : value;
      before.dashboardConfig = '[REDACTED]';
      after.dashboardConfig = '[REDACTED]';
    }
    const updated = await Organization.findByIdAndUpdate(
      organization._id,
      { $set: patch, $inc: { 'governance.version': 1 } },
      { session, returnDocument: 'after', runValidators: true }
    ).lean();
    await AuditLog.create(
      [
        {
          actor: scope.actorId,
          organizationId: organization._id,
          action: 'ORGANIZATION_CONFIGURATION_UPDATED',
          method: 'PATCH',
          route: preferences ? '/api/admin-console/preferences' : '/api/admin-console/governance',
          before: { version: payload.expectedVersion, values: before },
          after: { version: payload.expectedVersion + 1, values: after },
          statusCode: 200,
          timestamp: new Date()
        }
      ],
      { session }
    );
    return updated;
  });
}

async function getDirectory(scope) {
  return withGovernance(scope, async ({ organization, session }) => {
    const memberships = await Membership.find({ organizationId: organization._id })
      .session(session)
      .lean();
    const users = await User.find({
      $or: [
        { _id: { $in: [...memberships.map((row) => row.userId), organization.ownerId] } },
        { organizationId: organization._id, role: { $in: ['admin', 'recruiter'] } }
      ]
    })
      .select('_id name email role isActive')
      .session(session)
      .lean();
    const teams = await Team.find({ organizationId: organization._id })
      .select('_id name isActive')
      .session(session)
      .lean();
    const byTeam = new Map(teams.map((team) => [String(team._id), team]));
    return {
      members: users.map((user) => ({
        ...user,
        accountRole: user.role,
        isActive: user.isActive !== false,
        isOwner: String(user._id) === String(organization.ownerId),
        organizationMembership:
          memberships
            .filter((row) => String(row.userId) === String(user._id) && !row.teamId)
            .map(({ _id, role, status }) => ({ _id, role, status }))[0] || null,
        teams: memberships
          .filter((row) => String(row.userId) === String(user._id) && row.teamId)
          .map(({ _id, teamId, role, status }) => ({
            _id,
            teamId,
            role,
            status,
            name: byTeam.get(String(teamId))?.name || '',
            isActive: byTeam.get(String(teamId))?.isActive === true
          }))
      })),
      total: users.length,
      publicDevelopersIncluded: false
    };
  });
}

async function getInvitations(scope, status) {
  if (status !== undefined && !['pending', 'accepted', 'expired', 'revoked'].includes(status))
    throw fail(400, 'Invalid invitation status.');
  return withGovernance(scope, async ({ organization, session }) => {
    const invitations = await Invitation.find({ organizationId: organization._id })
      .select(
        '_id name email role teamId invitedBy acceptedBy status expiresAt createdAt updatedAt'
      )
      .sort({ createdAt: -1 })
      .session(session)
      .lean();
    const now = Date.now();
    return {
      invitations: invitations
        .map((row) => ({
          ...row,
          status: row.status === 'pending' && +row.expiresAt <= now ? 'expired' : row.status
        }))
        .filter((row) => !status || row.status === status)
    };
  });
}

async function getCapabilities(scope) {
  return withGovernance(
    scope,
    async ({ organization, actor, organizationRole, session }) => {
      const settings = await platformInSession(session);
      const policies = policyValues(organization);
      const recruiter = actor.role === 'recruiter';
      const manager = ['admin', 'manager'].includes(organizationRole);
      const capabilities = {};
      for (const id of Object.keys(POLICY_CATALOG)) {
        let reason = null;
        const roleAllowed =
          id === 'invitationCreation' || id === 'managerTeamAdministration'
            ? manager || actor.role === 'admin'
            : recruiter;
        if (!roleAllowed) reason = 'role_or_ownership';
        else if (recruiter && settings.recruiter?.enableRecruiterAccess === false)
          reason = 'platform_policy';
        else if (
          id === 'candidateMatching' &&
          ['private', 'disabled', 'none', 'off'].includes(
            String(settings.recruiter?.candidateVisibility || 'public').toLowerCase()
          )
        )
          reason = 'platform_policy';
        else if (
          !policies[id] &&
          !(
            id === 'managerTeamAdministration' &&
            (organizationRole === 'admin' || actor.role === 'admin')
          )
        )
          reason = 'organization_policy';
        capabilities[id] = {
          allowed: !reason,
          reason,
          resourceChecksRequired: ![
            'recruiterJobCreation',
            'invitationCreation',
            'managerTeamAdministration'
          ].includes(id)
        };
      }
      return { version: Number(organization.governance?.version || 0), capabilities };
    },
    false
  );
}

module.exports = {
  getGovernance,
  updateGovernance,
  getDirectory,
  getInvitations,
  getCapabilities,
  configurationView,
  platformInSession,
  organizationPolicyInSession,
  actorInSession,
  withGovernance,
  fail,
  restrictionError
};
