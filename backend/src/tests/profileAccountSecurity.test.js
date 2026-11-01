const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { load, response } = require('./fixtures/publicPortfolioFixture');
const challenges = require('../utils/passwordResetChallenge');
function auth(models = {}, services = {}) {
  return load('controllers/authcontroller.js', {
    '../models/user': models,
    '../services/notificationPersistenceService': { commit: async (_owner, work) => work(null) },
    '../middleware/securityMiddleware': {
      registerAuthFailure: () => {},
      clearAuthFailures: () => {}
    },
    '../services/platformSettingsService': { getSettingsSnapshotSync: () => ({}) },
    '../services/otpService': {
      createOtp: async () => ({ otp: '123456', expiresAt: new Date() }),
      validateOtp: async () => ({ isValid: false }),
      ...services.otp
    },
    '../services/emailService': { sendEmailOTP: async () => {}, ...services.email },
    '../services/smsService': { sendSMSOTP: async () => {} }
  });
}
test('recovery handles are opaque, authenticated, expiring and compatible with issued IDs', () => {
  process.env.JWT_SECRET = 'disposable-recovery-fixture-key';
  const id = '0123456789abcdef01234567';
  const handle = challenges.create(id, new Date(Date.now() + 60000));
  assert.ok(!handle.includes(id));
  assert.equal(challenges.resolve(handle), id);
  assert.equal(challenges.resolve(handle.slice(0, -4) + 'AAAA'), null);
  assert.equal(challenges.resolve(challenges.create(id, new Date(0))), null);
  assert.equal(challenges.resolve(id), id);
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'other-worker-with-wrong-key';
  assert.equal(challenges.resolve(handle), null);
  process.env.JWT_SECRET = original;
});
test('known, absent, disabled and unavailable phone recovery use identical public envelopes', async () => {
  process.env.JWT_SECRET = 'disposable-recovery-fixture-key';
  const user = { _id: '0123456789abcdef01234567', email: 'fixture@example.test' };
  const replies = [];
  for (const record of [user, null, { ...user, isActive: false }]) {
    const api = auth({ findOne: async () => record });
    const res = response();
    await api.forgotPassword({ body: { email: user.email, type: 'phone' } }, res);
    assert.equal(res.statusCode, 200);
    replies.push(res.body);
  }
  assert.equal(new Set(replies.map((reply) => reply.message)).size, 1);
  assert.equal(new Set(replies.map((reply) => reply.userId.length)).size, 1);
  assert.ok(
    replies.every((reply) => Object.keys(reply).sort().join() === 'expiresAt,message,userId')
  );
});
test('recovery verification does not disclose absent users or invalid OTP state', async () => {
  const user = { _id: '0123456789abcdef01234567' };
  for (const record of [user, null]) {
    const api = auth({ findById: () => ({ select: async () => record }) });
    const res = response();
    await api.verifyOtp(
      { body: { userId: user._id, otp: '123456', purpose: 'forgot-password', type: 'email' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: 'Invalid or expired OTP.' });
  }
});
test('mail errors do not disclose account existence or return delivery-provider details', async () => {
  const user = { _id: '0123456789abcdef01234567', email: 'fixture@example.test' };
  const api = auth(
    { findOne: async () => user },
    {
      email: {
        sendEmailOTP: async () => {
          throw Error('private provider detail');
        }
      }
    }
  );
  const res = response();
  await api.forgotPassword({ body: { email: user.email, type: 'email' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(!JSON.stringify(res.body).includes('private'));
});
test('password reset uses compare-and-set so concurrent replay cannot overwrite the winner', async () => {
  const user = {
    _id: '0123456789abcdef01234567',
    password: await bcrypt.hash('Original-password-1!', 4)
  };
  const token = jwt.sign(
    { id: user._id, purpose: 'reset-password' },
    process.env.JWT_SECRET + user.password,
    { expiresIn: '1m' }
  );
  const api = auth({
    findById: () => ({ select: async () => user }),
    updateOne: async (filter) => {
      assert.equal(filter.password, user.password);
      return { matchedCount: 0 };
    }
  });
  const res = response();
  await api.resetPassword({ body: { resetToken: token, newPassword: 'Updated-password-2!' } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: 'Reset token expired or invalid.' });
});
test('administrative status is disclosed only after valid credentials', async () => {
  const user = {
    _id: '0123456789abcdef01234567',
    isActive: false,
    password: await bcrypt.hash('Original-password-1!', 4)
  };
  const api = auth({ findOne: () => ({ select: async () => user }) });
  const wrong = response();
  await api.loginUser({ body: { email: 'fixture@example.test', password: 'wrong' } }, wrong);
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.body.message, 'Invalid credentials');
  const correct = response();
  await api.loginUser(
    { body: { email: 'fixture@example.test', password: 'Original-password-1!' } },
    correct
  );
  assert.equal(correct.statusCode, 403);
});

test('credential revisions reject old tokens on protected and optional authentication paths', async () => {
  process.env.JWT_SECRET = 'disposable-recovery-fixture-key';
  const user = { _id: '0123456789abcdef01234567', sessionRevision: 1, isActive: true };
  const middleware = load('middleware/authmiddleware.js', {
    '../models/user': { findById: () => ({ select: async () => ({ ...user }) }) }
  });
  const token = (revision) =>
    jwt.sign(
      { id: user._id, ...(revision === undefined ? {} : { sessionRevision: revision }) },
      process.env.JWT_SECRET,
      { issuer: 'devinsight-api', audience: 'devinsight-web' }
    );
  const old = { headers: { authorization: `Bearer ${token()}` } };
  const denied = response();
  await middleware.protect(old, denied, () => assert.fail('old session must not authenticate'));
  assert.equal(denied.statusCode, 401);
  const optional = { headers: old.headers };
  let optionalNext = false;
  await middleware.attachOptionalUser(optional, response(), () => {
    optionalNext = true;
  });
  assert.equal(optionalNext, true);
  assert.equal(optional.user, undefined);
  const current = { headers: { authorization: `Bearer ${token(1)}` } };
  let currentNext = false;
  await middleware.protect(current, response(), () => {
    currentNext = true;
  });
  assert.equal(currentNext, true);
});
test('production image storage rejects missing and relative persistent roots', () => {
  const images = require('../services/publicImageStorageService');
  const priorNode = process.env.NODE_ENV;
  const priorRoot = process.env.PUBLIC_IMAGE_STORAGE_ROOT;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.PUBLIC_IMAGE_STORAGE_ROOT;
    assert.throws(images.root, /shared persistent volume/);
    process.env.PUBLIC_IMAGE_STORAGE_ROOT = 'relative/path';
    assert.throws(images.root, /absolute/);
    process.env.NODE_ENV = 'development';
    delete process.env.PUBLIC_IMAGE_STORAGE_ROOT;
    assert.ok(require('node:path').isAbsolute(images.root()));
  } finally {
    if (priorNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNode;
    if (priorRoot === undefined) delete process.env.PUBLIC_IMAGE_STORAGE_ROOT;
    else process.env.PUBLIC_IMAGE_STORAGE_ROOT = priorRoot;
  }
});
