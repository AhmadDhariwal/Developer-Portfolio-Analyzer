const mongoose = require('mongoose');
// Durable cleanup receipt written in the account deletion transaction. No TTL:
// failed cleanup must remain retryable until storage is available again.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true },
  resumeUrls: [{ type: String }],
  retryAfter: { type: Date, default: () => new Date(0) },
  cleanupAttempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ retryAfter: 1, createdAt: 1, _id: 1 });
module.exports = mongoose.model('AccountDeletionCleanup', schema);
