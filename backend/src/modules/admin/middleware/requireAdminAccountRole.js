const { normalizeUserRole } = require('../../../core/middleware/authmiddleware');

const requireAdminAccountRole = (req, res, next) => {
  if (normalizeUserRole(req.user?.role) !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: organization Admin account role required.' });
  }

  return next();
};

module.exports = requireAdminAccountRole;
