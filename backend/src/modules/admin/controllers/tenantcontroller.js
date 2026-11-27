const governance = require('../services/organizationGovernanceService');
const { assertPolicy } = require('../config/organizationPolicies');
const crypto = require('node:crypto');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const developerContext = require('../../../core/developer-context/developerContextService');
const Organization = require('../models/organization');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Invitation = require('../models/invitation');
const User = require('../../auth/models/user');
const Analysis = require('../../skill-gap/models/analysis');
const AnalysisCache = require('../../skill-gap/models/analysisCache');
const Job = require('../../recruiter/models/Job');
const RecruiterMatch = require('../../recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../../recruiter/models/RecruiterShortlist');
const {
  sendInvitationEmail,
  buildInvitationPayload,
  getEmailProviderStatus
} = require('../../../core/messaging/invitationEmailService');
const { enqueueInvitationRetry } = require('../../../core/messaging/emailRetryQueueService');
const { logEmailDeliveryAudit } = require('../../../core/messaging/emailAuditService');
const {
  normalizeSlug,
  canManageRole,
  resolveOrganizationRole
} = require('../services/tenantService');
const {
  isDuplicateOrganizationTeamSlug,
  withOrganizationTeamCapacity,
  withOrganizationCapacityFence
} = require('../services/teamCapacityService');
const {
  getOrganizationSettingsSync
} = require('../../super-admin/services/platformSettingsService');
const {
  validatePasswordAgainstPolicy,
  getSecurityPolicy
} = require('../../auth/utils/passwordPolicy');

const {
  claimInvitation,
  assertRecipient,
  assertRecruiterCapacity,
  acceptMembership,
  invitationError
} = require('../services/invitationAcceptanceService');

const ORGANIZATION_ROLES = ['admin', 'manager', 'member'];
const getTokenTtl = () => String(getSecurityPolicy().jwtExpiresIn || '20h');

const validate = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({
    message: 'Validation failed.',
    errors: errors.array().map((e) => ({ field: e.path, message: e.msg }))
  });
};

const roleRank = { member: 1, manager: 2, admin: 3 };
const higherRole = (a, b) => (roleRank[a] >= roleRank[b] ? a : b);
const generateAuthToken = (user) =>
  require('../../auth/utils/authSessionToken').sign(user, getTokenTtl());

const loadValidPendingInvitationByToken = async (token) => {
  const invitation = await Invitation.findOne({ token }).lean();
  if (!invitation) {
    return { error: { status: 404, message: 'Invitation not found.' } };
  }

  if (invitation.status !== 'pending') {
    return { error: { status: 400, message: 'Invitation is no longer pending.' } };
  }

  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    return { error: { status: 400, message: 'Invitation has expired.' } };
  }

  return { invitation };
};

const createOrganizationValidators = [
  body('name')
    .isString()
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('name must be 2-80 characters long.'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('description can be up to 500 characters.')
];

const createOrganization = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const organizationSettings = getOrganizationSettingsSync();
    if (organizationSettings.allowOrgCreation === false) {
      return res
        .status(403)
        .json({ message: 'Organization creation is disabled by Super Admin settings.' });
    }

    const name = req.body.name.trim();
    const slug = normalizeSlug(req.body.slug || name);
    if (!slug) {
      return res.status(400).json({ message: 'Unable to generate organization slug from name.' });
    }

    const existing = await Organization.findOne({ slug }).lean();
    if (existing) {
      return res
        .status(409)
        .json({ message: 'Organization slug already exists. Try another name.' });
    }

    const { organization, membership } = await User.db.transaction(async (session) => {
      const [organization] = await Organization.create(
        [
          {
            name,
            slug,
            description: String(req.body.description || '').trim(),
            ownerId: req.user._id,
            createdBy: req.user._id
          }
        ],
        { session }
      );
      const account = await User.updateOne(
        {
          _id: req.user._id,
          role: { $ne: 'super_admin' },
          isActive: { $ne: false },
          organizationId: null
        },
        { $set: { role: 'admin', organizationId: organization._id } },
        { session }
      );
      if (!account.matchedCount)
        throw invitationError(409, 'This account cannot create another organization.');
      const [membership] = await Membership.create(
        [
          {
            organizationId: organization._id,
            teamId: null,
            userId: req.user._id,
            role: 'admin',
            status: 'active',
            invitedBy: req.user._id
          }
        ],
        { session }
      );
      return { organization, membership };
    });

    return res.status(201).json({
      organization,
      membership
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.slug) {
      return res
        .status(409)
        .json({ message: 'Organization slug already exists. Try another name.' });
    }
    if (error.statusCode)
      return res
        .status(error.statusCode)
        .json({ message: error.message, restriction: error.restriction });
    console.error('Create organization error:', error.message);
    return res.status(500).json({ message: 'Failed to create organization.' });
  }
};

