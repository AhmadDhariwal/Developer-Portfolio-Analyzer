const mongoose = require('mongoose');
// Durable cleanup receipt written in the account deletion transaction. No TTL:
// failed cleanup must remain retryable until storage is available again.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true },
  resumeUrls: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('AccountDeletionCleanup', schema);
