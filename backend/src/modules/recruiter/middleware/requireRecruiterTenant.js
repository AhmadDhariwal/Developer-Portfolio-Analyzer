const { normalizeUserRole } = require('../../../core/middleware/authmiddleware');

const requireRecruiterTenant = (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  if (normalizeUserRole(req.user?.role) !== 'recruiter') {
    return res.status(403).json({ message: 'A recruiter account is required for this workspace.' });
  }
  return next();
};

module.exports = { requireRecruiterTenant };