const listOrganizations = async (req, res) => {
  try {
    const memberships = await Membership.find({
      userId: req.user._id,
      status: 'active'
    })
      .select('organizationId role teamId')
      .lean();

    const roleMap = new Map();
    memberships.forEach((item) => {
      const key = String(item.organizationId);
      const existing = roleMap.get(key);
      roleMap.set(key, existing ? higherRole(existing, item.role) : item.role);
    });

    const organizationIds = Array.from(roleMap.keys());
    const organizations = await Organization.find({ _id: { $in: organizationIds } })
      .sort({ createdAt: -1 })
      .lean();

    const payload = organizations.map((org) => ({
      ...org,
      myRole: roleMap.get(String(org._id)) || 'member'
    }));

    return res.json({ organizations: payload });
  } catch (error) {
    console.error('List organizations error:', error.message);
    return res.status(500).json({ message: 'Failed to list organizations.' });
  }
};

const createTeamValidators = [
  param('organizationId').isMongoId().withMessage('organizationId is invalid.'),
  body('name')
    .isString()
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('name must be 2-80 characters long.'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('description can be up to 500 characters.')
];

const createTeam = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const organizationId = req.params.organizationId;
    const organizationSettings = getOrganizationSettingsSync();
    const name = req.body.name.trim();
    const slug = normalizeSlug(req.body.slug || name);

    const organization = await Organization.findById(organizationId).lean();
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    const existing = await Team.findOne({ organizationId, slug }).lean();
    if (existing) {
      return res.status(409).json({ message: 'Team slug already exists in this organization.' });
    }

    const team = await withOrganizationTeamCapacity({
      organizationId,
      limit: Number(organizationSettings.maxTeamsPerOrganization || 10),
      create: async (session) => {
        const organization = await Organization.findById(organizationId).session(session).lean();
        const { organizationRole } = await governance.actorInSession(
          { actorId: req.user._id, sessionRevision: Number(req.user.sessionRevision || 0) },
          organization,
          session
        );
        if (!['manager', 'admin'].includes(organizationRole))
          throw governance.fail(403, 'Team administration is unavailable.');
        if (organizationRole !== 'admin') assertPolicy(organization, 'managerTeamAdministration');
        const duplicate = await Team.findOne({ organizationId, slug }).session(session).lean();
        if (duplicate) {
          const error = new Error('Team slug already exists in this organization.');
          error.status = 409;
          throw error;
        }

        const [createdTeam] = await Team.create(
          [
            {
              organizationId,
              name,
              slug,
              description: String(req.body.description || '').trim(),
              createdBy: req.user._id
            }
          ],
          { session }
        );

        const creatorMembership = await Membership.findOne({
          organizationId,
          teamId: createdTeam._id,
          userId: req.user._id
        })
          .session(session)
          .lean();

        if (!creatorMembership) {
          await Membership.create(
            [
              {
                organizationId,
                teamId: createdTeam._id,
                userId: req.user._id,
                role: 'manager',
                status: 'active',
                invitedBy: req.user._id
              }
            ],
            { session }
          );
        }

        return createdTeam;
      }
    });

    return res.status(201).json({ team });
  } catch (error) {
    if (isDuplicateOrganizationTeamSlug(error)) {
      return res.status(409).json({ message: 'Team slug already exists in this organization.' });
    }
    if (error?.status) {
      return res
        .status(error.status)
        .json({ message: error.message, restriction: error.restriction });
    }
    console.error('Create team error:', error.message);
    return res.status(500).json({ message: 'Failed to create team.' });
  }
};

