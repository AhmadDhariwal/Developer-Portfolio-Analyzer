const User = require('../models/user');
const Membership = require('../models/membership');
const { normalizeUserRole } = require('./authmiddleware');

const resolveMembershipContext = async (userId) => {
  if (!userId) return null;

  const membership = await Membership.findOne({
    userId,
    status: 'active'
  })
    .sort({ updatedAt: -1 })
    .select('organizationId role')
    .lean();

  if (!membership?.organizationId) return null;

  return {
    organizationId: String(membership.organizationId),
    membershipRole: String(membership.role || 'member')
  };
};

const resolveOrganizationContext = async (user) => {
  if (!user?._id) return null;

  const safeRole = normalizeUserRole(user.role);
  const fallbackUser = await User.findById(user._id)
    .select('organizationId role')
    .lean();

  const organizationId = String(
    user.organizationId ||
    fallbackUser?.organizationId ||
    ''
  ).trim();

  if (organizationId) {
    return {
      organizationId,
      role: safeRole,
      membershipRole: null
    };
  }

  const membership = await resolveMembershipContext(user._id);
  if (!membership) return null;

  return {
    organizationId: membership.organizationId,
    role: safeRole,
    membershipRole: membership.membershipRole
  };
};

const requireOrganizationContext = (allowedRoles = []) => {
  const roleSet = new Set((allowedRoles || []).map((value) => String(value || '').toLowerCase()));

  return async (req, res, next) => {
    try {
      const role = normalizeUserRole(req.user?.role);

      if (roleSet.size > 0 && !roleSet.has(role)) {
        return res.status(403).json({ message: 'Forbidden: insufficient role permissions.' });
      }

      const context = await resolveOrganizationContext(req.user);
      if (!context?.organizationId) {
        return res.status(403).json({ message: 'Organization context is required for this resource.' });
      }

      req.organizationId = context.organizationId;
      req.tenantContext = {
        ...req.tenantContext,
        organizationId: context.organizationId,
        membershipRole: context.membershipRole,
        role
      };

      return next();
    } catch (error) {
      console.error('Organization middleware error:', error.message);
      return res.status(500).json({ message: 'Failed to resolve organization context.' });
    }
  };
};

module.exports = {
  resolveOrganizationContext,
  requireOrganizationContext
};
