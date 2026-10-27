const mongoose = require('mongoose');

// User-entered references are deliberately outside connections and evidence collections.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['hackerrank', 'kaggle'], required: true },
    username: { type: String, required: true, maxlength: 100 },
    profileUrl: { type: String, required: true, maxlength: 300 }
  },
  { timestamps: true }
);
schema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('IntegrationLinkedProfile', schema);
