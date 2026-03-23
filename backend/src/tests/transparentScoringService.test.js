const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateTransparentScore,
  normalizeTransparentScorePayload
} = require('../services/transparentScoringService');

test('calculateTransparentScore returns weighted score with reasons', () => {
  const result = calculateTransparentScore({
    githubAnalysis: { score: 82, repoCount: 12, scores: { codeQuality: 84, projectImpact: 78, consistency: 74, contribution: 80 } },
    resumeAnalysis: { atsScore: 75, keywordDensity: 70, contentQuality: 72, formatScore: 68, skills: ['Node.js'] },
    skillGapAnalysis: { coverage: 64, yourSkills: ['Node.js'], missingSkills: ['Docker'] },
    aiBreakdown: { codeQuality: 80, skillCoverage: 66, industryReadiness: 69, projectImpact: 76 },
    aiOverallScore: 74,
    careerStack: 'Backend'
  });

  assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
  assert.ok(result.confidenceScore >= 0 && result.confidenceScore <= 100);
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.reasons.length > 0);
});

test('normalizeTransparentScorePayload fills defaults for legacy payloads', () => {
  const normalized = normalizeTransparentScorePayload({ overallScore: 70, breakdown: { codeQuality: 70 } });
  assert.equal(typeof normalized.overallScore, 'number');
  assert.equal(typeof normalized.confidenceScore, 'number');
  assert.ok(Array.isArray(normalized.reasons));
});
