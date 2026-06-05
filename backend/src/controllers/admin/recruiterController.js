const crypto = require('node:crypto');

const bcrypt = require('bcryptjs');
const User = require('../../models/user');
const Invitation = require('../../models/invitation');
const Organization = require('../../models/organization');
const Team = require('../../models/team');
const Membership = require('../../models/membership');
const Job = require('../../models/Job');
const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const AuditLog = require('../../models/auditLog');
const { sendRecruiterInvitationEmail } = require('../../services/emailService');
const {
  getOrganizationSettingsSync,
  getRecruiterSettingsSync
} = require('../../services/platformSettingsService');
const { validatePasswordAgainstPolicy } = require('../../utils/passwordPolicy');

const INVITATION_TTL_DAYS = 7;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim();
const normalizeLinkedIn = (value) => String(value || '').trim();
const sanitizeText = (value) => String(value || '').trim();
const average = (values = []) => {
  const numeric = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (!numeric.length) return 0;
  return Math.round((numeric.reduce((sum, value) => sum + value, 0) / numeric.length) * 10) / 10;
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));
const formatAction = (value) => String(value || '')
  .trim()
  .replace(/^RECRUITER_/, '')
  .split('_')
  .filter(Boolean)
  .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
  .join(' ');
const buildRecruiterProfileCompleted = (user = {}) => {
  const hasName = Boolean(String(user.name || '').trim());
  const hasPhone = Boolean(normalizePhone(user.phoneNumber));
  const hasProfessionalLink = Boolean(String(user.githubUsername || '').trim() || normalizeLinkedIn(user.linkedin));
  const hasBasicInfo = Boolean(String(user.jobTitle || '').trim() || String(user.bio || '').trim());
  const hasBackground = Boolean(
    sanitizeText(user.recruiterDetails?.education) ||
    Number(user.recruiterDetails?.yearsOfExperience || 0) > 0 ||
    (Array.isArray(user.recruiterDetails?.certifications) && user.recruiterDetails.certifications.length > 0)
  );
  return hasName && hasPhone && hasProfessionalLink && hasBasicInfo && hasBackground;
};

const sanitizeRecruiter = (user, teams = [], organization = null, metrics = {}) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
  organization: organization || null,
  githubUsername: user.githubUsername || '',
  linkedin: user.linkedin || '',
  phoneNumber: user.phoneNumber || '',
  avatar: user.avatar || '',
  jobTitle: user.jobTitle || '',
  location: user.location || '',
  bio: user.bio || '',
  recruiterDetails: {
    education: sanitizeText(user.recruiterDetails?.education),
    certifications: Array.isArray(user.recruiterDetails?.certifications) ? user.recruiterDetails.certifications : [],
    yearsOfExperience: Number(user.recruiterDetails?.yearsOfExperience || 0),
    experienceSummary: sanitizeText(user.recruiterDetails?.experienceSummary),
    specialties: Array.isArray(user.recruiterDetails?.specialties) ? user.recruiterDetails.specialties : [],
    toolsAndPlatforms: Array.isArray(user.recruiterDetails?.toolsAndPlatforms) ? user.recruiterDetails.toolsAndPlatforms : [],
    languages: Array.isArray(user.recruiterDetails?.languages) ? user.recruiterDetails.languages : []
  },
  isActive: user.isActive !== false,
  profileCompleted: buildRecruiterProfileCompleted(user),
  teams,
  createdAt: user.createdAt,
  metrics: {
    profileCompletion: Number(metrics.profileCompletion || 0),
    jobsCreated: Number(metrics.jobsCreated || 0),
    activeJobs: Number(metrics.activeJobs || 0),
    matchesGenerated: Number(metrics.matchesGenerated || 0),
    candidatesAnalyzed: Number(metrics.candidatesAnalyzed || 0),
    aiUsageCount: Number(metrics.aiUsageCount || 0),
    shortlists: Number(metrics.shortlists || 0),
    activityScore: Number(metrics.activityScore || 0),
    recruiterScore: Number(metrics.recruiterScore || 0),
    hiringEffectiveness: Number(metrics.hiringEffectiveness || 0),
    teamContribution: Number(metrics.teamContribution || 0),
    lastActive: metrics.lastActive || null,
    recentActivity: Array.isArray(metrics.recentActivity) ? metrics.recentActivity : []
  }
});

