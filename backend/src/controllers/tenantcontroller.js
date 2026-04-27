const crypto = require('node:crypto');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const Organization = require('../models/organization');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Invitation = require('../models/invitation');
const User = require('../models/user');
const Analysis = require('../models/analysis');
const AnalysisCache = require('../models/analysisCache');
const { sendInvitationEmail, buildInvitationPayload, getEmailProviderStatus } = require('../services/invitationEmailService');
const { enqueueInvitationRetry } = require('../services/emailRetryQueueService');
const { logEmailDeliveryAudit } = require('../services/emailAuditService');
const {
  normalizeSlug,
  canManageRole,
  resolveOrganizationRole
} = require('../services/tenantService');

const ORGANIZATION_ROLES = ['admin', 'manager', 'member'];
const TOKEN_TTL = '20h';

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
const generateAuthToken = (id) => jwt.sign(
  { id },
  process.env.JWT_SECRET,
  {
    expiresIn: TOKEN_TTL,
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  }
);

const loadValidPendingInvitationByToken = async (token) => {
  const invitation = await Invitation.findOne({ token }).lean();
  if (!invitation) {
    return { error: { status: 404, message: 'Invitation not found.' } };
  }

  if (invitation.status !== 'pending') {
    return { error: { status: 400, message: 'Invitation is no longer pending.' } };
  }

  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    await Invitation.findByIdAndUpdate(invitation._id, { status: 'expired' });
    return { error: { status: 400, message: 'Invitation has expired.' } };
  }

  return { invitation };
};

const createOrganizationValidators = [
  body('name').isString().trim().isLength({ min: 2, max: 80 }).withMessage('name must be 2-80 characters long.'),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('description can be up to 500 characters.')
];

const createOrganization = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const name = req.body.name.trim();
    const slug = normalizeSlug(req.body.slug || name);
    if (!slug) {
      return res.status(400).json({ message: 'Unable to generate organization slug from name.' });
    }

    const existing = await Organization.findOne({ slug }).lean();
    if (existing) {
      return res.status(409).json({ message: 'Organization slug already exists. Try another name.' });
    }

    const organization = await Organization.create({
      name,
      slug,
      description: String(req.body.description || '').trim(),
      ownerId: req.user._id,
      createdBy: req.user._id
    });

    const membership = await Membership.create({
      organizationId: organization._id,
      teamId: null,
      userId: req.user._id,
      role: 'admin',
      status: 'active',
      invitedBy: req.user._id
    });

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        role: 'admin',
        organizationId: organization._id
      }
    });

    return res.status(201).json({
      organization,
      membership
    });
  } catch (error) {
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
  body('name').isString().trim().isLength({ min: 2, max: 80 }).withMessage('name must be 2-80 characters long.'),
  body('description').optional().isString().isLength({ max: 500 }).withMessage('description can be up to 500 characters.')
];

