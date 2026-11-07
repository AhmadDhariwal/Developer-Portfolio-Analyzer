const test = require('node:test');
const assert = require('node:assert/strict');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');
const { getDashboardIntegrationAnalytics } = require('../controllers/dashboardcontroller');

function fixture(t, providers) {
  const resource = {
    provider: 'kaggle',
    metadata: { resourceObservation: { version: 'kaggle-resources-v1' } }
  };
  t.mock.method(Connection, 'find', () => ({ select: () => ({ lean: async () => [resource] }) }));
  t.mock.method(Insight, 'findOne', () => ({
    lean: async () => ({ providers, integrationScore: 0, mergedSkills: [] })
  }));
  t.mock.method(Log, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  return {
    json(body) {
      this.body = body;
    },
    status(code) {
      assert.fail('Unexpected status ' + code);
    }
  };
}

test('resource-only Kaggle observation cannot invent Dashboard scores or confidence', async (t) => {
  const res = fixture(t, []);
  await getDashboardIntegrationAnalytics({ user: { _id: 'isolated-owner' }, query: {} }, res);
  assert.deepEqual(res.body.cards, []);
});

test('historical scored Kaggle insight remains in analytics when a public resource observation exists', async (t) => {
  const res = fixture(t, [
    { provider: 'kaggle', profileScore: 12, activityScore: 15, confidence: 30 }
  ]);
  await getDashboardIntegrationAnalytics({ user: { _id: 'isolated-owner' }, query: {} }, res);
  assert.equal(res.body.cards.length, 1);
  assert.equal(res.body.cards[0].profileScore, 12);
  assert.equal(res.body.cards[0].activityScore, 15);
  assert.equal(res.body.cards[0].confidence, 30);
});
