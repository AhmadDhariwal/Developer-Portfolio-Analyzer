const {
  getRecruiterSettingsSync
} = require('../../modules/super-admin/services/platformSettingsService');

const requireRecruiterAccessEnabled = (req, res, next) => {
  try {
    const recruiterSettings = getRecruiterSettingsSync();
    if (recruiterSettings.enableRecruiterAccess === false) {
      return res.status(403).json({
        message: 'Recruiter access is currently disabled by Super Admin settings.',
        restriction: { capability: 'recruiterAccess', reason: 'platform_policy' }
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  requireRecruiterAccessEnabled
};
