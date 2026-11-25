const mongoose = require('mongoose');

// Isolated from bank content and user history. Expiration is checked on every
// operation; the TTL monitor is storage cleanup, never a correctness clock.
const schema = new mongoose.Schema(
  {
    _id: String,
    token: String,
    count: Number,
    value: mongoose.Schema.Types.Mixed,
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false, bufferCommands: false }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('InterviewCoordination', schema);
