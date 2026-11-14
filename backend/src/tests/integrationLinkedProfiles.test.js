const test = require('node:test');
const assert = require('node:assert/strict');
const LinkedProfile = require('../models/integrationLinkedProfile');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');
const persistence = require('../services/integrationPersistenceService');
const profiles = require('../services/integrationLinkedProfileService');
const controller = require('../controllers/integrationLinkedProfilescontroller');
const router = require('../routes/integrations.routes');

const response = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test('linked profile accepts usernames and legacy/current HTTPS profile URLs, returning a fixed canonical host', () => {
  for (const value of [
    'Coder_1',
    ' Coder_1 ',
    'https://hackerrank.com/Coder_1',
    'https://www.hackerrank.com/profile/Coder_1/'
  ]) {
    assert.deepEqual(profiles.normalize(value), {
      username: 'Coder_1',
      profileUrl: 'https://www.hackerrank.com/profile/Coder_1'
    });
  }
});

test('linked profile rejects malformed values, external hosts, credentials and non-profile paths', () => {
  for (const value of [
    undefined,
    null,
    {},
    '',
    'a'.repeat(301),
    'two users',
    'javascript:alert(1)',
    'http://www.hackerrank.com/profile/coder',
    'https://hackerrank.com.evil.test/coder',
    'https://www.hackerrank.com@evil.test/coder',
    'https://user:pass@hackerrank.com/coder',
    'https://hackerrank.com:444/coder',
    'https://hackerrank.com/coder?token=secret',
    'https://hackerrank.com/coder#secret',
    'https://hackerrank.com/rest/hackers/coder/badges',
    'https://hackerrank.com/profile/a%2fb',
    '//hackerrank.com/coder'
  ]) {
    assert.throws(() => profiles.normalize(value), { status: 400 });
  }
});

test('linked-profile routes require authentication and admission on writes, separate from connection endpoints', () => {
  const routes = router.stack.filter(
    (layer) => layer.route?.path === '/linked-profiles/hackerrank'
  );
  assert.equal(routes.length, 3);
  for (const { route } of routes) {
    assert.equal(route.stack[0].handle.name, 'protect');
    assert.equal(route.stack.length, route.methods.get ? 2 : 3);
  }
  assert.deepEqual(LinkedProfile.schema.indexes()[0], [
    { userId: 1, provider: 1 },
    { unique: true }
  ]);
});

