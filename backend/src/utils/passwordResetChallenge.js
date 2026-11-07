const crypto = require('node:crypto');
const PREFIX = 'reset-v1.';
function key() {
  if (!process.env.JWT_SECRET) throw Error('JWT signing secret is required.');
  return crypto
    .createHash('sha256')
    .update('devinsight:password-reset-challenge:' + process.env.JWT_SECRET)
    .digest();
}
function create(owner, expiresAt) {
  const id = owner ? String(owner) : crypto.randomBytes(12).toString('hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const content = Buffer.concat([
    cipher.update(JSON.stringify({ id, expires: new Date(expiresAt).getTime() })),
    cipher.final()
  ]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64url');
}
function resolve(value) {
  const raw = String(value || '');
  // Retain compatibility with already issued OTP flows. All failures below use
  // the same public response; a caller cannot probe account existence by ID.
  if (/^[a-f0-9]{24}$/i.test(raw)) return raw;
  if (!raw.startsWith(PREFIX) || raw.length > 512) return null;
  try {
    const data = Buffer.from(raw.slice(PREFIX.length), 'base64url');
    if (data.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()
    );
    return /^[a-f0-9]{24}$/i.test(payload.id) && payload.expires > Date.now()
      ? payload.id
      : null;
  } catch {
    return null;
  }
}
module.exports = { create, resolve };
