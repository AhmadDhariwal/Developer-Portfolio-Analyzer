const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIntegrationScore } = require('../services/integrationInsightService');
const { computeProviderScores, normalizeIngestion } = require('../services/integrationNormalizationService');

test('computeIntegrationScore returns 0 without providers', () => {
  assert.equal(computeIntegrationScore([]), 0);
});

test('computeIntegrationScore blends profile/activity/confidence', () => {
  const score = computeIntegrationScore([
    { profileScore: 70, activityScore: 80, confidence: 75 },
    { profileScore: 60, activityScore: 50, confidence: 90 }
  ]);

  assert.equal(score, 69);
});

test('all provider scoring stays finite and within 0-100', () => {
  const fixtures = {
    github: { profile: { publicRepos: 20, followers: 50 }, activity: { starsReceived: 100, forksReceived: 10 } },
    linkedin: { activity: { profileCompleteness: 88, accountActivityProxy: 61 } },
    leetcode: { profile: { solvedProblems: 400, reputation: 200 }, activity: { easy: 200, medium: 150, hard: 50 } },
    kaggle: { profile: { competitions: 10, notebooks: 20 }, activity: { medals: { gold: 2, silver: 3, bronze: 4 } } },
    stackoverflow: { profile: { reputation: 12000, answerCount: 80, totalBadges: 35, goldBadges: 2, silverBadges: 10 } },
    hackerrank: { profile: { codingScore: 82, totalCertifications: 3, totalBadges: 7 } },
    portfolio: { profile: { isReachable: true }, activity: { seoScore: 80, performanceScore: 75, technologies: ['Angular', 'Node.js'] } },
    certifications: { profile: { certScore: 90, totalCertifications: 4 } },
    devblogs: { profile: { brandingScore: 72, totalArticles: 12, totalReactions: 250 } }
  };

  for (const [provider, fixture] of Object.entries(fixtures)) {
    const scores = computeProviderScores(provider, fixture);
    assert.ok(Number.isFinite(scores.profileScore), `${provider} profile score must be finite`);
    assert.ok(Number.isFinite(scores.activityScore), `${provider} activity score must be finite`);
    assert.ok(scores.profileScore >= 0 && scores.profileScore <= 100);
    assert.ok(scores.activityScore >= 0 && scores.activityScore <= 100);
  }
});

test('bad raw metadata cannot create NaN or poison aggregate score', () => {
  const normalized = normalizeIngestion('github', {
    profile: { publicRepos: 'not-a-number', followers: Infinity },
    activity: { starsReceived: {}, forksReceived: Number.NaN },
    inferredSkills: ['Node.js', 'node.js', '', null, 'TypeScript']
  });

  assert.equal(normalized.profileScore, 0);
  assert.equal(normalized.activityScore, 0);
  assert.deepEqual(normalized.inferredSkills, ['node.js', 'TypeScript']);
  assert.equal(computeIntegrationScore([
    { profileScore: Infinity, activityScore: Number.NaN, confidence: -20 },
    { profileScore: 200, activityScore: 80, confidence: 120 }
  ]), 46);
});
