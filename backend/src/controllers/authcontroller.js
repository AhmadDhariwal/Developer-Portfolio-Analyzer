const User = require('../models/user');
const PendingRegistration = require('../models/pendingRegistration');
const Invitation = require('../models/invitation');
const Organization = require('../models/organization');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { registerAuthFailure, clearAuthFailures } = require('../middleware/securityMiddleware');
const { createOtp, validateOtp } = require('../services/otpService');
const { hashValue, matchesHashedValue } = require('../utils/hash');
const { generateOtp } = require('../utils/otpGenerator');
const { sendEmailOTP } = require('../services/emailService');
const { sendSMSOTP } = require('../services/smsService');

const OTP_EXPIRY_MINUTES = 10; // pending registrations live for 10 min
const MAX_OTP_ATTEMPTS   = 3;

// ── Helpers ───────────────────────────────────────────────────────────────

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '20h',
    algorithm: 'HS256',
    issuer:    process.env.JWT_ISSUER    || 'devinsight-api',
    audience:  process.env.JWT_AUDIENCE  || 'devinsight-web'
  });

const normalizeEmail       = (v) => String(v || '').trim().toLowerCase();
const normalizePhone       = (v) => String(v || '').trim();
const normalizeCountryCode = (v) => String(v || '').trim();
const normalizeOtpType     = (v) => (String(v || '').toLowerCase() === 'phone' ? 'phone' : 'email');
const normalizePurpose     = (v) => (String(v || '').toLowerCase() === 'forgot-password' ? 'forgot-password' : 'signup');
const toPublicRole         = (v) => (String(v || '').toLowerCase() === 'user' ? 'developer' : String(v || 'developer'));
const normalizeLinkedIn    = (v) => String(v || '').trim();

const isRecruiterProfileComplete = (user) => {
  if (!user || String(user.role || '').toLowerCase() !== 'recruiter') {
    return true;
  }

  const hasName = Boolean(String(user.name || '').trim());
  const hasPhone = Boolean(normalizePhone(user.phoneNumber));
  const hasProfessionalLink = Boolean(normalizeLinkedIn(user.linkedin) || String(user.githubUsername || '').trim());
  const hasBasicProfile = Boolean(String(user.jobTitle || '').trim() || String(user.bio || '').trim());

  return hasName && hasPhone && hasProfessionalLink && hasBasicProfile;
};

const loadValidRecruiterInvitationByToken = async (rawToken) => {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { error: { status: 400, message: 'Invitation token is required.' } };
  }

  const invitation = await Invitation.findOne({ token, role: 'recruiter' }).lean();
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

const getUserByIdentifier = async ({ email, countryCode, phoneNumber }) => {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) return User.findOne({ email: normalizedEmail });
  const phone = normalizePhone(phoneNumber);
  const code  = normalizeCountryCode(countryCode);
  if (!phone || !code) return null;
  return User.findOne({ phoneNumber: phone, countryCode: code });
};

const sendOtpToUser = async ({ user, type, purpose }) => {
  const { otp, expiresAt } = await createOtp({ userId: user._id, type, purpose });
  if (type === 'phone') {
    await sendSMSOTP(`${user.countryCode}${user.phoneNumber}`, otp);
  } else {
    await sendEmailOTP(user.email, otp);
  }
  return expiresAt;
};

