const jwt = require('jsonwebtoken');
const { getSettingsSnapshotSync } = require('../services/platformSettingsService');
function sign(user, expiresIn) {
  return jwt.sign(
    { id: user._id, sessionRevision: Number(user.sessionRevision || 0) },
    process.env.JWT_SECRET,
    {
      expiresIn:
        expiresIn ||
        getSettingsSnapshotSync()?.security?.jwtExpiresIn ||
        process.env.JWT_EXPIRES_IN ||
        '20h',
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web'
    }
  );
}
function matches(user, decoded) {
  return Number(user?.sessionRevision || 0) === Number(decoded?.sessionRevision || 0);
}
module.exports = { sign, matches };
