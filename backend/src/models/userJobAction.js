const mongoose = require('mongoose');

// Deterministic primary key also protects concurrent upserts before a secondary
// index is installed. Historical action records survive provider-cache expiry.
const schema = new mongoose.Schema(
  {
    _id: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: String, required: true, maxlength: 200 },
    saved: { type: Boolean, default: false },
    applied: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false }
  },
  { timestamps: true }
);
schema.index({ userId: 1, jobId: 1 }, { unique: true });
schema.index({ userId: 1, updatedAt: -1, _id: -1 });
schema.index({ userId: 1, hidden: 1, jobId: 1 });
module.exports = mongoose.model('UserJobAction', schema);
