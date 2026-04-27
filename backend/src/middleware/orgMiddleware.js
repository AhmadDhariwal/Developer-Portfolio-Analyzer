const User = require('../models/user');
const Membership = require('../models/membership');
const { normalizeUserRole } = require('./authmiddleware');

const Organization = require('../models/organization');

const resolveMembershipContext = async (userId) => {
  if (!userId) return null;

  try {
    const membership = await Membership.findOne({
      userId,
      status: 'active'
    })
      .sort({ updatedAt: -1 })
      .select('organizationId role')
      .lean();

    if (!membership?.organizationId) return null;

    // Validate that organizationId is a valid ObjectId
    const orgIdStr = String(membership.organizationId);
    if (orgIdStr === 'local' || !orgIdStr.match(/^[0-9a-fA-F]{24}$/)) {
      console.warn(`Invalid organizationId found in membership: ${orgIdStr}. Cleaning up...`);
      // Remove invalid membership record
      await Membership.deleteOne({ _id: membership._id });
      return null;
    }

    return {
      organizationId: orgIdStr,
      membershipRole: String(membership.role || 'member')
    };
  } catch (error) {
    console.error('Organization RBAC error:', error.message);
    return null;
  }
};

const resolveOrganizationContext = async (user) => {
  if (!user?._id) return null;

  try {
    const safeRole = normalizeUserRole(user.role);
    const fallbackUser = await User.findById(user._id)
      .select('organizationId role')
      .lean();

    const rawOrgId = String(
      user.organizationId ||
      fallbackUser?.organizationId ||
      ''
    ).trim();

    // Valid ObjectId — use it directly
    if (rawOrgId && rawOrgId !== 'local' && rawOrgId.match(/^[0-9a-fA-F]{24}$/)) {
      return { organizationId: rawOrgId, role: safeRole, membershipRole: null };
    }

    // If organizationId is "local" or invalid, clear it from user record
    if (rawOrgId === 'local' || (rawOrgId && !rawOrgId.match(/^[0-9a-fA-F]{24}$/))) {
      console.warn(`Invalid organizationId "${rawOrgId}" found for user ${user._id}. Clearing...`);
      await User.findByIdAndUpdate(user._id, { $unset: { organizationId: 1 } });
    }

    // Admin with no organizationId stored — find the org they own/belong to
    if (safeRole === 'admin') {
      const ownedOrg = await Organization.findOne({ ownerId: user._id })
        .select('_id')
        .lean();
      if (ownedOrg) {
        return { organizationId: String(ownedOrg._id), role: safeRole, membershipRole: null };
      }
    }

    // Fall back to membership lookup
    const membership = await resolveMembershipContext(user._id);
    if (!membership) return null;

    return {
      organizationId: membership.organizationId,
      role: safeRole,
      membershipRole: membership.membershipRole
    };
  } catch (error) {
    console.error('Organization context resolution error:', error.message);
    return null;
  }
};

const requireOrganizationContext = (allowedRoles = []) => {
  const roleSet = new Set((allowedRoles || []).map((value) => String(value || '').toLowerCase()));

  return async (req, res, next) => {
    try {
      const role = normalizeUserRole(req.user?.role);

      if (roleSet.size > 0 && !roleSet.has(role)) {
        return res.status(403).json({ message: 'Forbidden: insufficient role permissions.' });
      }

      // Admin users are org-level owners — resolve their org from DB or membership
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
