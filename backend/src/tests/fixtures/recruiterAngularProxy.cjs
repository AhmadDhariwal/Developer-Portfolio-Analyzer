const assert = require('node:assert/strict');
const target = process.env.DPA_TEST_API_ORIGIN;
assert.match(target || '', /^http:\/\/127\.0\.0\.1:\d+$/);
module.exports = { '/api/**': { target, secure: false } };