const loadRecruiterTeams = async (organizationId, recruiterIds = []) => {
  if (!organizationId || recruiterIds.length === 0) {
    return new Map();
  }

  const memberships = await Membership.find({
    organizationId,
    userId: { $in: recruiterIds },
    status: 'active',
    teamId: { $ne: null }
  })
    .populate('teamId', 'name isActive')
    .lean();

  return memberships.reduce((map, membership) => {
    const userId = String(membership.userId || '');
    const team = membership.teamId ? {
      _id: membership.teamId._id,
      name: membership.teamId.name,
      isActive: membership.teamId.isActive !== false,
      role: membership.role || 'member'
    } : null;
    if (!userId || !team) {
      return map;
    }

    const current = map.get(userId) || [];
    const alreadyAdded = current.some((item) => String(item._id) === String(team._id));
    if (!alreadyAdded) {
      current.push(team);
      map.set(userId, current);
    }
    return map;
  }, new Map());
};

const buildRecruiterMetricsMap = async (organizationId, recruiters = [], teamMap = new Map()) => {
  const recruiterIds = recruiters.map((recruiter) => recruiter._id);
  if (!organizationId || recruiterIds.length === 0) {
    return new Map();
  }

  const [jobs, matches, shortlists, logs] = await Promise.all([
    Job.find({ organizationId, recruiterId: { $in: recruiterIds } })
      .select('_id recruiterId status createdAt updatedAt')
      .lean(),
    RecruiterMatch.find({ organizationId, recruiterId: { $in: recruiterIds } })
      .select('_id recruiterId status matchScore confidenceScore createdAt updatedAt')
      .lean(),
    RecruiterShortlist.find({ organizationId, recruiterId: { $in: recruiterIds } })
      .select('_id recruiterId status createdAt updatedAt')
      .lean(),
    AuditLog.find({ organizationId, actor: { $in: recruiterIds } })
      .select('_id actor action method route statusCode timestamp')
      .sort({ timestamp: -1 })
      .limit(Math.max(recruiterIds.length * 30, 120))
      .lean()
  ]);

  const jobsByRecruiter = new Map();
  const matchesByRecruiter = new Map();
  const shortlistsByRecruiter = new Map();
  const logsByRecruiter = new Map();

  jobs.forEach((job) => {
    const key = String(job.recruiterId || '');
    if (!key) return;
    const current = jobsByRecruiter.get(key) || [];
    current.push(job);
    jobsByRecruiter.set(key, current);
  });

  matches.forEach((match) => {
    const key = String(match.recruiterId || '');
    if (!key) return;
    const current = matchesByRecruiter.get(key) || [];
    current.push(match);
    matchesByRecruiter.set(key, current);
  });

  shortlists.forEach((entry) => {
    const key = String(entry.recruiterId || '');
    if (!key) return;
    const current = shortlistsByRecruiter.get(key) || [];
    current.push(entry);
    shortlistsByRecruiter.set(key, current);
  });

  logs.forEach((log) => {
    const key = String(log.actor || '');
    if (!key) return;
    const current = logsByRecruiter.get(key) || [];
    current.push(log);
    logsByRecruiter.set(key, current);
  });

  const maxJobs = Math.max(1, ...[...jobsByRecruiter.values()].map((items) => items.length));
  const maxMatches = Math.max(1, ...[...matchesByRecruiter.values()].map((items) => items.length));
  const maxAiUsage = Math.max(1, ...[...logsByRecruiter.values()].map((items) => items.filter((log) => /ANALYZED|MATCH/.test(String(log.action || ''))).length));

  return recruiters.reduce((map, recruiter) => {
    const recruiterId = String(recruiter._id || '');
    const recruiterJobs = jobsByRecruiter.get(recruiterId) || [];
    const recruiterMatches = matchesByRecruiter.get(recruiterId) || [];
    const recruiterShortlists = shortlistsByRecruiter.get(recruiterId) || [];
    const recruiterLogs = logsByRecruiter.get(recruiterId) || [];
    const viewedCount = recruiterLogs.filter((log) => log.action === 'RECRUITER_CANDIDATE_VIEWED').length;
    const analyzedCount = recruiterLogs.filter((log) => log.action === 'RECRUITER_CANDIDATE_ANALYZED').length;
    const aiUsageCount = recruiterLogs.filter((log) => /ANALYZED|MATCH/.test(String(log.action || ''))).length;
    const activeJobs = recruiterJobs.filter((job) => String(job.status || '') === 'open').length;
    const shortlistedCount = recruiterShortlists.length;
    const shortlistedMatches = recruiterMatches.filter((match) => String(match.status || '') === 'shortlisted').length;
    const activityScore = clamp(viewedCount * 2 + analyzedCount * 5 + recruiterJobs.length * 6 + recruiterMatches.length * 3 + shortlistedCount * 4);
    const hiringEffectiveness = recruiterMatches.length
      ? clamp(Math.round((shortlistedMatches / recruiterMatches.length) * 100))
      : 0;
    const recruiterScore = clamp(Math.round(average([
      activityScore,
      hiringEffectiveness,
      (recruiterJobs.length / maxJobs) * 100,
      (recruiterMatches.length / maxMatches) * 100,
      (aiUsageCount / maxAiUsage) * 100
    ])));
    const teamContribution = clamp(Math.round(average([
      recruiterJobs.length / maxJobs * 100,
      recruiterMatches.length / maxMatches * 100,
      activityScore
    ])));
    const profileCompletion = buildRecruiterProfileCompleted(recruiter) ? 100 : clamp(
      [
        Boolean(String(recruiter.name || '').trim()),
        Boolean(normalizePhone(recruiter.phoneNumber)),
        Boolean(String(recruiter.githubUsername || '').trim() || normalizeLinkedIn(recruiter.linkedin)),
        Boolean(String(recruiter.jobTitle || '').trim() || String(recruiter.bio || '').trim()),
        Boolean(
          sanitizeText(recruiter.recruiterDetails?.education) ||
          Number(recruiter.recruiterDetails?.yearsOfExperience || 0) > 0 ||
          (Array.isArray(recruiter.recruiterDetails?.certifications) && recruiter.recruiterDetails.certifications.length > 0)
        )
      ].filter(Boolean).length * 20
    );

    map.set(recruiterId, {
      profileCompletion,
      jobsCreated: recruiterJobs.length,
      activeJobs,
      matchesGenerated: recruiterMatches.length,
      candidatesAnalyzed: analyzedCount,
      aiUsageCount,
      shortlists: shortlistedCount,
      activityScore,
      recruiterScore,
      hiringEffectiveness,
      teamContribution,
      lastActive: recruiterLogs[0]?.timestamp || recruiter.updatedAt || recruiter.createdAt || null,
      recentActivity: recruiterLogs.slice(0, 8).map((log) => ({
        _id: log._id,
        action: log.action,
        actionLabel: formatAction(log.action),
        method: log.method,
        route: log.route,
        statusCode: log.statusCode,
        timestamp: log.timestamp
      })),
      teamCount: (teamMap.get(recruiterId) || []).length
    });

    return map;
  }, new Map());
};

