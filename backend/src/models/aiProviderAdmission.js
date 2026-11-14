const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    _id: String,
    token: String,
    count: { type: Number, default: 0 },
    openUntil: Date,
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false, bufferCommands: false }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ai_admission_expiry' });
module.exports = mongoose.model('AIProviderAdmission', schema);
