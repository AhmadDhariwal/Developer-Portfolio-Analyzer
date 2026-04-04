const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const loginAttemptStore = new Map();

const cleanupAttempts = () => {
  const now = Date.now();
  const ttl = 30 * 60 * 1000;
  for (const [key, entry] of loginAttemptStore.entries()) {
    if (now - entry.lastAttemptAt > ttl) {
      loginAttemptStore.delete(key);
    }
  }
};

const makeLoginKey = (req) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${ip}:${email}`;
};

const getRequestPath = (req) => String(req.path || req.originalUrl || '');

const getClientIpKey = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded)
    ? String(forwarded[0] || '').split(',')[0].trim()
    : String(forwarded || '').split(',')[0].trim();
  const ip = req.ip || forwardedIp || req.socket?.remoteAddress || 'unknown_ip';
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

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: effectiveGlobalLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: globalRateLimitKeyGenerator,
  skip: shouldSkipGlobalRateLimit,
  message: { message: 'Too many requests. Please try again later.' }
});

const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' }
});

const bruteForceGuard = (req, res, next) => {
  cleanupAttempts();

  const key = makeLoginKey(req);
  const entry = loginAttemptStore.get(key);
  if (!entry) return next();

  if (!entry.blockedUntil || entry.blockedUntil <= Date.now()) return next();

  const waitSec = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
  return res.status(429).json({
    message: `Account temporarily locked due to repeated failed logins. Try again in ${waitSec}s.`
  });
};

const registerAuthFailure = (req) => {
  const key = makeLoginKey(req);
  const now = Date.now();

  const maxFailures = Number(process.env.BRUTE_FORCE_MAX_ATTEMPTS || 6);
  const lockoutMs = Number(process.env.BRUTE_FORCE_LOCKOUT_MS || 10 * 60 * 1000);

  const entry = loginAttemptStore.get(key) || { count: 0, lastAttemptAt: now, blockedUntil: 0 };
  entry.count += 1;
  entry.lastAttemptAt = now;

  if (entry.count >= maxFailures) {
    entry.blockedUntil = now + lockoutMs;
    logger.warn('brute-force protection triggered', {
      key,
      attempts: entry.count,
      lockoutMs
    });
  }

  loginAttemptStore.set(key, entry);
};

const clearAuthFailures = (req) => {
  const key = makeLoginKey(req);
  loginAttemptStore.delete(key);
};

module.exports = {
  globalRateLimiter,
  authRateLimiter,
  bruteForceGuard,
  registerAuthFailure,
  clearAuthFailures
};