const getRecruiters = async (req, res) => {
  try {
    const [organization, recruiters] = await Promise.all([
      Organization.findById(req.organizationId).select('_id name').lean(),
      User.find({
        role: 'recruiter',
        organizationId: req.organizationId
      })
        .select('_id name email role organizationId githubUsername linkedin phoneNumber avatar isActive jobTitle location bio recruiterDetails createdAt')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    const teamMap = await loadRecruiterTeams(req.organizationId, recruiters.map((recruiter) => recruiter._id));
    const metricsMap = await buildRecruiterMetricsMap(req.organizationId, recruiters, teamMap);
    const organizationPayload = organization?._id
      ? { _id: organization._id, name: organization.name || '' }
      : null;

    return res.status(200).json({
      recruiters: recruiters.map((recruiter) =>
        sanitizeRecruiter(
          recruiter,
          teamMap.get(String(recruiter._id)) || [],
          organizationPayload,
          metricsMap.get(String(recruiter._id)) || {}
        )
      )
    });
  } catch (error) {
    console.error('Admin recruiters error:', error.message);
    return res.status(500).json({ message: 'Failed to load recruiters.' });
  }
};

const inviteRecruiter = async (req, res) => {
  try {
    const recruiterSettings = getRecruiterSettingsSync();
    if (recruiterSettings.enableRecruiterAccess === false) {
      return res.status(403).json({ message: 'Recruiter access is currently disabled by Super Admin settings.' });
    }

    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);

    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required.' });
    }

    const organizationSettings = getOrganizationSettingsSync();
    const [existingUser, existingPendingInvite, organization, recruiterCount] = await Promise.all([
      User.findOne({ email }).lean(),
      Invitation.findOne({
        email,
        organizationId: req.organizationId,
        teamId: req.body?.teamId || null,
        role: 'recruiter',
        status: 'pending',
        expiresAt: { $gt: new Date() }
      }).lean(),
      Organization.findById(req.organizationId).select('name').lean(),
      User.countDocuments({ role: 'recruiter', organizationId: req.organizationId, isActive: { $ne: false } })
    ]);

    if (recruiterCount >= Number(organizationSettings.recruiterLimitPerOrg || 5)) {
      return res.status(400).json({ message: `Recruiter limit (${organizationSettings.recruiterLimitPerOrg}) reached for this organization.` });
    }

    if (existingUser?.organizationId && String(existingUser.organizationId) !== String(req.organizationId)) {
      return res.status(403).json({ message: 'This email is already assigned to another organization.' });
    }

    if (existingUser?.role === 'recruiter' && existingUser.isActive !== false) {
      return res.status(409).json({ message: 'This recruiter already has active access.' });
    }

    if (existingPendingInvite) {
      return res.status(409).json({ message: 'An active recruiter invitation already exists for this email.' });
    }

    let team = null;
    const teamId = String(req.body?.teamId || '').trim() || null;
    if (teamId) {
      team = await Team.findOne({ _id: teamId, organizationId: req.organizationId, isActive: true }).select('_id name').lean();
      if (!team) {
        return res.status(404).json({ message: 'Team not found in this organization.' });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await Invitation.create({
      name,
      email,
      role: 'recruiter',
      organizationId: req.organizationId,
      teamId: team ? team._id : null,
      invitedBy: req.user._id,
      status: 'pending',
      token,
      expiresAt
    });

    const frontendBase = String(process.env.FRONTEND_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
    const invitationLink = `${frontendBase}/invitations/accept/${token}`;

    const emailResult = await sendRecruiterInvitationEmail({
      to: email,
      inviteeName: name,
      organizationName: organization?.name || 'DevInsight Organization',
      invitationLink
    });

    const responseMessage = emailResult.sent
      ? 'Recruiter invitation sent successfully.'
      : 'Recruiter invitation created. Email was not sent automatically; share the invitation link manually.';

    return res.status(201).json({
      message: responseMessage,
      invitation: {
        _id: invitation._id,
        name: invitation.name,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        teamId: invitation.teamId,
        expiresAt: invitation.expiresAt
      },
      invitationLink,
      email: {
        sent: emailResult.sent,
        reason: emailResult.reason || null
      }
    });
  } catch (error) {
    console.error('Admin invite recruiter error:', error.message);
    return res.status(500).json({ message: 'Failed to invite recruiter.' });
  }
};

const validateDirectRecruiterInput = ({ name, email, password }) => {
  if (!name || !email) {
    return { status: 400, message: 'name and email are required.' };
  }

  const passwordPolicy = validatePasswordAgainstPolicy(password);
  if (!passwordPolicy.valid) {
    return { status: 400, message: passwordPolicy.message };
  }

  return null;
};

const upsertDirectRecruiterRecord = async ({ existingUser, organizationId, name, email, password }) => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  if (existingUser) {
    const recruiter = await User.findById(existingUser._id);
    recruiter.name = name;
    recruiter.email = email;
    recruiter.password = hashedPassword;
    recruiter.role = 'recruiter';
    recruiter.organizationId = organizationId;
    recruiter.isVerified = true;
    recruiter.isActive = true;
    recruiter.onboardingCompleted = true;
    recruiter.activeCareerStack = recruiter.activeCareerStack || recruiter.careerStack || 'Full Stack';
    recruiter.activeExperienceLevel = recruiter.activeExperienceLevel || recruiter.experienceLevel || 'Student';
    await recruiter.save();
    return recruiter;
  }

  return User.create({
    name,
    email,
    password: hashedPassword,
    role: 'recruiter',
    organizationId,
    isVerified: true,
    isActive: true,
    onboardingCompleted: true,
    activeCareerStack: 'Full Stack',
    activeExperienceLevel: 'Student'
  });
};

const upsertRecruiterMemberships = async ({ organizationId, recruiterId, teamId, invitedBy }) => {
  const orgMembership = await Membership.findOneAndUpdate(
    {
      organizationId,
      userId: recruiterId,
      teamId: null
    },
    {
      $set: {
        role: 'member',
        status: 'active',
        invitedBy,
        joinedAt: new Date()
      }
    },
    { upsert: true, setDefaultsOnInsert: true, new: true }
  );

  const teamMembership = teamId
    ? await Membership.findOneAndUpdate(
        {
          organizationId,
          userId: recruiterId,
          teamId
        },
        {
          $set: {
            role: 'member',
            status: 'active',
            invitedBy,
            joinedAt: new Date()
          }
        },
        { upsert: true, setDefaultsOnInsert: true, new: true }
      )
    : null;

  return { orgMembership, teamMembership };
};

const addRecruiterDirect = async (req, res) => {
  try {
    const recruiterSettings = getRecruiterSettingsSync();
    if (recruiterSettings.enableRecruiterAccess === false) {
      return res.status(403).json({ message: 'Recruiter access is currently disabled by Super Admin settings.' });
    }

    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const teamId = String(req.body?.teamId || '').trim() || null;

    const validationError = validateDirectRecruiterInput({ name, email, password });
    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    const organizationSettings = getOrganizationSettingsSync();
    const [existingUser, organization, team, recruiterCount] = await Promise.all([
      User.findOne({ email }).lean(),
      Organization.findById(req.organizationId).select('name').lean(),
      teamId ? Team.findOne({ _id: teamId, organizationId: req.organizationId, isActive: true }).select('_id name').lean() : null,
      User.countDocuments({ role: 'recruiter', organizationId: req.organizationId, isActive: { $ne: false } })
    ]);

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found.' });
    }

    if (teamId && !team) {
      return res.status(404).json({ message: 'Team not found in this organization.' });
    }

    if (existingUser?.organizationId && String(existingUser.organizationId) !== String(req.organizationId)) {
      return res.status(403).json({ message: 'This email is already assigned to another organization.' });
    }

    if ((!existingUser || String(existingUser.organizationId || '') === String(req.organizationId)) &&
        recruiterCount >= Number(organizationSettings.recruiterLimitPerOrg || 5)) {
      return res.status(400).json({ message: `Recruiter limit (${organizationSettings.recruiterLimitPerOrg}) reached for this organization.` });
    }

    const restrictedRole = String(existingUser?.role || '').toLowerCase();
    if (restrictedRole === 'admin' || restrictedRole === 'super_admin') {
      return res.status(409).json({ message: 'This email is already linked to a restricted account role.' });
    }

    const recruiter = await upsertDirectRecruiterRecord({
      existingUser,
      organizationId: req.organizationId,
      name,
      email,
      password
    });

    const { orgMembership, teamMembership } = await upsertRecruiterMemberships({
      organizationId: req.organizationId,
      recruiterId: recruiter._id,
      teamId: team ? team._id : null,
      invitedBy: req.user?._id || null
    });

    const createdRecruiter = await User.findById(recruiter._id)
      .select('_id name email role organizationId githubUsername linkedin phoneNumber isActive jobTitle bio createdAt')
      .lean();

    return res.status(201).json({
      message: 'Recruiter created successfully.',
      recruiter: sanitizeRecruiter(createdRecruiter),
      membership: orgMembership,
      teamMembership,
      team: team ? { _id: team._id, name: team.name } : null
    });
  } catch (error) {
    console.error('Admin direct recruiter create error:', error.message);
    return res.status(500).json({ message: 'Failed to create recruiter.' });
  }
};

const updateRecruiter = async (req, res) => {
  try {
    const recruiter = await User.findOne({
      _id: req.params.id,
      role: 'recruiter',
      organizationId: req.organizationId
    });

    if (!recruiter) {
      return res.status(404).json({ message: 'Recruiter not found.' });
    }

    const hasName = Object.hasOwn(req.body || {}, 'name');
    const hasEmail = Object.hasOwn(req.body || {}, 'email');
    const nextName = hasName ? String(req.body?.name || '').trim() : recruiter.name;
    const nextEmail = hasEmail ? normalizeEmail(req.body?.email) : recruiter.email;

    if (!nextName || !nextEmail) {
      return res.status(400).json({ message: 'name and email are required.' });
    }

    if (nextEmail !== recruiter.email) {
      const emailOwner = await User.findOne({ email: nextEmail, _id: { $ne: recruiter._id } }).select('_id').lean();
      if (emailOwner) {
        return res.status(409).json({ message: 'Another account already uses this email.' });
      }
    }

    recruiter.name = nextName;
    recruiter.email = nextEmail;

    if (req.body?.githubUsername !== undefined) {
      recruiter.githubUsername = String(req.body.githubUsername || '').trim();
      recruiter.activeGithubUsername = recruiter.githubUsername;
    }

    if (req.body?.linkedin !== undefined) {
      recruiter.linkedin = normalizeLinkedIn(req.body.linkedin);
    }

    if (req.body?.phoneNumber !== undefined) {
      recruiter.phoneNumber = normalizePhone(req.body.phoneNumber);
    }

    await recruiter.save();

    return res.status(200).json({ recruiter: sanitizeRecruiter(recruiter) });
  } catch (error) {
    console.error('Admin update recruiter error:', error.message);
    return res.status(500).json({ message: 'Failed to update recruiter.' });
  }
};

const setRecruiterActive = async (req, res) => {
  try {
    if (typeof req.body?.isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean.' });
    }

    const recruiter = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        role: 'recruiter',
        organizationId: req.organizationId
      },
      {
        $set: {
          isActive: req.body.isActive
        }
      },
      { new: true }
    );

    if (!recruiter) {
      return res.status(404).json({ message: 'Recruiter not found.' });
    }

    return res.status(200).json({ recruiter: sanitizeRecruiter(recruiter) });
  } catch (error) {
    console.error('Admin recruiter activation error:', error.message);
    return res.status(500).json({ message: 'Failed to update recruiter status.' });
  }
};

