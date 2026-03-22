const jwt = require('jsonwebtoken');
const AuditLog = require('../models/auditLog');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE']);

const trimPayload = (value, maxLen = 5000) => {
  if (value === null || value === undefined) return value;
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxLen) return value;
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

const auditLogMiddleware = (req, res, next) => {
  if (!MUTATION_METHODS.has(req.method)) return next();
  if (!req.originalUrl.startsWith('/api/')) return next();

  const actor = req.user?._id || resolveActorFromToken(req) || null;
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
      await AuditLog.create({
        actor,
        action,
        method: req.method,
        route: req.originalUrl,
        before: trimPayload(before),
        after: trimPayload(responseBody),
        statusCode: res.statusCode,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Audit log write error:', error.message);
    }
  });

  next();
};

module.exports = { auditLogMiddleware };
