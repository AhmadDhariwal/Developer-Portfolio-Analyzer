const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const tokens = require('../services/integrationTokenService');

test('durable key configuration survives reload and retains credentials encrypted by older keys', (t) => {
  const originalKeys = process.env.INTEGRATION_TOKEN_KEYS;
  const originalActive = process.env.INTEGRATION_TOKEN_ACTIVE_KEY;
  t.after(() => {
    for (const [name, value] of [
      ['INTEGRATION_TOKEN_KEYS', originalKeys],
      ['INTEGRATION_TOKEN_ACTIVE_KEY', originalActive]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const oldKey = crypto.randomBytes(32).toString('base64');
  process.env.INTEGRATION_TOKEN_KEYS = JSON.stringify({ previous: oldKey });
  process.env.INTEGRATION_TOKEN_ACTIVE_KEY = 'previous';
  const envelope = tokens.encrypt('test-only-credential', 'owner', 'github', 'accessToken');
  process.env.INTEGRATION_TOKEN_KEYS = JSON.stringify({
    previous: oldKey,
    current: crypto.randomBytes(32).toString('base64')
  });
  process.env.INTEGRATION_TOKEN_ACTIVE_KEY = 'current';
  delete require.cache[require.resolve('../services/integrationTokenService')];
  const reloaded = require('../services/integrationTokenService');
  assert.equal(
    reloaded.decrypt(envelope, 'owner', 'github', 'accessToken'),
    'test-only-credential'
  );
  assert.throws(() => reloaded.decrypt(envelope, 'other-owner', 'github', 'accessToken'));
  process.env.INTEGRATION_TOKEN_KEYS = JSON.stringify({
    current: crypto.randomBytes(32).toString('base64')
  });
  assert.throws(() => reloaded.decrypt(envelope, 'owner', 'github', 'accessToken'));
  assert.equal(envelope.startsWith('enc:v1:previous:'), true);
});