const revokeRecruiterAccess = async (req, res) => {
  req.body = {
    isActive: false
  };
  return setRecruiterActive(req, res);
};

const deleteRecruiter = async (req, res) => {
  try {
    const recruiter = await User.findOne({
      _id: req.params.id,
      role: 'recruiter',
      organizationId: req.organizationId
    }).lean();

    if (!recruiter) {
      return res.status(404).json({ message: 'Recruiter not found.' });
    }

    await Promise.all([
      User.deleteOne({ _id: recruiter._id }),
      Membership.deleteMany({
        organizationId: req.organizationId,
        userId: recruiter._id
      }),
      Invitation.updateMany(
        {
          organizationId: req.organizationId,
          email: recruiter.email,
          role: 'recruiter',
          status: 'pending'
        },
        {
          $set: { status: 'revoked' }
        }
      )
    ]);

    return res.status(200).json({ message: 'Recruiter deleted successfully.' });
  } catch (error) {
    console.error('Admin delete recruiter error:', error.message);
    return res.status(500).json({ message: 'Failed to delete recruiter.' });
  }
};

// ── Pending Invitations ───────────────────────────────────────────────────

const getPendingInvitations = async (req, res) => {
  try {
    const invitations = await Invitation.find({
      organizationId: req.organizationId,
      role: 'recruiter',
      status: 'pending'
    })
      .select('_id name email role status expiresAt createdAt invitedBy teamId')
      .populate('invitedBy', 'name email')
      .populate('teamId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ invitations });
  } catch (error) {
    console.error('Admin pending invitations error:', error.message);
    return res.status(500).json({ message: 'Failed to load pending invitations.' });
  }
};

const resendInvitation = async (req, res) => {
  try {
    const invitation = await Invitation.findOne({
      _id: req.params.id,
      organizationId: req.organizationId,
      role: 'recruiter',
      status: 'pending'
    }).lean();

    if (!invitation) {
      return res.status(404).json({ message: 'Pending invitation not found.' });
    }

    const organization = await Organization.findById(req.organizationId).select('name').lean();
    const frontendBase = String(process.env.FRONTEND_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
    const invitationLink = `${frontendBase}/invitations/accept/${invitation.token}`;
    const emailResult = await sendRecruiterInvitationEmail({
      to: invitation.email,
      inviteeName: invitation.name,
      organizationName: organization?.name || 'DevInsight Organization',
      invitationLink
    });

    return res.status(200).json({
      message: emailResult.sent
        ? 'Invitation resent successfully.'
        : 'Invitation resend attempted but email was not sent automatically.',
      invitationLink,
      email: {
        sent: emailResult.sent,
        reason: emailResult.reason || null
      }
    });
  } catch (error) {
    console.error('Admin resend invitation error:', error.message);
    return res.status(500).json({ message: 'Failed to resend invitation.' });
  }
};

const revokeInvitation = async (req, res) => {
  try {
    const invitation = await Invitation.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.organizationId,
        role: 'recruiter',
        status: 'pending'
      },
      { $set: { status: 'revoked' } },
      { new: true }
    );

    if (!invitation) {
      return res.status(404).json({ message: 'Pending invitation not found.' });
    }

    return res.status(200).json({ message: 'Invitation revoked successfully.' });
  } catch (error) {
    console.error('Admin revoke invitation error:', error.message);
    return res.status(500).json({ message: 'Failed to revoke invitation.' });
  }
};