const listTeamsValidators = [
  param('organizationId').isMongoId().withMessage('organizationId is invalid.')
];

const listTeams = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const teams = await Team.find({ organizationId: req.params.organizationId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ teams });
  } catch (error) {
    console.error('List teams error:', error.message);
    return res.status(500).json({ message: 'Failed to list teams.' });
  }
};

const inviteUserValidators = [
  param('organizationId').isMongoId().withMessage('organizationId is invalid.'),
  body('email').isEmail().withMessage('Valid email is required.'),
  body('role').optional().isIn(ORGANIZATION_ROLES).withMessage('Invalid role.'),
  body('teamId').optional().isMongoId().withMessage('teamId is invalid.')
];

const inviteUser = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const organizationSettings = getOrganizationSettingsSync();
    const organizationId = req.params.organizationId;
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const role = String(req.body.role || 'member');
    const teamId = req.body.teamId || null;

    const actorRole = await resolveOrganizationRole(req.user._id, organizationId);
    if (!actorRole || !['admin', 'manager'].includes(actorRole)) {
      return res.status(403).json({ message: 'Only admin/manager can invite users.' });
    }

    if (!canManageRole(actorRole, role)) {
      return res.status(403).json({ message: `Role ${actorRole} cannot assign ${role}.` });
    }

    if (role === 'admin' && organizationSettings.adminInvitesRequireApproval) {
      return res.status(403).json({
        message:
          'Admin invitations currently require Super Admin approval and cannot be sent from organization management.'
      });
    }

    const organization = await Organization.findById(organizationId).select('name').lean();
    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    let teamName = '';
    if (teamId) {
      const team = await Team.findOne({ _id: teamId, organizationId }).select('name').lean();
      if (!team) {
        return res.status(404).json({ message: 'Team not found in organization.' });
      }
      teamName = team.name;
    }

    const emailProviderStatus = getEmailProviderStatus();

    const invitedUser = await User.findOne({ email }).select('_id').lean();
    if (invitedUser) {
      const existingMembership = await Membership.findOne({
        organizationId,
        teamId,
        userId: invitedUser._id,
        status: 'active'
      }).lean();

      if (existingMembership) {
        return res.status(409).json({ message: 'User already has active membership.' });
      }
    }

    const existingPending = await Invitation.findOne({
      organizationId,
      teamId,
      email,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).lean();

    if (existingPending) {
      return res
        .status(409)
        .json({ message: 'An active invitation already exists for this user.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await withOrganizationCapacityFence({
      organizationId,
      mutate: async (session) => {
        const organization = await governance.organizationPolicyInSession(
          organizationId,
          session,
          'invitationCreation'
        );
        await governance.actorInSession(
          { actorId: req.user._id, sessionRevision: Number(req.user.sessionRevision || 0) },
          organization,
          session
        );
        const actorRole = await resolveOrganizationRole(req.user._id, organizationId, session);
        if (!canManageRole(actorRole, role))
          throw invitationError(403, 'Invitation permission changed.');
        if (
          teamId &&
          !(await Team.exists({ _id: teamId, organizationId, isActive: { $ne: false } }).session(
            session
          ))
        ) {
          throw invitationError(404, 'Team not found in organization.');
        }
        if (
          await Invitation.exists({
            organizationId,
            teamId,
            email,
            status: 'pending',
            expiresAt: { $gt: new Date() }
          }).session(session)
        ) {
          throw invitationError(409, 'An active invitation already exists for this user.');
        }
        const [created] = await Invitation.create(
          [
            {
              organizationId,
              teamId,
              email,
              role,
              token,
              status: 'pending',
              invitedBy: req.user._id,
              expiresAt
            }
          ],
          { session }
        );
        return created.toObject();
      }
    });

    const emailPayload = buildInvitationPayload({
      to: email,
      token,
      organizationName: organization.name,
      teamName,
      role,
      inviterName: req.user?.name || '',
      organizationId,
      teamId,
      actorId: req.user._id
    });

    const frontendBaseUrl = String(process.env.FRONTEND_BASE_URL || '').replace(/\/+$/, '');
    const invitationLink = frontendBaseUrl
      ? `${frontendBaseUrl}/invitations/accept/${token}`
      : `/invitations/accept/${token}`;

    // If no email provider, return success with the invitation link for manual sharing
    if (!emailProviderStatus.configured) {
      return res.status(201).json({
        message:
          'Invitation created. No email provider configured — share the link below manually.',
        invitation: { ...invitation, token },
        invitationLink,
        emailDelivery: {
          sent: false,
          provider: null,
          reason: emailProviderStatus.reason,
          retryQueued: false
        }
      });
    }

    const emailResult = await sendInvitationEmail(emailPayload);

    await logEmailDeliveryAudit({
      actor: req.user._id,
      organizationId,
      teamId,
      invitationId: String(invitation._id),
      email,
      role,
      provider: emailResult.provider,
      result: emailResult,
      attemptType: 'initial',
      attemptNumber: 1
    });

    let retryQueued = false;
    if (!emailResult.sent && emailResult.provider && !emailResult.deliveryUncertain) {
      const queuedJob = await enqueueInvitationRetry({
        invitationId: invitation._id,
        to: email,
        payload: {
          ...emailPayload,
          invitationId: String(invitation._id)
        }
      });
      retryQueued = Boolean(queuedJob);
    }

    if (!emailResult.sent) {
      return res.status(502).json({
        message: emailResult.deliveryUncertain
          ? 'Invitation created. Confirm delivery before resending because the provider outcome is unknown.'
          : 'Invitation created but email delivery failed. Configure SENDGRID or SMTP environment variables and retry.',
        invitation,
        emailDelivery: {
          sent: false,
          provider: emailResult.provider,
          reason: emailResult.reason || null,
          retryQueued
        }
      });
    }

    return res.status(201).json({
      message: 'Invitation email sent successfully.',
      invitation,
      emailDelivery: {
        sent: true,
        provider: emailResult.provider,
        reason: null,
        retryQueued
      }
    });
  } catch (error) {
    if (error.statusCode)
      return res
        .status(error.statusCode)
        .json({ message: error.message, restriction: error.restriction });
    console.error('Invite user error:', error.message);
    return res.status(500).json({ message: 'Failed to invite user.' });
  }
};

