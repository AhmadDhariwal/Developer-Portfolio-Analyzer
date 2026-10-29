'use strict';
const crypto = require('node:crypto');
const PREFIX = 'enc:v1:';
function keyring() {
  let keys;
  try {
    keys = JSON.parse(process.env.INTEGRATION_TOKEN_KEYS || '{}');
  } catch {
    throw Error('Integration token key configuration is invalid.');
  }
  const active = process.env.INTEGRATION_TOKEN_ACTIVE_KEY || '';
  if (
    !/^[a-zA-Z0-9_-]{1,40}$/.test(active) ||
    !keys ||
    Array.isArray(keys) ||
    !Object.hasOwn(keys, active)
  )
    throw Error('Integration token key configuration is required.');
  const decoded = {};
  for (const [id, value] of Object.entries(keys)) {
    if (
      !/^[a-zA-Z0-9_-]{1,40}$/.test(id) ||
      typeof value !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(value)
    )
      throw Error('Integration token key configuration is invalid.');
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32) throw Error('Integration token key configuration is invalid.');
    decoded[id] = key;
  }
  return { active, keys: decoded };
}
const aad = (owner, provider, field) =>
  Buffer.from(JSON.stringify(['devinsight-integrations-v1', String(owner), provider, field]));
function encrypt(value, owner, provider, field) {
  if (!value) return '';
  const { active, keys } = keyring();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys[active], iv);
  cipher.setAAD(aad(owner, provider, field));
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return (
    PREFIX +
    [
      active,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url')
    ].join(':')
  );
}
function decrypt(value, owner, provider, field) {
  if (!value) return '';
  // Plaintext is accepted only by the explicit offline migration, never runtime.
  if (!String(value).startsWith(PREFIX)) throw Error('Integration credentials require migration.');
  try {
    const parts = String(value).slice(PREFIX.length).split(':');
    if (parts.length !== 4) throw Error();
    const [id, nonce, tag, body] = parts;
    const key = keyring().keys[id];
    const iv = Buffer.from(nonce, 'base64url');
    const authTag = Buffer.from(tag, 'base64url');
    if (!key || iv.length !== 12 || authTag.length !== 16) throw Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad(owner, provider, field));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw Error('Integration credentials could not be decrypted.');
  }
}
function seal(connection) {
  return Object.fromEntries(
    ['accessToken', 'refreshToken'].map((field) => [
      field,
      encrypt(connection[field], connection.userId, connection.provider, field)
    ])
  );
}
function open(connection) {
  return {
    ...connection,
    ...Object.fromEntries(
      ['accessToken', 'refreshToken'].map((field) => [
        field,
        decrypt(connection[field], connection.userId, connection.provider, field)
      ])
    )
  };
}
module.exports = { encrypt, decrypt, seal, open, keyring, PREFIX };
