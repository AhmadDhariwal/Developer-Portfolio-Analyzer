const mongoose = require('mongoose');

// Receipts survive inbox deletion. Sliding-window keys reuse one document;
// stable event keys never expire. No unapproved retention policy is applied.
const schema = new mongoose.Schema(
  {
    _id: String,
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    notificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    until: { type: Date, default: null }
  },
  { versionKey: false }
);
schema.index({ userId: 1 });
module.exports = mongoose.model('NotificationReceipt', schema);
