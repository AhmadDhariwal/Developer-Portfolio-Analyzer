const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  viewerHash: { type: String, required: true },
  viewedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
});
schema.index({ profileId: 1, viewerHash: 1 }, { unique: true });
schema.index({ profileId: 1, viewedAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('PublicPortfolioVisit', schema);
