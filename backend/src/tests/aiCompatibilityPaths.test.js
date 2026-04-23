const test = require('node:test');
const assert = require('node:assert/strict');

const { MATCHING_WEIGHTS, RANKING_FEATURES } = require('../utils/ai/weightConfig');
const { calculateWeightedScore } = require('../utils/ai/scoringEngine');
const { rankCandidates } = require('../services/ai/aiRankingService');

test('AI compatibility weight config exports recruiter formula', () => {
  assert.equal(MATCHING_WEIGHTS.skillMatch, 0.3);
  assert.equal(MATCHING_WEIGHTS.projectQuality, 0.2);
  assert.equal(MATCHING_WEIGHTS.github, 0.15);
  assert.equal(MATCHING_WEIGHTS.experience, 0.15);
  assert.equal(MATCHING_WEIGHTS.consistency, 0.1);
  assert.equal(MATCHING_WEIGHTS.growth, 0.1);
  assert.deepEqual(RANKING_FEATURES, [
    'skillMatch',
    'projectQuality',
    'github',
    'experience',
    'consistency',
    'growth'
  ]);
});

test('AI compatibility scoring engine preserves weighted score behavior', () => {
  const result = calculateWeightedScore({
    skillMatch: 80,
    projectQuality: 70,
    github: 60,
    experience: 50,
    consistency: 90,
    growth: 40
  });

  assert.equal(result.finalScore, 67.5);
});

test('AI service alias exposes rankCandidates function', () => {
  assert.equal(typeof rankCandidates, 'function');
});