const acceptInvitationValidators = [
  param('invitationId').isMongoId().withMessage('invitationId is invalid.')
];

const acceptInvitationTokenValidators = [
  param('token')
    .isString()
    .trim()
    .isLength({ min: 24, max: 128 })
    .withMessage('Invitation token is invalid.')
];

const invitationDetailsValidators = [
  param('token')
    .isString()
    .trim()
    .isLength({ min: 24, max: 128 })
    .withMessage('Invitation token is invalid.')
];

const acceptInvitationOnboardValidators = [
  param('token')
    .isString()
    .trim()
    .isLength({ min: 24, max: 128 })
    .withMessage('Invitation token is invalid.'),
  body('name')
    .isString()
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('name must be 2-80 characters long.'),
  body('password').isString().isLength({ min: 1, max: 128 }).withMessage('password is required.'),
  body('githubUsername')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 60 })
    .withMessage('githubUsername must be 2-60 characters long.')
];

const acceptAuthenticatedInvitation = (byToken) => async (req, res) => {
  if (validate(req, res)) return;
  try {
    const selector = byToken ? { token: req.params.token } : { _id: req.params.invitationId };
    if (!(await Invitation.exists(selector))) {
      return res.status(404).json({ message: 'Invitation not found.' });
    }
    const { invitation, membership } = await User.db.transaction(async (session) => {
      const invitation = await claimInvitation({ selector, session });
      const account = await User.findById(req.user._id).session(session);
      await assertRecipient({ account, invitation, session });
      if (Number(account.sessionRevision || 0) !== Number(req.user.sessionRevision || 0)) {
        throw invitationError(401, 'Session is no longer valid.');
      }
      if (invitation.role === 'recruiter') {
        await assertRecruiterCapacity(invitation, account, session);
        if (account.role !== 'recruiter')
          account.sessionRevision = Number(account.sessionRevision || 0) + 1;
        account.role = 'recruiter';
      }
      account.organizationId = invitation.organizationId;
      await account.save({ session });
      return { invitation, membership: await acceptMembership(invitation, account._id, session) };
    });
    return res.json({
      message: 'Invitation accepted.',
      membership,
      ...(byToken ? { organizationId: invitation.organizationId, teamId: invitation.teamId } : {})
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to accept invitation.'
    });
  }
};