const expireInvitation = async (req, res) => {
  try {
    const invitation = await Invitation.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.organizationId,
        role: 'recruiter',
        status: 'pending'
      },
      { $set: { status: 'expired', expiresAt: new Date() } },
      { new: true }
    );

    if (!invitation) {
      return res.status(404).json({ message: 'Pending invitation not found.' });
    }

    return res.status(200).json({ message: 'Invitation expired successfully.' });
  } catch (error) {
    console.error('Admin expire invitation error:', error.message);
    return res.status(500).json({ message: 'Failed to expire invitation.' });
  }
};

const deleteInvitation = async (req, res) => {
  try {
    const invitation = await Invitation.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.organizationId,
      role: 'recruiter'
    });

    if (!invitation) {
      return res.status(404).json({ message: 'Invitation not found.' });
    }

    return res.status(200).json({ message: 'Invitation deleted successfully.' });
  } catch (error) {
    console.error('Admin delete invitation error:', error.message);
    return res.status(500).json({ message: 'Failed to delete invitation.' });
  }
};

module.exports = {
  getRecruiters,
  inviteRecruiter,
  addRecruiterDirect,
  updateRecruiter,
  setRecruiterActive,
  revokeRecruiterAccess,
  deleteRecruiter,
  getPendingInvitations,
  resendInvitation,
  revokeInvitation,
  expireInvitation,
  deleteInvitation
};
