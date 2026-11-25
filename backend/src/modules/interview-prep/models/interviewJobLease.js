const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    _id: String,
    ownerToken: { type: String, required: true },
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('InterviewJobLease', schema);
