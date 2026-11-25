const mongoose = require('mongoose');

const invalidInput = (message) => Object.assign(new Error(message), { statusCode: 400, code: 400 });

const requireObjectId = (value, field) => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw invalidInput(`${field} must be a valid ObjectId.`);
  }
  return String(value).toLowerCase();
};

const validateCandidateIds = (value, limit = 500) => {
  if (!Array.isArray(value) || value.length > limit) {
    throw invalidInput(`candidateIds must be an array with at most ${limit} entries.`);
  }
  return [...new Set(value.map((id) => requireObjectId(id, 'candidateId')))];
};

module.exports = { requireObjectId, validateCandidateIds, invalidInput };