const acceptInvitation = acceptAuthenticatedInvitation(false);
const acceptInvitationByToken = acceptAuthenticatedInvitation(true);

const getInvitationDetailsByToken = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const token = String(req.params.token || '').trim();
    const loaded = await loadValidPendingInvitationByToken(token);
    if (loaded.error) {
      return res.status(loaded.error.status).json({ message: loaded.error.message });
    }
    const invitation = loaded.invitation;

    const [organization, team, existingUser] = await Promise.all([
      Organization.findById(invitation.organizationId).select('name').lean(),
      invitation.teamId ? Team.findById(invitation.teamId).select('name').lean() : null,
      User.findOne({ email: invitation.email }).select('_id').lean()
    ]);

    return res.json({
      invitation: {
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        organizationName: organization?.name || 'Organization',
        teamName: team?.name || '',
        hasExistingAccount: Boolean(existingUser)
      }
    });
  } catch (error) {
    console.error('Get invitation details error:', error.message);
    return res.status(500).json({ message: 'Failed to load invitation details.' });
  }
};

const acceptInvitationOnboard = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const token = String(req.params.token || '').trim();
    const loaded = await loadValidPendingInvitationByToken(token);
    if (loaded.error) {
      return res.status(loaded.error.status).json({ message: loaded.error.message });
    }

    const invitation = loaded.invitation;
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    const fallbackGithub = String(invitation.email || '').split('@')[0] || 'developer';
    const githubUsername = String(req.body.githubUsername || fallbackGithub).trim();
    const passwordPolicy = validatePasswordAgainstPolicy(password);

    if (!passwordPolicy.valid) {
      return res.status(400).json({ message: passwordPolicy.message });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { user, membership } = await User.db.transaction(async (session) => {
      const claimed = await claimInvitation({
        selector: { _id: invitation._id, token, role: { $in: ORGANIZATION_ROLES } },
        session
      });
      const email = claimed.email.trim().toLowerCase();
      if (await User.exists({ email }).collation({ locale: 'en', strength: 2 }).session(session)) {
        throw invitationError(409, 'Sign in to accept this invitation with your existing account.');
      }
      const [user] = await User.create(
        [
          {
            name,
            email,
            organizationId: claimed.organizationId,
            password: hashedPassword,
            githubUsername,
            activeGithubUsername: githubUsername,
            activeCareerStack: 'Full Stack',
            activeExperienceLevel: 'Student'
          }
        ],
        { session }
      );
      return { user, membership: await acceptMembership(claimed, user._id, session) };
    });

    return res.json({
      message: 'Invitation accepted and account ready.',
      membership,
      organizationId: invitation.organizationId,
      teamId: invitation.teamId,
      user: {
        _id: user.id,
        name: user.name,
        email: user.email,
        githubUsername: user.githubUsername,
        activeGithubUsername: developerContext.resolveGithubUsername(user) || '',
        careerStack: user.careerStack,
        experienceLevel: user.experienceLevel,
        activeCareerStack: developerContext.resolveCareerStack(user),
        activeExperienceLevel: developerContext.resolveExperienceLevel(user),
        token: generateAuthToken(user)
      }
    });
  } catch (error) {
    if (error.code === 11000)
      return res
        .status(409)
        .json({ message: 'Sign in to accept this invitation with your existing account.' });
    return res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Failed to complete invitation onboarding.'
    });
  }
};

const listOrganizationMembersValidators = [
  param('organizationId').isMongoId().withMessage('organizationId is invalid.')
];

