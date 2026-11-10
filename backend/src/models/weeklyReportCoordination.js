const mongoose = require('mongoose');

// TTL is cleanup only. Claims always compare expiration explicitly.
const schema = new mongoose.Schema(
  {
    _id: String,
    token: String,
    cursor: String,
    completed: Boolean,
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, bufferCommands: false },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('WeeklyReportCoordination', schema);
