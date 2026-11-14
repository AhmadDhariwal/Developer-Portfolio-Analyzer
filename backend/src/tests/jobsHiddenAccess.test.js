const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { load } = require('./fixtures/publicPortfolioFixture');
const password = 'Account!Pass123';
const passwordHash = bcrypt.hashSync(password, 10);
const owner = '000000000000000000000001';
function setup(extra = {}) {
  const state = {
    user: { _id: owner, password: passwordHash, sessionRevision: 0, isActive: true },
    redis: true
  };
  const entries = new Map();
  const redis = {
    eval: async (_script, { keys }) => {
      const count = Number(entries.get(keys[0]) || 0) + 1;
      entries.set(keys[0], String(count));
      return count;
    },
    pTTL: async () => 900000,
    set: async (key, value) => {
      entries.set(key, value);
      return 'OK';
    },
    get: async (key) => entries.get(key),
    del: async (key) => entries.delete(key)
  };
  const api = load('services/jobsHiddenAccessService.js', {
    '../models/user': {
      findById: () => ({
        select() {
          return this;
        },
        maxTimeMS() {
          return this;
        },
        lean: async () => state.user
      })
    },
    './redisCacheService': { getRedisCacheClient: () => (state.redis ? redis : null) },
    ...extra
  });
  const req = {
    user: { _id: owner, sessionRevision: 0 },
    headers: { authorization: 'Bearer fixture-session-a' },
    body: { password }
  };
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
  await assert.rejects(api.unlock({ ...req, body: { password: 'Wrong!Pass' } }), {
    status: 403,
    code: 'JOBS_HIDDEN_PASSWORD_INCORRECT'
  });
  state.user.password = '';
  await assert.rejects(api.unlock(req), { status: 403, code: 'JOBS_HIDDEN_PASSWORD_UNAVAILABLE' });
  assert.ok([...entries.keys()].every((key) => !key.includes(':grant:')));
});
test('grants cannot cross accounts, auth tokens, password changes or session revisions', async () => {
  const { api, req, state } = setup();
  const grant = await api.unlock(req);
  req.headers['x-jobs-hidden-token'] = grant.token;
  assert.equal(
    await api.isUnlocked({ ...req, user: { ...req.user, _id: '000000000000000000000002' } }),
    false
  );
  assert.equal(
    await api.isUnlocked({
      ...req,
      headers: { ...req.headers, authorization: 'Bearer fixture-session-b' }
    }),
    false
  );
  state.user.password = 'changed-password-hash';
  assert.equal(await api.isUnlocked(req), false);
  state.user.sessionRevision = 1;
  await assert.rejects(api.isUnlocked(req), { status: 401 });
});
test('expiry and explicit lock invalidate access even if a stale Redis entry remains', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { api, req } = setup();
  const grant = await api.unlock(req);
  req.headers['x-jobs-hidden-token'] = grant.token;
  now += 300001;
  assert.equal(await api.isUnlocked(req), false);
  const next = await api.unlock(req);
  req.headers['x-jobs-hidden-token'] = next.token;
  await api.lock(req);
  assert.equal(await api.isUnlocked(req), false);
});
test('Redis failure cannot unlock hidden jobs and never prevents ordinary locked reads', async () => {
  const { api, req, state, redis } = setup();
  state.redis = false;
  assert.equal(await api.isUnlocked(req), false);
  await assert.rejects(api.unlock(req), { status: 503 });
  state.redis = true;
  const grant = await api.unlock(req);
  req.headers['x-jobs-hidden-token'] = grant.token;
  redis.get = async () => {
    throw Error('Redis down');
  };
  await assert.rejects(api.isUnlocked(req), { status: 503 });
});

test('failed confirmations lock at five attempts and successful confirmations reset that counter', async () => {
  const { api, req } = setup();
  for (let index = 0; index < 6; index++) await api.unlock(req);
  for (let index = 0; index < 5; index++)
    await assert.rejects(api.unlock({ ...req, body: { password: 'WrongPassword' } }), {
      status: 403
    });
  await assert.rejects(api.unlock(req), { status: 429, retryAfter: 900 });
});

test('at most two password comparisons run per worker and reservations release on completion', async () => {
  const finish = [];
  const { api, req } = setup({
    bcryptjs: { compare: () => new Promise((resolve) => finish.push(resolve)) }
  });
  const one = api.unlock(req),
    two = api.unlock(req);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(api.unlock(req), { status: 503 });
  assert.equal(finish.length, 2);
  finish.forEach((resolve) => resolve(true));
  await Promise.all([one, two]);
});

test('locked action lists exclude hidden records from every non-hidden view', async () => {
  const filters = [];
  const result = {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    maxTimeMS() {
      return this;
    },
    lean: async () => []
  };
  const api = load('services/jobActionService.js', {
    '../models/userJobAction': {
      find: (filter) => {
        filters.push(filter);
        return result;
      }
    },
    './jobService': {}
  });
  for (const state of [undefined, 'saved', 'applied'])
    await api.list(owner, state ? { state } : {});
  assert.ok(filters.every((filter) => filter.userId === owner && filter.hidden.$ne === true));
  await assert.rejects(api.list(owner, { state: 'hidden' }), { status: 403 });
  await api.list(owner, { state: 'hidden' }, { allowHidden: true });
  assert.equal(filters.at(-1).hidden, true);
});

test('unhide, hidden-record mutation and a concurrent hide cannot bypass the action guard', async () => {
  let hidden = true;
  let race = false;
  const query = (value) => ({
    maxTimeMS() {
      return this;
    },
    lean: async () => value
  });
  const api = load('services/jobActionService.js', {
    '../models/userJobAction': {
      findOne: () => query({ hidden }),
      findOneAndUpdate: (filter, update) => {
        if (race) {
          assert.deepEqual(filter.hidden, { $ne: true });
          return query(null);
        }
        return query({ hidden, ...update.$set });
      }
    },
    './jobService': {}
  });
  await assert.rejects(api.update(owner, 'fixture-job', { saved: false }), { status: 403 });
  await assert.rejects(api.update(owner, 'fixture-job', { hidden: false }), { status: 403 });
  assert.equal(
    (await api.update(owner, 'fixture-job', { hidden: false }, { allowHidden: true })).hidden,
    false
  );
  hidden = false;
  assert.equal(
    (await api.update(owner, 'fixture-job', { saved: true, hidden: false })).hidden,
    false
  );
  race = true;
  await assert.rejects(api.update(owner, 'fixture-job', { saved: true }), { status: 403 });
});
