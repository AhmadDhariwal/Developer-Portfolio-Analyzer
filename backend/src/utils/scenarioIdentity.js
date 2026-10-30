'use strict';

const { createHash } = require('node:crypto');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stable = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort(compare)
        .map((key) => [key, stable(value[key])]),
    );
  return value;
};
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
module.exports = { compare, stable, digest };
