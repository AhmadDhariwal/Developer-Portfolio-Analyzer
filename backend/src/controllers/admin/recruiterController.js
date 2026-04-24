const crypto = require('node:crypto');

const User = require('../../models/user');
const Invitation = require('../../models/invitation');
const Organization = require('../../models/organization');
const { sendRecruiterInvitationEmail } = require('../../services/emailService');

const INVITATION_TTL_DAYS = 7;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim();
const normalizeLinkedIn = (value) => String(value || '').trim();

const buildRecruiterProfileCompleted = (user = {}) => {
  const hasName = Boolean(String(user.name || '').trim());
  const hasPhone = Boolean(normalizePhone(user.phoneNumber));
  const hasProfessionalLink = Boolean(String(user.githubUsername || '').trim() || normalizeLinkedIn(user.linkedin));
  const hasBasicInfo = Boolean(String(user.jobTitle || '').trim() || String(user.bio || '').trim());
  return hasName && hasPhone && hasProfessionalLink && hasBasicInfo;
};

const sanitizeRecruiter = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
  githubUsername: user.githubUsername || '',
  linkedin: user.linkedin || '',
  phoneNumber: user.phoneNumber || '',
  isActive: user.isActive !== false,
  profileCompleted: buildRecruiterProfileCompleted(user),
  createdAt: user.createdAt
});

const getRecruiters = async (req, res) => {
  try {
    const recruiters = await User.find({
      role: 'recruiter',
      organizationId: req.organizationId
    })
      .select('_id name email role organizationId githubUsername linkedin phoneNumber isActive jobTitle bio createdAt')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      recruiters: recruiters.map((recruiter) => sanitizeRecruiter(recruiter))
    });
  } catch (error) {
    console.error('Admin recruiters error:', error.message);
    return res.status(500).json({ message: 'Failed to load recruiters.' });
  }
};

const inviteRecruiter = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);

    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required.' });
    }

    const [existingUser, existingPendingInvite, organization] = await Promise.all([
      User.findOne({ email }).lean(),
      Invitation.findOne({
        email,
        organizationId: req.organizationId,
        role: 'recruiter',
        status: 'pending',
        expiresAt: { $gt: new Date() }
      }).lean(),
      Organization.findById(req.organizationId).select('name').lean()
    ]);

    if (existingUser?.organizationId && String(existingUser.organizationId) !== String(req.organizationId)) {
      return res.status(403).json({ message: 'This email is already assigned to another organization.' });
    }

    if (existingUser?.role === 'recruiter' && existingUser.isActive !== false) {
      return res.status(409).json({ message: 'This recruiter already has active access.' });
    }

    if (existingPendingInvite) {
      return res.status(409).json({ message: 'An active recruiter invitation already exists for this email.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await Invitation.create({
      name,
      email,
      role: 'recruiter',
      organizationId: req.organizationId,
      invitedBy: req.user._id,
      status: 'pending',
      token,
      expiresAt
    });

    const frontendBase = String(process.env.FRONTEND_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
    const invitationLink = `${frontendBase}/app/invitations/accept/${token}`;

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

module.exports = {
  getRecruiters,
  inviteRecruiter,
  updateRecruiter,
  setRecruiterActive,
  revokeRecruiterAccess,
  deleteRecruiter
};
