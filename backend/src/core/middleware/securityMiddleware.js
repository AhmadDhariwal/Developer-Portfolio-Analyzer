const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const logger = require('../observability/logger');
const { getSettingsSnapshotSync } = require('../../modules/super-admin/services/platformSettingsService');

const coordination = require('../../modules/auth/services/authCoordinationService');
const governance = require('../../modules/integrations/services/integrationMongoGovernanceService');

const getRequestPath = (req) => String(req.path || req.originalUrl || '');

const getClientIpKey = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown_ip';
  if (typeof rateLimit.ipKeyGenerator === 'function') {
    return rateLimit.ipKeyGenerator(ip);
  }
  return String(ip);
};

const getAuthenticatedUserKey = (req) => {
  const authHeader = String(req.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web'
    });

    return decoded?.id ? `user:${decoded.id}` : null;
  } catch (err) {
    logger.debug('rate-limit token key generation failed', {
      reason: err?.message || 'unknown_error'
    });
    return null;
  }
};

const globalRateLimitKeyGenerator = (req) => {
  return getAuthenticatedUserKey(req) || `ip:${getClientIpKey(req)}`;
};

const shouldSkipGlobalRateLimit = (req) => {
  // Do not count CORS preflight requests against API quotas.
  if (req.method === 'OPTIONS') return true;

  const requestPath = getRequestPath(req);

  // Rate-limit only API routes to avoid static assets consuming quota.
  return !requestPath.startsWith('/api/');
};

const configuredGlobalLimit = Number(process.env.RATE_LIMIT_GLOBAL_MAX || 500);
const developmentGlobalLimit = Number(process.env.RATE_LIMIT_GLOBAL_MAX_DEV || Math.max(configuredGlobalLimit, 5000));
const effectiveGlobalLimit = process.env.NODE_ENV === 'development' ? developmentGlobalLimit : configuredGlobalLimit;

const controlsUnavailable = (res) => {
  res.set('Retry-After', '5');
  return res.status(503).json({ message: 'Authentication controls temporarily unavailable.' });
};

const sharedLimiter = (name, windowMs, limit, keyGenerator, skip, message) => async (req, res, next) => {
  if (skip?.(req)) return next();
  try {
    const maximum = Math.floor(typeof limit === 'function' ? limit() : limit);
    if (!Number.isSafeInteger(maximum) || maximum < 0) throw Error('Invalid authentication limit');
    const identity = coordination.hash(keyGenerator(req));
    const result = await governance.authWindow(`auth:v1:rate:${name}:${identity}`, windowMs);
    const seconds = Math.max(1, Math.ceil((result.until - Date.now()) / 1000));
    res.set('RateLimit-Policy', `${maximum};w=${windowMs / 1000}`);
    res.set('RateLimit-Limit', String(maximum));
    res.set('RateLimit-Remaining', String(Math.max(0, maximum - result.count)));
    res.set('RateLimit-Reset', String(seconds));
    if (result.count > maximum) {
      res.set('Retry-After', String(seconds));
      return res.status(429).json({ message });
    }
    return next();
  } catch {
    return controlsUnavailable(res);
  }
};

const globalRateLimiter = sharedLimiter(
  'global',
  15 * 60000,
  () => Number(getSettingsSnapshotSync()?.security?.globalRateLimitMax || effectiveGlobalLimit),
  globalRateLimitKeyGenerator,
  shouldSkipGlobalRateLimit,
  'Too many requests. Please try again later.'
);
const authRateLimiter = sharedLimiter(
  'authentication',
  10 * 60000,
  Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
  getClientIpKey,
  null,
  'Too many authentication attempts. Please try again later.'
);

const bruteForceGuard = async (req, res, next) => {
  try {
    const until = await coordination.blockedUntil(req);
    if (until <= Date.now()) return next();
    const waitSec = Math.ceil((until - Date.now()) / 1000);
    return res
      .status(429)
      .json({ message: `Account temporarily locked due to repeated failed logins. Try again in ${waitSec}s.` });
  } catch {
    return controlsUnavailable(res);
  }
};

const registerAuthFailure = (req) => coordination.failure(req, getSettingsSnapshotSync()?.security || {});
const clearAuthFailures = (req) => coordination.clear(req);

module.exports = {
  globalRateLimiter,
  authRateLimiter,
  bruteForceGuard,
  registerAuthFailure,
  clearAuthFailures
};
