const Otp = require('../models/otp');
const { generateOtp } = require('../utils/otpGenerator');
const { hashValue, matchesHashedValue } = require('../utils/hash');

const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 3;

const createOtp = async ({ userId, type, purpose = 'signup' }) => {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await Otp.findOneAndUpdate(
    { userId, type, purpose },
    {
      $set: {
        otp: hashValue(otp),
        expiresAt,
        attempts: 0
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { otp, expiresAt };
};

const validateOtp = async ({ userId, otp, type, purpose = 'signup' }) => {
  const entry = await Otp.findOne({ userId, type, purpose });
  if (!entry) {
    return { isValid: false, message: 'OTP not found. Please request a new one.' };
  }

  if (entry.expiresAt.getTime() < Date.now()) {
    await Otp.deleteOne({ _id: entry._id });
    return { isValid: false, message: 'OTP has expired. Please request a new one.' };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    await Otp.deleteOne({ _id: entry._id });
    return { isValid: false, message: 'Maximum OTP attempts reached. Request a new OTP.' };
  }

  if (!matchesHashedValue(otp, entry.otp)) {
    entry.attempts += 1;
    await entry.save();
    return { isValid: false, message: 'Invalid OTP.' };
  }

  await Otp.deleteOne({ _id: entry._id });
  return { isValid: true };
};

module.exports = {
  createOtp,
  validateOtp,
  OTP_EXPIRY_MINUTES,
  MAX_ATTEMPTS
};