// ── Register ──────────────────────────────────────────────────────────────
// @desc  Start registration — store pending record, send OTP. NO user created yet.
// @route POST /api/auth/register
// @access Public
const registerUser = async (req, res) => {
  try {
    const { name, email, password, githubUsername, phoneNumber, countryCode, isPublic } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phoneNumber);
    const normalizedCode  = normalizeCountryCode(countryCode);

    if (!name || !normalizedEmail || !password || !githubUsername) {
      return res.status(400).json({ message: 'Please add all fields' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }
    if ((normalizedPhone && !normalizedCode) || (!normalizedPhone && normalizedCode)) {
      return res.status(400).json({ message: 'Country code and phone number must be provided together.' });
    }

    // Block if a verified user already exists with this email
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists.' });
    }

    // Hash password
    const salt           = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate OTP
    const otp       = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Upsert pending registration (replace if they're retrying)
    const pending = await PendingRegistration.findOneAndUpdate(
      { email: normalizedEmail },
      {
        $set: {
          name,
          hashedPassword,
          githubUsername,
          phoneNumber: normalizedPhone,
          countryCode: normalizedCode,
          otpType: normalizedPhone ? 'phone' : 'email',
          isPublic: Boolean(isPublic),
          otp: hashValue(otp),
          otpAttempts: 0,
          expiresAt
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Send OTP
    if (normalizedPhone) {
      await sendSMSOTP(`${normalizedCode}${normalizedPhone}`, otp);
    } else {
      await sendEmailOTP(normalizedEmail, otp);
    }

    return res.status(201).json({
      pendingId: pending._id,
      email:     normalizedEmail,
      otpType:   pending.otpType,
      expiresAt,
      requiresOtp: true
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ── Login ─────────────────────────────────────────────────────────────────
// @route POST /api/auth/login
// @access Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail });

    if (user?.isActive === false) {
      return res.status(403).json({ message: 'Account is deactivated. Please contact your administrator.' });
    }

    if (user && (await bcrypt.compare(password, user.password))) {
      user.activeGithubUsername  = user.githubUsername;
      user.activeResumeFileId    = user.defaultResumeFileId || null;
      user.activeCareerStack     = user.careerStack     || 'Full Stack';
      user.activeExperienceLevel = user.experienceLevel || 'Student';
      await user.save();
      clearAuthFailures(req);

      return res.json({
        _id:                  user.id,
        name:                 user.name,
        email:                user.email,
        role:                 toPublicRole(user.role),
        organizationId:       user.organizationId || null,
        isActive:             user.isActive !== false,
        isPublic:             Boolean(user.isPublic),
        phoneNumber:          user.phoneNumber || '',
        linkedin:             user.linkedin || '',
        profileCompleted:     isRecruiterProfileComplete(user),
        githubUsername:       user.githubUsername,
        activeGithubUsername: user.activeGithubUsername || user.githubUsername,
        avatar:               user.avatar || '',
        careerStack:          user.careerStack,
        experienceLevel:      user.experienceLevel,
        activeCareerStack:    user.activeCareerStack    || user.careerStack,
        activeExperienceLevel:user.activeExperienceLevel|| user.experienceLevel,
        token:                generateToken(user._id)
      });
    }

    registerAuthFailure(req);
    return res.status(401).json({ message: 'Invalid credentials' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ── Send OTP (for existing users — forgot-password / resend) ──────────────
// @route POST /api/auth/send-otp
// @access Public
const sendOtp = async (req, res) => {
  try {
    const { userId, pendingId, email, phoneNumber, countryCode, type, purpose } = req.body;
    const otpType   = normalizeOtpType(type);
    const otpPurpose = normalizePurpose(purpose);

    // ── Resend for pending signup ──────────────────────────────────────────
    if (otpPurpose === 'signup') {
      let pending = null;
      if (pendingId) {
        pending = await PendingRegistration.findById(pendingId);
      }
      if (!pending && email) {
        pending = await PendingRegistration.findOne({ email: normalizeEmail(email) });
      }
      if (!pending) {
        return res.status(404).json({ message: 'Pending registration not found. Please sign up again.' });
      }

      const otp       = generateOtp();
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      pending.otp         = hashValue(otp);
      pending.otpAttempts = 0;
      pending.expiresAt   = expiresAt;
      await pending.save();

      if (pending.otpType === 'phone' && pending.phoneNumber) {
        await sendSMSOTP(`${pending.countryCode}${pending.phoneNumber}`, otp);
      } else {
        await sendEmailOTP(pending.email, otp);
      }

      return res.json({
        message:   `OTP resent via ${pending.otpType}.`,
        pendingId: pending._id,
        expiresAt
      });
    }

    // ── Forgot-password / other purposes — use real User ──────────────────
    let user = null;
    if (userId) user = await User.findById(userId);
    if (!user)  user = await getUserByIdentifier({ email, phoneNumber, countryCode });
    if (!user)  return res.status(404).json({ message: 'User not found.' });

    if (otpType === 'phone' && (!user.phoneNumber || !user.countryCode)) {
      return res.status(400).json({ message: 'Phone OTP is unavailable for this account.' });
    }

    const expiresAt = await sendOtpToUser({ user, type: otpType, purpose: otpPurpose });
    return res.json({ message: `OTP sent via ${otpType}.`, userId: user._id, expiresAt });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send OTP.' });
  }
};

// ── Verify OTP ────────────────────────────────────────────────────────────
// @route POST /api/auth/verify-otp
// @access Public
const verifyOtp = async (req, res) => {
  try {
    const { userId, pendingId, otp, type, purpose } = req.body;
    const otpType    = normalizeOtpType(type);
    const otpPurpose = normalizePurpose(purpose);

    if (!otp) {
      return res.status(400).json({ message: 'OTP is required.' });
    }

    // ── Signup path — verify against PendingRegistration ──────────────────
    if (otpPurpose === 'signup') {
      let pending = null;
      if (pendingId) pending = await PendingRegistration.findById(pendingId);
      if (!pending && userId) {
        // userId might be the pendingId sent from older frontend state
        pending = await PendingRegistration.findById(userId).catch(() => null);
      }
      if (!pending) {
        return res.status(404).json({ message: 'Registration session not found or expired. Please sign up again.' });
      }

      // Check expiry
      if (pending.expiresAt < new Date()) {
        await PendingRegistration.deleteOne({ _id: pending._id });
        return res.status(400).json({ message: 'OTP has expired. Please sign up again.' });
      }

      // Check attempts
      if (pending.otpAttempts >= MAX_OTP_ATTEMPTS) {
        await PendingRegistration.deleteOne({ _id: pending._id });
        return res.status(400).json({ message: 'Maximum OTP attempts reached. Please sign up again.' });
      }

      // Verify OTP
      if (!matchesHashedValue(otp, pending.otp)) {
        pending.otpAttempts += 1;
        await pending.save();
        const remaining = MAX_OTP_ATTEMPTS - pending.otpAttempts;
        return res.status(400).json({
          message: remaining > 0
            ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
            : 'Invalid OTP. No attempts remaining.'
        });
      }

      // OTP correct — create the real user now
      const user = await User.create({
        name:                 pending.name,
        email:                pending.email,
        password:             pending.hashedPassword,
        githubUsername:       pending.githubUsername,
        phoneNumber:          pending.phoneNumber,
        countryCode:          pending.countryCode,
        activeGithubUsername: pending.githubUsername,
        activeCareerStack:    'Full Stack',
        activeExperienceLevel:'Student',
        isPublic:             Boolean(pending.isPublic),
        isVerified:           true
      });

      // Clean up pending record
      await PendingRegistration.deleteOne({ _id: pending._id });

      return res.json({
        message:              'Account verified successfully.',
        _id:                  user.id,
        name:                 user.name,
        email:                user.email,
        role:                 toPublicRole(user.role),
        organizationId:       user.organizationId || null,
        isPublic:             Boolean(user.isPublic),
        githubUsername:       user.githubUsername,
        activeGithubUsername: user.activeGithubUsername || user.githubUsername,
        avatar:               user.avatar || '',
        careerStack:          user.careerStack,
        experienceLevel:      user.experienceLevel,
        activeCareerStack:    user.activeCareerStack    || user.careerStack,
        activeExperienceLevel:user.activeExperienceLevel|| user.experienceLevel,
        token:                generateToken(user._id)
      });
    }

    // ── Forgot-password path — verify against OTP model ───────────────────
    if (!userId) {
      return res.status(400).json({ message: 'userId is required.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const result = await validateOtp({ userId: user._id, otp, type: otpType, purpose: otpPurpose });
    if (!result.isValid) {
      return res.status(400).json({ message: result.message });
    }

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'reset-password' },
      `${process.env.JWT_SECRET}${user.password}`,
      { expiresIn: '10m' }
    );
    return res.json({ message: 'OTP verified successfully.', resetToken });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to verify OTP.' });
  }
};

// ── Forgot Password ───────────────────────────────────────────────────────
// @route POST /api/auth/forgot-password
// @access Public
const forgotPassword = async (req, res) => {
  try {
    const { email, phoneNumber, countryCode, type } = req.body;
    const otpType = normalizeOtpType(type);
    const user    = await getUserByIdentifier({ email, phoneNumber, countryCode });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (otpType === 'phone' && (!user.phoneNumber || !user.countryCode)) {
      return res.status(400).json({ message: 'Phone OTP is unavailable for this account.' });
    }

    const expiresAt = await sendOtpToUser({ user, type: otpType, purpose: 'forgot-password' });
    return res.json({ message: 'OTP sent for password reset.', userId: user._id, expiresAt });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to start password reset.' });
  }
};

// ── Reset Password ────────────────────────────────────────────────────────
// @route POST /api/auth/reset-password
// @access Public
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: 'resetToken and newPassword are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const decoded = jwt.decode(resetToken);
    const userId  = decoded?.id;
    if (!userId) return res.status(400).json({ message: 'Invalid reset token.' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    try {
      jwt.verify(resetToken, `${process.env.JWT_SECRET}${user.password}`);
    } catch {
      return res.status(400).json({ message: 'Reset token expired or invalid.' });
    }

    const salt   = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.json({ message: 'Password reset successful.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to reset password.' });
  }
};

// ── Recruiter Invitation Details ─────────────────────────────────────────
// @route GET /api/auth/invite-details/:token
// @access Public
const getInviteDetails = async (req, res) => {
  try {
    const loaded = await loadValidRecruiterInvitationByToken(req.params.token);
    if (loaded.error) {
      return res.status(loaded.error.status).json({ message: loaded.error.message });
    }

    const invitation = loaded.invitation;
    const [organization, existingUser] = await Promise.all([
      Organization.findById(invitation.organizationId).select('name').lean(),
      User.findOne({ email: invitation.email }).select('_id role organizationId').lean()
    ]);

    return res.json({
      invitation: {
        name: invitation.name || '',
        email: invitation.email,
        role: 'recruiter',
        expiresAt: invitation.expiresAt,
        organizationName: organization?.name || 'Organization',
        hasExistingAccount: Boolean(existingUser),
        alreadyInAnotherOrganization: Boolean(
          existingUser?.organizationId &&
          String(existingUser.organizationId) !== String(invitation.organizationId)
        )
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load invitation details.' });
  }
};

// ── Recruiter Invitation Accept ──────────────────────────────────────────
// @route POST /api/auth/accept-invite
// @access Public
const acceptInvite = async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const loaded = await loadValidRecruiterInvitationByToken(token);
    if (loaded.error) {
      return res.status(loaded.error.status).json({ message: loaded.error.message });
    }

    const invitation = loaded.invitation;
    const requestedName = String(req.body?.name || '').trim();
    const requestedPassword = String(req.body?.password || '');
    const requestedGithub = String(req.body?.githubUsername || '').trim();
    const requestedLinkedIn = normalizeLinkedIn(req.body?.linkedin);
    const requestedPhone = normalizePhone(req.body?.phoneNumber);
    const requestedCountryCode = normalizeCountryCode(req.body?.countryCode);

    const existingUser = await User.findOne({ email: invitation.email });

    if (existingUser?.organizationId && String(existingUser.organizationId) !== String(invitation.organizationId)) {
      return res.status(403).json({ message: 'This invitation cannot be accepted outside the assigned organization.' });
    }

    if (existingUser?.role && !['recruiter', 'user', 'developer'].includes(String(existingUser.role).toLowerCase())) {
      return res.status(409).json({ message: 'This email is already linked to a restricted account role.' });
    }

    let user = existingUser;
    if (!user && requestedPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    if (user) {
      if (requestedPassword) {
        if (requestedPassword.length < 6) {
          return res.status(400).json({ message: 'Password must be at least 6 characters.' });
        }
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(requestedPassword, salt);
      }

      user.name = requestedName || invitation.name || user.name;
      user.role = 'recruiter';
      user.organizationId = invitation.organizationId;
      user.isVerified = true;
      user.isActive = true;
      if (requestedGithub) {
        user.githubUsername = requestedGithub;
        user.activeGithubUsername = requestedGithub;
      }
      if (requestedLinkedIn || requestedLinkedIn === '') {
        user.linkedin = requestedLinkedIn;
      }
      if (requestedPhone || requestedPhone === '') {
        user.phoneNumber = requestedPhone;
      }
      if (requestedCountryCode || requestedCountryCode === '') {
        user.countryCode = requestedCountryCode;
      }

      await user.save();
    } else {
      const fallbackName = requestedName || invitation.name || String(invitation.email).split('@')[0] || 'Recruiter';
      const fallbackGithub = requestedGithub;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(requestedPassword, salt);

      user = await User.create({
        name: fallbackName,
        email: invitation.email,
        password: hashedPassword,
        githubUsername: fallbackGithub,
        activeGithubUsername: fallbackGithub,
        role: 'recruiter',
        organizationId: invitation.organizationId,
        isPublic: false,
        isVerified: true,
        isActive: true,
        linkedin: requestedLinkedIn,
        phoneNumber: requestedPhone,
        countryCode: requestedCountryCode,
        activeCareerStack: 'Full Stack',
        activeExperienceLevel: 'Student'
      });
    }

    await Invitation.findByIdAndUpdate(invitation._id, {
      status: 'accepted',
      acceptedBy: user._id
    });

    user.activeCareerStack = user.activeCareerStack || user.careerStack || 'Full Stack';
    user.activeExperienceLevel = user.activeExperienceLevel || user.experienceLevel || 'Student';
    await user.save();

    const profileCompleted = isRecruiterProfileComplete(user);

    return res.json({
      message: 'Invitation accepted successfully.',
      requiresProfileCompletion: !profileCompleted,
      redirectTo: profileCompleted ? '/app/recruiter/dashboard' : '/app/profile?onboarding=recruiter',
      user: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: toPublicRole(user.role),
        organizationId: user.organizationId || null,
        isActive: user.isActive !== false,
        isPublic: Boolean(user.isPublic),
        githubUsername: user.githubUsername || '',
        activeGithubUsername: user.activeGithubUsername || user.githubUsername || '',
        phoneNumber: user.phoneNumber || '',
        linkedin: user.linkedin || '',
        avatar: user.avatar || '',
        careerStack: user.careerStack,
        experienceLevel: user.experienceLevel,
        activeCareerStack: user.activeCareerStack || user.careerStack,
        activeExperienceLevel: user.activeExperienceLevel || user.experienceLevel,
        profileCompleted,
        token: generateToken(user._id)
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to accept invitation.' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  sendOtp,
  verifyOtp,
  forgotPassword,
  resetPassword,
  getInviteDetails,
  acceptInvite
};
