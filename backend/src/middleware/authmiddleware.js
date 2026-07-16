const jwt = require('jsonwebtoken');
const User = require('../models/user');

const normalizeUserRole = (role) => {
    const normalized = String(role || '').toLowerCase();
    // Normalize legacy mappings if exist
    if (normalized === 'user' || normalized === 'guest') return 'developer';
    // Support potential hyphenated/underscore variants for super admin
    if (normalized === 'super-admin') return 'super_admin';
    if (normalized === 'superadmin') return 'super_admin';
    if (normalized === 'super_admin') return 'super_admin';
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
                return res.status(403).json({ message: 'Your access has been revoked by Super Admin. Please contact support.' });
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

const attachOptionalUser = async (req, _res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return next();

    try {
        const token = authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
            issuer: process.env.JWT_ISSUER || 'devinsight-api',
            audience: process.env.JWT_AUDIENCE || 'devinsight-web'
        });
        const user = await User.findById(decoded.id).select('-password');
        if (user?.isActive !== false) req.user = user || undefined;
    } catch {
        // Public routes remain accessible without a valid token; protected preview checks handle the absence of req.user.
    }

    return next();
};

const authorizeRoles = (...roles) => {
    const allowed = new Set((roles || []).map((role) => String(role || '').toLowerCase()));

    return (req, res, next) => {
        // Global Super Admin bypass: if user is super_admin, allow all actions
        const currentRawRole = req.user?.role;
        const currentRole = normalizeUserRole(currentRawRole);
        if (currentRole === 'super_admin') {
            return next();
        }

        if (!allowed.has(currentRole)) {
            return res.status(403).json({ message: 'Forbidden: insufficient role permissions.' });
        }

        return next();
    };
};

const optionalProtect = (req, res, next) => {
  const isTemporary = req.body?.isTemporary === true || req.body?.isTemporary === 'true';
  const authHeader = req.headers.authorization;

  if (isTemporary) {
    if (authHeader) {
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Not authorized, malformed token' });
      }
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ['HS256'],
          issuer: process.env.JWT_ISSUER || 'devinsight-api',
          audience: process.env.JWT_AUDIENCE || 'devinsight-web'
        });
        User.findById(decoded.id).select('-password').then((user) => {
          if (!user) {
            return res.status(401).json({ message: 'Not authorized, user not found' });
          }
          if (user.isActive === false) {
            return res.status(403).json({ message: 'Your access has been revoked by Super Admin. Please contact support.' });
          }
          req.user = user;
          req.user.careerStack = req.user.activeCareerStack || req.user.careerStack;
          req.user.experienceLevel = req.user.activeExperienceLevel || req.user.experienceLevel;
          next();
        }).catch((err) => {
          console.error(err);
          res.status(500).json({ message: 'Server Error during authentication' });
        });
      } catch (error) {
        return res.status(401).json({ message: 'Not authorized, token failed or expired' });
      }
    } else {
      next();
    }
  } else {
    protect(req, res, next);
  }
};

module.exports = { protect, authorizeRoles, normalizeUserRole, optionalProtect, attachOptionalUser };
