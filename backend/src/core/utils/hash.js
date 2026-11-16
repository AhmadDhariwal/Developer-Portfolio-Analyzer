const crypto = require('node:crypto');

const hashValue = (value) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex');

const matchesHashedValue = (value, hashed) => hashValue(value) === String(hashed || '');

module.exports = { hashValue, matchesHashedValue };
