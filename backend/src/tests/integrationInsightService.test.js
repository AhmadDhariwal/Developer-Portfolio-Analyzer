const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIntegrationScore } = require('../services/integrationInsightService');

test('computeIntegrationScore returns 0 without providers', () => {
  assert.equal(computeIntegrationScore([]), 0);
});

test('computeIntegrationScore blends profile/activity/confidence', () => {
  const score = computeIntegrationScore([
    { profileScore: 70, activityScore: 80, confidence: 75 },
    { profileScore: 60, activityScore: 50, confidence: 90 }
  ]);

  assert.ok(score >= 0 && score <= 100);
  assert.ok(score > 0);
});
