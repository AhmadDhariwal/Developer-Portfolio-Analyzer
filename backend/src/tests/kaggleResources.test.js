const test = require('node:test');
const assert = require('node:assert/strict');
const resources = require('../services/integrations/kaggleResources');
const links = require('../services/integrationLinkedProfileService');
const LinkedProfile = require('../models/integrationLinkedProfile');
const persistence = require('../services/integrationPersistenceService');

function configure(t) {
  const old = process.env.KAGGLE_API_TOKEN;
  process.env.KAGGLE_API_TOKEN = 'fixture-token';
  t.after(() => {
    if (old === undefined) delete process.env.KAGGLE_API_TOKEN;
    else process.env.KAGGLE_API_TOKEN = old;
  });
}

test('official notebook/dataset reads use token auth, fixed SDK routes, public-user filters and bounded pagination', async (t) => {
  configure(t);
  t.mock.method(resources, 'post', async (url, body, config) => {
    assert.ok(url.startsWith('https://api.kaggle.com/v1/'));
    assert.equal(body.user, 'kaggle');
    assert.equal(body.pageSize, 20);
    assert.equal(config.headers.Authorization, 'Bearer fixture-token');
    if (url.includes('Kernels')) {
      assert.equal(body.group, 'EVERYONE');
      assert.equal(body.kernelType, 'notebook');
      assert.equal(body.pageToken, 'next');
      assert.equal(body.page, undefined);
      return {
        kernels: [
          { ref: 'kaggle/notebook', title: 'A notebook', language: 'python', totalVotes: 0 }
        ],
        nextPageToken: 'later'
      };
    }
    assert.equal(body.group, 'DATASET_SELECTION_GROUP_USER');
    return {
      datasets: [{ ref: 'kaggle/data', title: 'A dataset', lastUpdated: '2026-10-27T00:00:00Z' }]
    };
  });
  const notebooks = await resources.list('notebooks', 'kaggle', 'next');
  assert.equal(notebooks.resources[0].totalVotes, 0);
  assert.equal(notebooks.nextPageToken, 'later');
  assert.equal(notebooks.ownershipVerified, false);
  const datasets = await resources.list('datasets', 'kaggle');
  assert.equal(datasets.resources[0].downloadCount, undefined);
  assert.equal(datasets.resources[0].language, undefined);
  assert.equal(datasets.resources[0].medals, undefined);
});

test('reader rejects foreign, private, duplicate, oversized and malformed resources instead of accepting partial proof', async (t) => {
  configure(t);
  let payload;
  t.mock.method(resources, 'post', async () => payload);
  for (const value of [
    { datasets: [{ ref: 'other/data' }] },
    { datasets: [{ ref: 'kaggle/data', ownerRef: 'other' }] },
    { datasets: [{ ref: 'kaggle/data', isPrivate: true }] },
    { datasets: [{ ref: 'kaggle/data' }, { ref: 'kaggle/data' }] },
    { datasets: Array(21).fill({ ref: 'kaggle/data' }) },
    { datasets: [{ ref: 'kaggle/data', voteCount: 'unknown' }] },
    '<html>challenge</html>'
  ]) {
    payload = value;
    await assert.rejects(resources.list('datasets', 'kaggle'));
  }
});

test('resource normalization has no score, confidence or verified-skill payload', () => {
  const normalized = require('../services/kaggleResourceObservationService').normalize({
    provider: 'kaggle',
    resourceOnly: true,
    profile: { username: 'owner', ownershipVerified: true },
    activity: { notebooks: { resources: [] }, datasets: { resources: [] } }
  });
  assert.equal(normalized.ownershipVerified, false);
  assert.equal(normalized.profile.ownershipVerified, false);
  assert.equal(normalized.profileScore, undefined);
  assert.equal(normalized.confidence, undefined);
  assert.equal(normalized.inferredSkills, undefined);
});

test('resource sync failures retain error/lease handling without adding zero-score history', async (t) => {
  const mongoose = require('mongoose');
  const Connection = require('../models/integrationConnection');
  const Log = require('../models/integrationSyncLog');
  const session = {};
  t.mock.method(mongoose.connection, 'transaction', async (work) => work(session));
  t.mock.method(Connection, 'updateOne', async (filter, update, options) => {
    assert.equal(filter.userId, 'owner');
    assert.equal(update.$set.lastSyncError, 'Safe failure');
    assert.equal(update.$set.leaseUntil, null);
    assert.equal(options.session, session);
    return { matchedCount: 1 };
  });
  t.mock.method(Log, 'create', () => assert.fail('Resource failure cannot become a scored trend'));
  await persistence.fail(
    {
      userId: 'owner',
      provider: 'kaggle',
      metadata: { resourceObservation: { version: 'kaggle-resources-v1' } }
    },
    'Safe failure',
    'manual'
  );
});

test('dataset ownership uses canonical references, not creator or display names; numeric pagination remains bounded', async (t) => {
  configure(t);
  t.mock.method(resources, 'post', async (_url, body) => {
    assert.equal(body.page, 2);
    return {
      datasets: [
        {
          ref: 'kaggle/data',
          ownerRef: 'kaggle',
          ownerName: 'Display Name',
          creatorName: 'Earlier Creator',
          creatorUrl: 'earlier-creator',
          voteCount: 0
        }
      ]
    };
  });
  const page = await resources.list('datasets', 'kaggle', '', 2);
  assert.equal(page.resources[0].creatorName, 'Earlier Creator');
  assert.equal(page.resources[0].ownerRef, 'kaggle');
  assert.equal(page.page, 2);
  assert.match(page.completeness, /bounded sample/);
});

test('missing credentials and invalid usernames never make outbound requests', async (t) => {
  configure(t);
  t.mock.method(resources, 'post', () => assert.fail('No request'));
  await assert.rejects(resources.list('datasets', '../../admin'), { status: 400 });
  delete process.env.KAGGLE_API_TOKEN;
  await assert.rejects(resources.list('datasets', 'kaggle'), { status: 400 });
});

test('Kaggle fallback canonicalizes only Kaggle profile links and never crosses provider stores', async (t) => {
  assert.equal(
    links.normalize('https://kaggle.com/coder/', 'kaggle').profileUrl,
    'https://www.kaggle.com/coder'
  );
  for (const value of [
    'https://evil.test/coder',
    'https://kaggle.com/datasets/coder/data',
    'https://hackerrank.com/coder'
  ])
    assert.throws(() => links.normalize(value, 'kaggle'));
  t.mock.method(persistence, 'transaction', async (work) => work({}));
  t.mock.method(persistence, 'ownerFence', async (owner) => assert.equal(owner, 'owner'));
  t.mock.method(LinkedProfile, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { userId: 'owner', provider: 'kaggle' });
    assert.equal(update.$set.profileUrl, 'https://www.kaggle.com/coder');
  });
  const saved = await links.save('owner', 'coder', 'kaggle');
  assert.equal(saved.provider, 'kaggle');
  assert.equal(saved.ownershipVerified, false);
  assert.equal(saved.evidenceKind, 'user-entered-link');
});