const createTeam = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const organizationId = req.params.organizationId;
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

    const team = await Team.create({
      organizationId,
      name,
      slug,
      description: String(req.body.description || '').trim(),
      createdBy: req.user._id
    });

    const creatorMembership = await Membership.findOne({
      organizationId,
      teamId: team._id,
      userId: req.user._id
    }).lean();

    if (!creatorMembership) {
      await Membership.create({
        organizationId,
        teamId: team._id,
        userId: req.user._id,
        role: 'manager',
        status: 'active',
        invitedBy: req.user._id
      });
    }

    return res.status(201).json({ team });
  } catch (error) {
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
    const teams = await Team.find({ organizationId: req.params.organizationId })
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
    const organizationId = req.params.organizationId;
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || 'member');
    const teamId = req.body.teamId || null;

    const actorRole = await resolveOrganizationRole(req.user._id, organizationId);
    if (!actorRole || !['admin', 'manager'].includes(actorRole)) {
      return res.status(403).json({ message: 'Only admin/manager can invite users.' });
    }

    if (!canManageRole(actorRole, role)) {
      return res.status(403).json({ message: `Role ${actorRole} cannot assign ${role}.` });
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
      return res.status(409).json({ message: 'An active invitation already exists for this user.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));

    const invitation = await Invitation.create({
      organizationId,
      teamId,
      email,
      role,
      token,
      status: 'pending',
      invitedBy: req.user._id,
      expiresAt
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

    const invitationLink = `${process.env.FRONTEND_BASE_URL || 'http://localhost:4200'}/invitations/accept/${token}`;

    // If no email provider, return success with the invitation link for manual sharing
    if (!emailProviderStatus.configured) {
      return res.status(201).json({
        message: 'Invitation created. No email provider configured — share the link below manually.',
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
    if (!emailResult.sent && emailResult.provider) {
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
        message: 'Invitation created but email delivery failed. Configure SENDGRID or SMTP environment variables and retry.',
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
    console.error('Invite user error:', error.message);
    return res.status(500).json({ message: 'Failed to invite user.' });
  }
};

const acceptInvitationValidators = [
  param('invitationId').isMongoId().withMessage('invitationId is invalid.')
];

const acceptInvitationTokenValidators = [
  param('token').isString().trim().isLength({ min: 24, max: 128 }).withMessage('Invitation token is invalid.')
];

const invitationDetailsValidators = [
  param('token').isString().trim().isLength({ min: 24, max: 128 }).withMessage('Invitation token is invalid.')
];

const acceptInvitationOnboardValidators = [
  param('token').isString().trim().isLength({ min: 24, max: 128 }).withMessage('Invitation token is invalid.'),
  body('name').isString().trim().isLength({ min: 2, max: 80 }).withMessage('name must be 2-80 characters long.'),
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('password must be 8-128 characters long.'),
  body('githubUsername').optional().isString().trim().isLength({ min: 2, max: 60 }).withMessage('githubUsername must be 2-60 characters long.')
];

const activateInvitationForUser = async ({ invitation, userId }) => {
  const membership = await Membership.findOneAndUpdate(
    {
      organizationId: invitation.organizationId,
      teamId: invitation.teamId,
      userId
    },
    {
      $set: {
        role: invitation.role,
        status: 'active',
        invitedBy: invitation.invitedBy,
        joinedAt: new Date()
      }
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true
    }
  );

  await Invitation.findByIdAndUpdate(invitation._id, {
    status: 'accepted',
    acceptedBy: userId
  });

  return membership;
};

const acceptInvitation = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const invitation = await Invitation.findById(req.params.invitationId).lean();
    if (!invitation) {
      return res.status(404).json({ message: 'Invitation not found.' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ message: 'Invitation is no longer pending.' });
    }

    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      await Invitation.findByIdAndUpdate(invitation._id, { status: 'expired' });
      return res.status(400).json({ message: 'Invitation has expired.' });
    }

    const me = await User.findById(req.user._id).select('email').lean();
    if (!me || String(me.email || '').toLowerCase() !== invitation.email) {
      return res.status(403).json({ message: 'Invitation email does not match the authenticated user.' });
    }

    const membership = await activateInvitationForUser({ invitation, userId: req.user._id });

    return res.json({
      message: 'Invitation accepted.',
      membership
    });
  } catch (error) {
    console.error('Accept invitation error:', error.message);
    return res.status(500).json({ message: 'Failed to accept invitation.' });
  }
};

const acceptInvitationByToken = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const token = String(req.params.token || '').trim();
    const loaded = await loadValidPendingInvitationByToken(token);
    if (loaded.error) {
      return res.status(loaded.error.status).json({ message: loaded.error.message });
    }
    const invitation = loaded.invitation;

    const me = await User.findById(req.user._id).select('email').lean();
    if (!me || String(me.email || '').toLowerCase() !== invitation.email) {
      return res.status(403).json({ message: 'Invitation email does not match the authenticated user.' });
    }

    const membership = await activateInvitationForUser({ invitation, userId: req.user._id });

    return res.json({
      message: 'Invitation accepted.',
      membership,
      organizationId: invitation.organizationId,
      teamId: invitation.teamId
    });
  } catch (error) {
    console.error('Accept invitation by token error:', error.message);
    return res.status(500).json({ message: 'Failed to accept invitation.' });
  }
};

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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let user = await User.findOne({ email: invitation.email });
    if (!user) {
      user = await User.create({
        name,
        email: invitation.email,
        password: hashedPassword,
        githubUsername,
        activeGithubUsername: githubUsername,
        activeCareerStack: 'Full Stack',
        activeExperienceLevel: 'Student'
      });
    } else {
      user.name = name || user.name;
      user.password = hashedPassword;
      if (!user.githubUsername) {
        user.githubUsername = githubUsername;
      }
      if (!user.activeGithubUsername) {
        user.activeGithubUsername = user.githubUsername;
      }
      await user.save();
    }

    const membership = await activateInvitationForUser({ invitation, userId: user._id });

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
        activeGithubUsername: user.activeGithubUsername || user.githubUsername,
        careerStack: user.careerStack,
        experienceLevel: user.experienceLevel,
        activeCareerStack: user.activeCareerStack || user.careerStack,
        activeExperienceLevel: user.activeExperienceLevel || user.experienceLevel,
        token: generateAuthToken(user._id)
      }
    });
  } catch (error) {
    console.error('Onboard invitation accept error:', error.message);
    return res.status(500).json({ message: 'Failed to complete invitation onboarding.' });
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

const listTeamMembersValidators = [
  param('teamId').isMongoId().withMessage('teamId is invalid.')
];

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
    const membership = await Membership.findById(req.params.membershipId).lean();
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found.' });
    }

    const actorRole = await resolveOrganizationRole(req.user._id, membership.organizationId);
    if (!actorRole || !['admin', 'manager'].includes(actorRole)) {
      return res.status(403).json({ message: 'Only admin/manager can assign roles.' });
    }

    const targetRole = String(req.body.role);
    if (!canManageRole(actorRole, targetRole)) {
      return res.status(403).json({ message: `Role ${actorRole} cannot assign ${targetRole}.` });
    }

    if (!canManageRole(actorRole, membership.role) && actorRole !== 'admin') {
      return res.status(403).json({ message: `Role ${actorRole} cannot modify ${membership.role}.` });
    }

    if (!membership.teamId && membership.role === 'admin' && targetRole !== 'admin') {
      const adminCount = await Membership.countDocuments({
        organizationId: membership.organizationId,
        teamId: null,
        role: 'admin',
        status: 'active'
      });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot remove the last organization admin.' });
      }
    }

    const updated = await Membership.findByIdAndUpdate(
      membership._id,
      { $set: { role: targetRole } },
      { returnDocument: 'after' }
    ).lean();

    return res.json({ membership: updated });
  } catch (error) {
    console.error('Update role error:', error.message);
    return res.status(500).json({ message: 'Failed to update member role.' });
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
      return res.status(403).json({ message: `Role ${actorRole} cannot revoke ${invitation.role} invitation.` });
    }

    const revoked = await Invitation.findByIdAndDelete(invitation._id).lean();

    return res.json({
      message: 'Invitation deleted successfully.',
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
        readinessScore: Number(scoreMap.get(String(user._id)) || analysis?.readinessScore || analysis?.githubScore || 0),
        repositories: Number(analysis?.githubStats?.repos || 0),
        stars: Number(analysis?.githubStats?.stars || 0),
        forks: Number(analysis?.githubStats?.forks || 0),
        missingSkills: Array.isArray(analysis?.missingSkills) ? analysis.missingSkills.slice(0, 6) : []
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

const getTeamAnalyticsValidators = [
  param('teamId').isMongoId().withMessage('teamId is invalid.')
];

const getTeamAnalytics = async (req, res) => {
  if (validate(req, res)) return;

  try {
    const team = await Team.findById(req.params.teamId).lean();
    if (!team) {
      return res.status(404).json({ message: 'Team not found.' });
    }

    const memberships = await Membership.find({ teamId: team._id, status: 'active' }).lean();
    const userIds = memberships.map((m) => m.userId);

    const analyses = await Analysis.find({ userId: { $in: userIds } }).lean();

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

    return res.json({
      teamId: team._id,
      teamName: team.name,
      totalMembers: memberships.length,
      roleDistribution,
      averageReadinessScore: readinessCount > 0 ? Math.round(readinessSum / readinessCount) : 0,
      totals: {
        repositories: totalRepos,
        stars: totalStars,
        forks: totalForks
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
