const { createHash } = require('node:crypto');
const admission = require('../services/integrationMongoGovernanceService');
const telemetry = require('../services/requestAdmissionMetrics');

// Keep the existing factory signature for callers. All Portfolio limits now use
// one shared authority; strict=false no longer enables process-local allowances.
function limiter(name, limit, windowMs, _strict = false) {
  return async (req, res, next) => {
    // Preserve account/IP/recipient-slug identities. Express owns proxy trust.
    const subject =
      name === 'contact-recipient' ? req.params.slug : req.user?._id || req.ip || 'unknown';
    const identity = createHash('sha256').update(String(subject)).digest('hex');
    let result;
    const startedAt = process.hrtime.bigint();
    try {
      result = await admission.requestWindow(
        `public-portfolio:v3:rate:${name}:${identity}`,
        limit,
        windowMs
      );
    } catch {
      telemetry.record(name, 'unavailable', startedAt);
      res.set('Retry-After', '30');
      return res
        .status(503)
        .json({ message: 'Portfolio action controls temporarily unavailable.' });
    }
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - result.count)));
    if (result.count > limit) {
      telemetry.record(name, 'limited', startedAt);
      res.set('Retry-After', String(Math.max(1, Math.ceil((result.until - Date.now()) / 1000))));
      return res.status(429).json({ message: 'Too many portfolio requests. Please retry later.' });
    }
    telemetry.record(name, 'allowed', startedAt);
    return next();
  };
}
module.exports = {
  limiter,
  publicViewLimit: limiter('view', 60, 60000),
  resumeLimit: limiter('resume', 10, 60000),
  analyticsLimit: limiter('analytics', 30, 60000),
  mutationLimit: limiter('mutation', 20, 60000),
  uploadLimit: limiter('upload', 10, 3600000, true),
  contactRecipientLimit: limiter('contact-recipient', 20, 86400000, true),
  contactLimit: limiter('contact', 3, 3600000, true)
};
