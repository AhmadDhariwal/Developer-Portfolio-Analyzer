// Optional explicit guard for super_admin endpoints (kept minimal)
const protect = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }
  next();
};

const ensureSuperAdmin = (req, res, next) => {
  const role = (req.user?.role || '').toString().toLowerCase();
  if (role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ message: 'Forbidden: requires super_admin role' });
};

module.exports = {
  protect,
  ensureSuperAdmin
};
