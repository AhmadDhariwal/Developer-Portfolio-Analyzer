const { getSettingsSnapshotSync } = require('../services/platformSettingsService');

const getSecurityPolicy = () => getSettingsSnapshotSync()?.security || {};

const buildPasswordPolicyMessage = (security = getSecurityPolicy()) => {
  const minLength = Number(security.passwordMinLength || 6);
  if (security.requireStrongPassword) {
    return `Password must be at least ${minLength} characters and include uppercase, lowercase, number, and special character.`;
  }
  return `Password must be at least ${minLength} characters.`;
};

const validatePasswordAgainstPolicy = (password) => {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 72)
    return { valid: false, message: 'Password must be a string of at most 72 UTF-8 bytes.' };
  const security = getSecurityPolicy();
  const minLength = Number(security.passwordMinLength || 6);
  const normalizedPassword = String(password || '');

  if (normalizedPassword.length < minLength) {
    return {
      valid: false,
      message: buildPasswordPolicyMessage(security)
    };
  }

  if (security.requireStrongPassword) {
    const hasUppercase = /[A-Z]/.test(normalizedPassword);
    const hasLowercase = /[a-z]/.test(normalizedPassword);
    const hasNumber = /\d/.test(normalizedPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(normalizedPassword);

    if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      return {
        valid: false,
        message: buildPasswordPolicyMessage(security)
      };
    }
  }

  return { valid: true, message: '' };
};

module.exports = {
  getSecurityPolicy,
  buildPasswordPolicyMessage,
  validatePasswordAgainstPolicy
};