const listOrganizationMembers = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const organizationId = req.params.organizationId;

    const [memberships, teams] = await Promise.all([
      Membership.find({ organizationId, status: 'active' })
        .populate('userId', 'name email githubUsername')
        .lean(),
      Team.find({ organizationId }).select('_id name slug').lean()
    ]);

    const teamMap = new Map(teams.map((t) => [String(t._id), t]));
    const userMap = new Map();

    memberships.forEach((membership) => {
      const user = membership.userId;
      if (!user?._id) return;
      const userId = String(user._id);
      const current = userMap.get(userId) || {
        user,
        orgRole: 'member',
        organizationMembershipId: null,
        memberships: []
      };

      if (membership.teamId) {
        const team = teamMap.get(String(membership.teamId));
        current.memberships.push({
          membershipId: membership._id,
          teamId: membership.teamId,
          teamName: team?.name || 'Unknown Team',
          role: membership.role
        });
        current.orgRole = higherRole(current.orgRole, membership.role);
      } else {
        current.orgRole = higherRole(current.orgRole, membership.role);
        current.organizationMembershipId = membership._id;
      }

      userMap.set(userId, current);
    });

    return res.json({ members: Array.from(userMap.values()) });
  } catch (error) {
    console.error('List organization members error:', error.message);
    return res.status(500).json({ message: 'Failed to list organization members.' });
  }
};

const listTeamMembersValidators = [param('teamId').isMongoId().withMessage('teamId is invalid.')];

const listTeamMembers = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const members = await Membership.find({
      teamId: req.params.teamId,
      status: 'active'
    })
      .populate('userId', 'name email githubUsername')
      .sort({ role: 1, createdAt: 1 })
      .lean();

    return res.json({ members });
  } catch (error) {
    console.error('List team members error:', error.message);
    return res.status(500).json({ message: 'Failed to list team members.' });
  }
};

const updateMembershipRoleValidators = [
  param('membershipId').isMongoId().withMessage('membershipId is invalid.'),
  body('role').isIn(ORGANIZATION_ROLES).withMessage('Invalid role.')
];

const updateMembershipRole = async (req, res) => {
  if (validate(req, res)) return;
  try {
    const initial = await Membership.findById(req.params.membershipId)
      .select('organizationId')
      .lean();
    if (!initial) return res.status(404).json({ message: 'Membership not found.' });
    const membership = await governance.withGovernance(
      {
        actorId: req.user._id,
        organizationId: initial.organizationId,
        sessionRevision: Number(req.user.sessionRevision || 0)
      },
      async ({ organization, organizationRole, session }) => {
        if (!['admin', 'manager'].includes(organizationRole))
          throw governance.fail(403, 'Only admin/manager can assign roles.');
        if (organizationRole !== 'admin') assertPolicy(organization, 'managerTeamAdministration');
        const current = await Membership.findOne({
          _id: req.params.membershipId,
          organizationId: organization._id
        })
          .session(session)
          .lean();
        if (!current) throw governance.fail(404, 'Membership not found.');
        const targetRole = String(req.body.role);
        if (
          !canManageRole(organizationRole, targetRole) ||
          !canManageRole(organizationRole, current.role)
        )
          throw governance.fail(403, 'Membership role assignment is unavailable.');
        if (!current.teamId && current.role === 'admin' && targetRole !== 'admin') {
          const count = await Membership.countDocuments({
            organizationId: organization._id,
            teamId: null,
            role: 'admin',
            status: 'active'
          }).session(session);
          if (count <= 1) throw governance.fail(400, 'Cannot remove the last organization admin.');
        }
        return Membership.findByIdAndUpdate(
          current._id,
          { $set: { role: targetRole } },
          { session, returnDocument: 'after', runValidators: true }
        ).lean();
      },
      false
    );
    return res.json({ membership });
  } catch (error) {
    return res
      .status(error.statusCode || error.status || 500)
      .json({ message: error.message, restriction: error.restriction });
  }
};

const listPendingInvitationsValidators = [
  param('organizationId').isMongoId().withMessage('organizationId is invalid.')
];

const revokeInvitationValidators = [
  param('organizationId').isMongoId().withMessage('organizationId is invalid.'),
  param('invitationId').isMongoId().withMessage('invitationId is invalid.')
];

