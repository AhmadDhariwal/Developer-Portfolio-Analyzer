const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  key: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  freshUntil: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('PublicProfileCache', schema);
