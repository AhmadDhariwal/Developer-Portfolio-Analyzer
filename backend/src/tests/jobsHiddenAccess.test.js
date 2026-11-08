const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { load } = require('./fixtures/publicPortfolioFixture');
const password = 'Account!Pass123';
const passwordHash = bcrypt.hashSync(password, 10);
const owner = '000000000000000000000001';
function setup(extra = {}) {
  const state = { user: { _id: owner, password: passwordHash, sessionRevision: 0, isActive: true }, redis: true };
  const entries = new Map();
  const redis = { set: async (key, value) => { entries.set(key, value); return 'OK'; },
    get: async (key) => entries.get(key), del: async (key) => entries.delete(key) };
  const api = load('services/jobsHiddenAccessService.js', {
    '../models/user': { findById: () => ({ select() { return this; }, maxTimeMS() { return this; }, lean: async () => state.user }) },
    './redisCacheService': { getRedisCacheClient: () => state.redis ? redis : null }, ...extra
  });
  const req = { user: { _id: owner, sessionRevision: 0 }, headers: { authorization: 'Bearer fixture-session-a' }, body: { password } };
  return { api, state, req, entries, redis };
}
test('existing account password, including special characters, grants a private short-lived unlock', async () => {
  const { api, req, entries } = setup();
  const result = await api.unlock(req);
  assert.equal(result.token.length, 43);
  assert.ok(result.expiresAt > Date.now());
  assert.ok(result.expiresAt <= Date.now() + 300000);
  req.headers['x-jobs-hidden-token'] = result.token;
  assert.equal(await api.isUnlocked(req), true);
  assert.ok(!JSON.stringify([...entries]).includes(passwordHash));
  assert.ok(!JSON.stringify([...entries]).includes(password));
  assert.ok(!JSON.stringify([...entries]).includes(req.headers.authorization));
});
test('wrong, missing or oversized passwords never grant access; passwordless accounts fail safely', async () => {
  const { api, req, state, entries } = setup();
  for (const value of [null, '', {}, 'x'.repeat(1025)])
    await assert.rejects(api.unlock({ ...req, body: { password: value } }), { status: 400 });
  await assert.rejects(api.unlock({ ...req, body: { password: 'Wrong!Pass' } }), { status: 403, code: 'JOBS_HIDDEN_PASSWORD_INCORRECT' });
  state.user.password = '';
  await assert.rejects(api.unlock(req), { status: 403, code: 'JOBS_HIDDEN_PASSWORD_UNAVAILABLE' });
  assert.equal(entries.size, 0);
});
test('grants cannot cross accounts, auth tokens, password changes or session revisions', async () => {
  const { api, req, state } = setup();
  const grant = await api.unlock(req);
  req.headers['x-jobs-hidden-token'] = grant.token;
  assert.equal(await api.isUnlocked({ ...req, user: { ...req.user, _id: '000000000000000000000002' } }), false);
  assert.equal(await api.isUnlocked({ ...req, headers: { ...req.headers, authorization: 'Bearer fixture-session-b' } }), false);
  state.user.password = 'changed-password-hash';
  assert.equal(await api.isUnlocked(req), false);
  state.user.sessionRevision = 1;
  await assert.rejects(api.isUnlocked(req), { status: 401 });
});
test('expiry and explicit lock invalidate access even if a stale Redis entry remains', async (t) => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const { api, req } = setup();
  const grant = await api.unlock(req);
  req.headers['x-jobs-hidden-token'] = grant.token;
  now += 300001;
  assert.equal(await api.isUnlocked(req), false);
  const next = await api.unlock(req); req.headers['x-jobs-hidden-token'] = next.token;
  await api.lock(req); assert.equal(await api.isUnlocked(req), false);
});
test('Redis failure cannot unlock hidden jobs and never prevents ordinary locked reads', async () => {
  const { api, req, state, redis } = setup();
  state.redis = false;
  assert.equal(await api.isUnlocked(req), false);
  await assert.rejects(api.unlock(req), { status: 503 });
  state.redis = true;
  const grant = await api.unlock(req); req.headers['x-jobs-hidden-token'] = grant.token;
  redis.get = async () => { throw Error('Redis down'); };
  await assert.rejects(api.isUnlocked(req), { status: 503 });
});
