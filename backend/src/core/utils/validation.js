/**
 * Shared validation and sanitization helpers.
 */
const mongoose = require('mongoose');

const escapeRegex = (value = '') =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

module.exports = {
  escapeRegex,
  isValidObjectId,
};

