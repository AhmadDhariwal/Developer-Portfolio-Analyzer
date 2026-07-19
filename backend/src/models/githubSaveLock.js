const mongoose = require('mongoose');

const githubSaveLockSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerToken: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

githubSaveLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('GitHubSaveLock', githubSaveLockSchema);
