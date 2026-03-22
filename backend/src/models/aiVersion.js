const mongoose = require('mongoose');

const aiVersionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'manual'
    },
    version: {
      type: Number,
      required: true
    },
    outputJson: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    versionKey: false
  }
);

aiVersionSchema.index({ userId: 1, source: 1, version: -1 }, { unique: true });

module.exports = mongoose.model('AIVersion', aiVersionSchema);
