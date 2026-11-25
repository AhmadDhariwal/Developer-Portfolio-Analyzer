const mongoose = require('mongoose');

const emailDeliveryJobSchema = new mongoose.Schema(
  {
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invitation',
      required: true,
      unique: true,
      index: true
    },
    to: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'retrying', 'sent', 'failed'],
      default: 'pending',
      index: true
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
      max: 20
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    lastProvider: {
      type: String,
      default: null,
      trim: true
    },
    lastError: {
      type: String,
      default: null,
      trim: true
    },
    sentAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

emailDeliveryJobSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('EmailDeliveryJob', emailDeliveryJobSchema);
