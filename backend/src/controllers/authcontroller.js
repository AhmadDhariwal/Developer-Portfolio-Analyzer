const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { registerAuthFailure, clearAuthFailures } = require('../middleware/securityMiddleware');
const { createOtp, validateOtp } = require('../services/otpService');
const { sendEmailOTP } = require('../services/emailService');
const { sendSMSOTP } = require('../services/smsService');

// Generate JWT
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '20h',
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web'
    });
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim();
const normalizeCountryCode = (value) => String(value || '').trim();
const normalizeOtpType = (value) => (String(value || '').toLowerCase() === 'phone' ? 'phone' : 'email');
const normalizePurpose = (value) =>
    (String(value || '').toLowerCase() === 'forgot-password' ? 'forgot-password' : 'signup');

const getUserByIdentifier = async ({ email, countryCode, phoneNumber }) => {
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail) return User.findOne({ email: normalizedEmail });

    const normalizedPhone = normalizePhone(phoneNumber);
    const normalizedCode = normalizeCountryCode(countryCode);
    if (!normalizedPhone || !normalizedCode) return null;
    return User.findOne({ phoneNumber: normalizedPhone, countryCode: normalizedCode });
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

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
    try {
        const { name, email, password, githubUsername, phoneNumber, countryCode } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const normalizedPhone = normalizePhone(phoneNumber);
        const normalizedCountryCode = normalizeCountryCode(countryCode);

        if (!name || !normalizedEmail || !password || !githubUsername) {
            return res.status(400).json({ message: 'Please add all fields' });
        }

        if ((normalizedPhone && !normalizedCountryCode) || (!normalizedPhone && normalizedCountryCode)) {
            return res.status(400).json({ message: 'Country code and phone number must be provided together.' });
        }

        // Check if user exists
        const userExists = await User.findOne({ email: normalizedEmail });

        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const user = await User.create({
            name,
            email: normalizedEmail,
            password: hashedPassword,
            githubUsername,
            phoneNumber: normalizedPhone,
            countryCode: normalizedCountryCode,
            activeGithubUsername: githubUsername,
            activeCareerStack: 'Full Stack',
            activeExperienceLevel: 'Student',
            isVerified: false
        });

        if (user) {
            res.status(201).json({
                _id: user.id,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber || '',
                countryCode: user.countryCode || '',
                isVerified: user.isVerified,
                requiresOtp: true
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        // Check for user email
        const user = await User.findOne({ email: normalizedEmail });

        if (user && (await bcrypt.compare(password, user.password))) {
            user.activeGithubUsername = user.githubUsername;
            user.activeResumeFileId = user.defaultResumeFileId || null;
            user.activeCareerStack = user.careerStack || 'Full Stack';
            user.activeExperienceLevel = user.experienceLevel || 'Student';
            await user.save();
            clearAuthFailures(req);

            res.json({
                _id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                githubUsername: user.githubUsername,
                activeGithubUsername: user.activeGithubUsername || user.githubUsername,
                avatar: user.avatar || '',
                careerStack: user.careerStack,
                experienceLevel: user.experienceLevel,
                activeCareerStack: user.activeCareerStack || user.careerStack,
                activeExperienceLevel: user.activeExperienceLevel || user.experienceLevel,
                token: generateToken(user._id),
            });
        } else {
            registerAuthFailure(req);
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const sendOtp = async (req, res) => {
    try {
        const { userId, email, phoneNumber, countryCode, type, purpose } = req.body;
        const otpType = normalizeOtpType(type);
        const otpPurpose = normalizePurpose(purpose);

        let user = null;
        if (userId) {
            user = await User.findById(userId);
        }
        if (!user) {
            user = await getUserByIdentifier({ email, phoneNumber, countryCode });
        }
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        if (otpType === 'phone' && (!user.phoneNumber || !user.countryCode)) {
            return res.status(400).json({ message: 'Phone OTP is unavailable for this account.' });
        }

        const expiresAt = await sendOtpToUser({ user, type: otpType, purpose: otpPurpose });
        return res.json({
            message: `OTP sent via ${otpType}.`,
            userId: user._id,
            expiresAt
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to send OTP.' });
    }
};

const verifyOtp = async (req, res) => {
    try {
        const { userId, otp, type, purpose } = req.body;
        const otpType = normalizeOtpType(type);
        const otpPurpose = normalizePurpose(purpose);

        if (!userId || !otp) {
            return res.status(400).json({ message: 'userId and otp are required.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const result = await validateOtp({ userId: user._id, otp, type: otpType, purpose: otpPurpose });
        if (!result.isValid) {
            return res.status(400).json({ message: result.message });
        }

        if (otpPurpose === 'signup') {
            user.isVerified = true;
            await user.save();
            return res.json({
                message: 'OTP verified successfully.',
                _id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                githubUsername: user.githubUsername,
                activeGithubUsername: user.activeGithubUsername || user.githubUsername,
                avatar: user.avatar || '',
                careerStack: user.careerStack,
                experienceLevel: user.experienceLevel,
                activeCareerStack: user.activeCareerStack || user.careerStack,
                activeExperienceLevel: user.activeExperienceLevel || user.experienceLevel,
                token: generateToken(user._id)
            });
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

const forgotPassword = async (req, res) => {
    try {
        const { email, phoneNumber, countryCode, type } = req.body;
        const otpType = normalizeOtpType(type);
        const user = await getUserByIdentifier({ email, phoneNumber, countryCode });
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        if (otpType === 'phone' && (!user.phoneNumber || !user.countryCode)) {
            return res.status(400).json({ message: 'Phone OTP is unavailable for this account.' });
        }

        const expiresAt = await sendOtpToUser({ user, type: otpType, purpose: 'forgot-password' });
        return res.json({ message: 'OTP sent for password reset.', userId: user._id, expiresAt });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to start password reset.' });
    }
};

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
        const userId = decoded?.id;
        if (!userId) {
            return res.status(400).json({ message: 'Invalid reset token.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        try {
            jwt.verify(resetToken, `${process.env.JWT_SECRET}${user.password}`);
        } catch {
            return res.status(400).json({ message: 'Reset token expired or invalid.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        return res.json({ message: 'Password reset successful.' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to reset password.' });
    }
};

module.exports = {
    registerUser,
    loginUser,
    sendOtp,
    verifyOtp,
    forgotPassword,
    resetPassword
};