const listPendingInvitations = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const invitations = await Invitation.find({
      organizationId: req.params.organizationId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ invitations });
  } catch (error) {
    console.error('List invitations error:', error.message);
    return res.status(500).json({ message: 'Failed to list invitations.' });
  }
};

const revokeInvitation = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const { organizationId, invitationId } = req.params;
    const actorRole = await resolveOrganizationRole(req.user._id, organizationId);
    if (!actorRole || !['admin', 'manager'].includes(actorRole)) {
      return res.status(403).json({ message: 'Only admin/manager can revoke invitations.' });
    }

    const invitation = await Invitation.findOne({ _id: invitationId, organizationId }).lean();
    if (!invitation) {
      return res.status(404).json({ message: 'Invitation not found.' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending invitations can be revoked.' });
    }

    if (!canManageRole(actorRole, invitation.role)) {
      return res
        .status(403)
        .json({ message: `Role ${actorRole} cannot revoke ${invitation.role} invitation.` });
    }

    const revoked = await Invitation.findOneAndUpdate(
      {
        _id: invitation._id,
        organizationId,
        status: 'pending'
      },
      { $set: { status: 'revoked' } },
      { returnDocument: 'after' }
    ).lean();
    if (!revoked) return res.status(409).json({ message: 'Invitation is no longer pending.' });

    return res.json({
      message: 'Invitation revoked successfully.',
      invitation: revoked
    });
  } catch (error) {
    console.error('Revoke invitation error:', error.message);
    return res.status(500).json({ message: 'Failed to revoke invitation.' });
  }
};

const getTeamSharedDashboardValidators = [
  param('teamId').isMongoId().withMessage('teamId is invalid.')
];

const getTeamSharedDashboard = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const team = await Team.findById(req.params.teamId).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    const memberships = await Membership.find({
      organizationId: team.organizationId,
      teamId: team._id,
      status: 'active'
    })
      .populate('userId', 'name email githubUsername')
      .lean();

    const userIds = memberships.map((m) => m.userId?._id).filter(Boolean);
    const [analyses, cachedScores] = await Promise.all([
      Analysis.find({ userId: { $in: userIds } }).lean(),
      AnalysisCache.find({
        userId: { $in: userIds },
        'analysisData.portfolioScore.overallScore': { $exists: true }
      })
        .sort({ updatedAt: -1 })
        .lean()
    ]);

    const analysisMap = new Map(analyses.map((a) => [String(a.userId), a]));
    const scoreMap = new Map();
    cachedScores.forEach((entry) => {
      const key = String(entry.userId);
      if (!scoreMap.has(key)) {
        scoreMap.set(key, Number(entry.analysisData?.portfolioScore?.overallScore || 0));
      }
    });

    const members = memberships.map((membership) => {
      const user = membership.userId;
      const analysis = analysisMap.get(String(user._id));
      return {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          githubUsername: user.githubUsername
        },
        role: membership.role,
        githubScore: Number(analysis?.githubScore || 0),
        readinessScore: Number(
          scoreMap.get(String(user._id)) || analysis?.readinessScore || analysis?.githubScore || 0
        ),
        repositories: Number(analysis?.githubStats?.repos || 0),
        stars: Number(analysis?.githubStats?.stars || 0),
        forks: Number(analysis?.githubStats?.forks || 0),
        missingSkills: Array.isArray(analysis?.missingSkills)
          ? analysis.missingSkills.slice(0, 6)
          : []
      };
    });

    return res.json({
      team: {
        _id: team._id,
        name: team.name,
        slug: team.slug,
        organizationId: team.organizationId
      },
      members
    });
  } catch (error) {
    console.error('Team shared dashboard error:', error.message);
    return res.status(500).json({ message: 'Failed to load team shared dashboard.' });
  }
};

const getTeamAnalyticsValidators = [param('teamId').isMongoId().withMessage('teamId is invalid.')];