test('link save is owner fenced, produces no provider observations, and does not touch connections, history or scoring', async (t) => {
  const session = { fixture: 'session' };
  let fenced = false;
  t.mock.method(persistence, 'transaction', async (work) => work(session));
  t.mock.method(persistence, 'ownerFence', async (owner, actual) => {
    assert.equal(owner, 'authenticated-owner');
    assert.equal(actual, session);
    fenced = true;
  });
  t.mock.method(Connection, 'findOneAndUpdate', () =>
    assert.fail('Link must not become a connection')
  );
  t.mock.method(Insight, 'findOneAndUpdate', () => assert.fail('Link must not become evidence'));
  t.mock.method(Log, 'create', () => assert.fail('Link must not become a sync event'));
  t.mock.method(persistence, 'invalidate', () => assert.fail('No scoring invalidation'));
  const axios = require('axios');
  t.mock.method(axios, 'get', () => assert.fail('No HTTP read allowed'));
  t.mock.method(axios, 'post', () => assert.fail('No HTTP write allowed'));
  t.mock.method(LinkedProfile, 'findOneAndUpdate', async (filter, update, options) => {
    assert.ok(fenced);
    assert.deepEqual(filter, { userId: 'authenticated-owner', provider: 'hackerrank' });
    assert.equal(options.session, session);
    assert.equal(options.upsert, true);
    assert.deepEqual(Object.keys(update.$set).sort(), ['profileUrl', 'username']);
  });
  const res = response();
  await controller.saveLinkedProfile(
    {
      user: { _id: 'authenticated-owner' },
      body: {
        profile: 'coder',
        userId: 'victim',
        ownershipVerified: true,
        score: 100,
        badges: ['fake']
      }
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.linkedProfile, {
    provider: 'hackerrank',
    username: 'coder',
    profileUrl: 'https://www.hackerrank.com/profile/coder',
    ownershipVerified: false,
    evidenceKind: 'user-entered-link'
  });
});

test('read is owner scoped and reconstructs an unverified canonical link without trusting stored flags or URLs', async (t) => {
  t.mock.method(LinkedProfile, 'findOne', (filter) => {
    assert.deepEqual(filter, { userId: 'owner', provider: 'hackerrank' });
    return {
      select: (projection) => {
        assert.equal(projection, 'username');
        return {
          lean: async () => ({
            username: 'coder',
            profileUrl: 'https://evil.test',
            ownershipVerified: true,
            score: 100
          })
        };
      }
    };
  });
  const result = await profiles.get('owner');
  assert.equal(result.ownershipVerified, false);
  assert.equal(result.profileUrl, 'https://www.hackerrank.com/profile/coder');
  assert.equal(result.score, undefined);
});

test('remove deletes only the owned linked reference and never disconnects historical integrations', async (t) => {
  const session = {};
  t.mock.method(persistence, 'transaction', async (work) => work(session));
  t.mock.method(persistence, 'ownerFence', async (owner) => assert.equal(owner, 'owner'));
  t.mock.method(persistence, 'disconnect', () => assert.fail('Historical integration must remain'));
  t.mock.method(LinkedProfile, 'deleteOne', async (filter, options) => {
    assert.deepEqual(filter, { userId: 'owner', provider: 'hackerrank' });
    assert.equal(options.session, session);
  });
  const res = response();
  await controller.removeLinkedProfile({ user: { _id: 'owner' } }, res);
  assert.deepEqual(res.body, { linkedProfile: null });
});

test('invalid input and deleted owner reject before linked-profile persistence', async (t) => {
  t.mock.method(LinkedProfile, 'findOneAndUpdate', () => assert.fail('Must not persist'));
  const invalid = response();
  await controller.saveLinkedProfile(
    { user: { _id: 'owner' }, body: { profile: 'https://evil.test/coder' } },
    invalid
  );
  assert.equal(invalid.statusCode, 400);
  t.mock.method(persistence, 'transaction', async (work) => work({}));
  t.mock.method(persistence, 'ownerFence', async () => {
    throw Object.assign(Error('Account is unavailable.'), { status: 404 });
  });
  await assert.rejects(profiles.save('deleted-owner', 'coder'), { status: 404 });
});

test('storage failures return a safe error and no false saved-link response', async (t) => {
  t.mock.method(profiles, 'save', async () => {
    throw Error('private database configuration');
  });
  const res = response();
  await controller.saveLinkedProfile({ user: { _id: 'owner' }, body: { profile: 'coder' } }, res);
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res.body).includes('private database configuration'));
  assert.equal(res.body.linkedProfile, undefined);
});

test('account deletion includes linked references in the existing owned transaction', async (t) => {
  const mongoose = require('mongoose');
  const User = require('../models/user');
  const owner = new mongoose.Types.ObjectId();
  const session = {};
  const removed = [];
  t.mock.method(mongoose.connection, 'transaction', async (work) => work(session));
  t.mock.method(User.collection, 'updateOne', async (filter, update, options) => {
    assert.equal(String(filter._id), String(owner));
    assert.equal(options.session, session);
    return { matchedCount: 1 };
  });
  for (const model of [Connection, Insight, Log, LinkedProfile]) {
    t.mock.method(model, 'deleteMany', async (filter, options) => {
      assert.deepEqual(filter, { userId: owner });
      assert.equal(options.session, session);
      removed.push(model.modelName);
    });
  }
  await persistence.deleteAccount(owner, async (actual) => {
    assert.equal(actual, session);
    assert.ok(removed.includes('IntegrationLinkedProfile'));
  });
  assert.equal(removed.length, 4);
});
