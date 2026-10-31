const mongoose = require('mongoose');

// Durable invalidation cursor, committed with every inbox mutation.
const schema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revision: { type: Number, default: 0 },
    changedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

module.exports = mongoose.model('NotificationState', schema);