const getTeamAnalytics = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const team = await Team.findById(req.params.teamId).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    const memberships = await Membership.find({ teamId: team._id, status: 'active' }).lean();
    const userIds = memberships.map((m) => m.userId);

    const [analyses, openJobs, recruiterMatches, shortlists] = await Promise.all([
      Analysis.find({ userId: { $in: userIds } }).lean(),
      Job.find({ teamId: team._id, status: 'open', archivedAt: null }).lean(),
      RecruiterMatch.find({ teamId: team._id }).sort({ updatedAt: -1 }).limit(100).lean(),
      RecruiterShortlist.find({ teamId: team._id, applicationId: null })
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean()
    ]);

    let totalRepos = 0;
    let totalStars = 0;
    let totalForks = 0;
    let readinessCount = 0;
    let readinessSum = 0;

    const roleDistribution = { admin: 0, manager: 0, member: 0 };
    const missingSkillCounter = new Map();

    memberships.forEach((m) => {
      roleDistribution[m.role] = (roleDistribution[m.role] || 0) + 1;
    });

    analyses.forEach((analysis) => {
      totalRepos += Number(analysis?.githubStats?.repos || 0);
      totalStars += Number(analysis?.githubStats?.stars || 0);
      totalForks += Number(analysis?.githubStats?.forks || 0);

      const readiness = Number(analysis?.readinessScore || analysis?.githubScore || 0);
      if (readiness > 0) {
        readinessCount += 1;
        readinessSum += readiness;
      }

      const missingSkills = Array.isArray(analysis?.missingSkills) ? analysis.missingSkills : [];
      missingSkills.forEach((skill) => {
        const key = String(skill || '').trim();
        if (!key) return;
        missingSkillCounter.set(key, (missingSkillCounter.get(key) || 0) + 1);
      });
    });

    const topMissingSkills = Array.from(missingSkillCounter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([skill, count]) => ({ skill, count }));

    const averageReadinessScore =
      readinessCount > 0 ? Math.round(readinessSum / readinessCount) : 0;
    const teamActivity = Math.round(
      Math.min(
        100,
        (analyses.length / Math.max(memberships.length, 1)) * 55 + Math.min(totalRepos, 45)
      )
    );
    const recruiterEngagement = Math.round(
      Math.min(100, recruiterMatches.length * 4 + shortlists.length * 6)
    );
    const hiringPerformance = Math.round(
      Math.min(
        100,
        openJobs.length * 12 +
          shortlists.filter((item) => ['contacted', 'interview'].includes(item.status)).length * 10
      )
    );

    return res.json({
      teamId: team._id,
      teamName: team.name,
      totalMembers: memberships.length,
      roleDistribution,
      averageReadinessScore,
      teamScore: Math.round(
        averageReadinessScore * 0.55 +
          teamActivity * 0.2 +
          recruiterEngagement * 0.15 +
          hiringPerformance * 0.1
      ),
      teamActivity,
      recruiterEngagement,
      hiringPerformance,
      totals: {
        repositories: totalRepos,
        stars: totalStars,
        forks: totalForks,
        openJobs: openJobs.length,
        recruiterMatches: recruiterMatches.length,
        shortlists: shortlists.length
      },
      topMissingSkills
    });
  } catch (error) {
    console.error('Team analytics error:', error.message);
    return res.status(500).json({ message: 'Failed to load team analytics.' });
  }
};

module.exports = {
  createOrganizationValidators,
  createOrganization,
  listOrganizations,
  createTeamValidators,
  createTeam,
  listTeamsValidators,
  listTeams,
  inviteUserValidators,
  inviteUser,
  acceptInvitationValidators,
  acceptInvitation,
  acceptInvitationTokenValidators,
  acceptInvitationByToken,
  invitationDetailsValidators,
  getInvitationDetailsByToken,
  acceptInvitationOnboardValidators,
  acceptInvitationOnboard,
  listOrganizationMembersValidators,
  listOrganizationMembers,
  listTeamMembersValidators,
  listTeamMembers,
  updateMembershipRoleValidators,
  updateMembershipRole,
  listPendingInvitationsValidators,
  listPendingInvitations,
  revokeInvitationValidators,
  revokeInvitation,
  getTeamSharedDashboardValidators,
  getTeamSharedDashboard,
  getTeamAnalyticsValidators,
  getTeamAnalytics
};
