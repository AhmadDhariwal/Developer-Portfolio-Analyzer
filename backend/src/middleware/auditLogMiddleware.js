const jwt = require('jsonwebtoken');
const AuditLog = require('../models/auditLog');
const Team = require('../models/team');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /otp/i,
  /passcode/i,
  /pwd/i,
  /pass[_-]?phrase/i,
  /private[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i
];

const maskValue = (key, value) => {
  if (typeof key === 'string' && SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return '***MASKED***';
  }
  if (typeof value === 'object' && value !== null) {
    return deepMask(value);
  }
  return value;
};

const deepMask = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map((item) => (typeof item === 'object' && item !== null ? deepMask(item) : maskValue('', item)));
  }
  if (typeof obj !== 'object' || obj === null) return obj;

  const masked = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = typeof key === 'string' && SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      masked[key] = '***MASKED***';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = deepMask(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
};

const trimPayload = (value, maxLen = 5000) => {
  if (value === null || value === undefined) return value;
  const masked = deepMask(value);
  try {
    const text = JSON.stringify(masked);
    if (text.length <= maxLen) return masked;
    return { __truncated: true, preview: text.slice(0, maxLen) };
  } catch {
    return { __nonSerializable: true };
  }
};

const resolveActorFromToken = (req) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.id || null;
  } catch {
    return null;
  }
};

const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(String(value || ''));

const firstValidObjectId = (...values) => {
  for (const value of values) {
    if (isObjectId(value)) return String(value);
  }
  return null;
};

const parseObjectIdFromUrl = (url, segment) => {
  const match = String(url || '').match(new RegExp(`/${segment}/([0-9a-fA-F]{24})`, 'i'));
  return match?.[1] || null;
};

const resolveScope = async (req) => {
  let organizationId = firstValidObjectId(
    req.body?.organizationId,
    req.query?.organizationId,
    req.params?.organizationId,
    req.organizationId,
    req.tenantContext?.organizationId,
    req.user?.organizationId,
    parseObjectIdFromUrl(req.originalUrl, 'organizations')
  );

  const teamId = firstValidObjectId(
    req.body?.teamId,
    req.query?.teamId,
    req.params?.teamId,
    parseObjectIdFromUrl(req.originalUrl, 'teams')
  );

  if (!organizationId && teamId) {
    const team = await Team.findById(teamId).select('organizationId').lean();
    organizationId = team?.organizationId ? String(team.organizationId) : null;
  }

  return { organizationId, teamId };
};

const auditLogMiddleware = (req, res, next) => {
  if (!MUTATION_METHODS.has(req.method)) return next();
  if (!req.originalUrl.startsWith('/api/')) return next();

  const actor = req.user?._id || resolveActorFromToken(req) || null;
  const ipAddress = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0]?.trim() || null;
  const userAgent = req.headers['user-agent']?.slice(0, 500) || null;

  const before = {
    params: req.params || {},
    query: req.query || {},
    body: req.body || {}
  };

  let responseBody = null;
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    responseBody = payload;
    return originalJson(payload);
  };

  res.on('finish', async () => {
    try {
      const action = `${req.method} ${req.baseUrl || ''}${req.path || ''}`.trim();
      const { organizationId, teamId } = await resolveScope(req);
      await AuditLog.create({
        actor,
        organizationId,
        teamId,
        action,
        method: req.method,
        route: req.originalUrl,
        before: trimPayload(before),
        after: trimPayload(responseBody),
        statusCode: res.statusCode,
        ipAddress,
        userAgent,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Audit log write error:', error.message);
    }
  });

  next();
};

module.exports = { auditLogMiddleware };