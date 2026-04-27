const jwt = require('jsonwebtoken');
const User = require('../models/user');

const normalizeUserRole = (role) => {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'user') return 'developer';
    return normalized;
};

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
        try {
            // Get token from header
            token = req.headers.authorization.split(' ')[1];

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET, {
                algorithms: ['HS256'],
                issuer: process.env.JWT_ISSUER || 'devinsight-api',
                audience: process.env.JWT_AUDIENCE || 'devinsight-web'
            });

            // Get user from the token
            req.user = await User.findById(decoded.id).select('-password');

            if (!req.user) {
                return res.status(401).json({ message: 'Not authorized, user not found' });
            }

            if (req.user.isActive === false) {
                return res.status(403).json({ message: 'Account is deactivated. Please contact your administrator.' });
            }

            req.user.careerStack = req.user.activeCareerStack || req.user.careerStack;
            req.user.experienceLevel = req.user.activeExperienceLevel || req.user.experienceLevel;

            next();
        } catch (error) {
            console.error(error);
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
};

const authorizeRoles = (...roles) => {
    const allowed = new Set((roles || []).map((role) => String(role || '').toLowerCase()));

    return (req, res, next) => {
        const currentRole = normalizeUserRole(req.user?.role);

        if (!allowed.has(currentRole)) {
            return res.status(403).json({ message: 'Forbidden: insufficient role permissions.' });
        }

        return next();
    };
};

module.exports = { protect, authorizeRoles, normalizeUserRole };
