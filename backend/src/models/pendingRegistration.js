const mongoose = require('mongoose');

/**
 * Temporary store for registrations awaiting OTP verification.
 * Documents auto-expire after 10 minutes via the TTL index on `expiresAt`.
 * Once OTP is verified, the real User document is created and this record is deleted.
 */
const pendingRegistrationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    name: { type: String, required: true },
    hashedPassword: { type: String, required: true },
    githubUsername: { type: String, required: true },
    phoneNumber: { type: String, default: '' },
    countryCode: { type: String, default: '' },
    otpType: { type: String, enum: ['email', 'phone'], default: 'email' },
    isPublic: { type: Boolean, default: false },
    otp: { type: String, required: true },          // hashed OTP
    otpAttempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

// Auto-delete documents after expiresAt
pendingRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingRegistration', pendingRegistrationSchema);
