const crypto = require('node:crypto');

const requestContextMiddleware = (req, res, next) => {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  req.requestId = incoming || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

module.exports = { requestContextMiddleware };
