const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    otp: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['email', 'phone'],
      required: true
    },
    purpose: {
      type: String,
      enum: ['signup', 'forgot-password'],
      default: 'signup'
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    attempts: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ userId: 1, type: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model('Otp', otpSchema);
