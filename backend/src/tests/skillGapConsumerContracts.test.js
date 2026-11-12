'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('Dashboard preserves canonical measured zero and unavailable coverage instead of counting claims', () => {
  const derive = require('../controllers/dashboardcontroller').__test.deriveReadinessBreakdown;
  for (const coverage of [0, null, 50, 100]) {
    const result = derive({
      skillGapCache: {
        analysisData: {
          ruleVersion: 'skill-evidence-coverage-v1',
          coverage,
          yourSkills: [{ name: 'Self-reported' }],
          missingSkills: [],
        },
      },
    });
    assert.equal(result.skillCoverage, coverage);
  }
});
test('current consumer compatibility rejects a changed profile revision while legacy snapshots remain readable', () => {
  const { compatibleSkillGap } = require('../services/recommendationEngineService');
  const at = new Date().toISOString();
  const context = {
    userId: 'owner',
    username: 'fixture',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    resumeHash: 'no-resume',
    resumeAnalysisId: 'no-resume',
    profileRevision: at,
  };
  const cache = {
    ...context,
    githubUsername: 'fixture',
    analysisVersion: require('../services/skillGapCacheContract').ANALYSIS_VERSION,
    updatedAt: at,
    analysisData: {
      ruleVersion: 'skill-evidence-coverage-v1',
      evidencePolicyVersion: 'skill-gap-evidence-policy-v2',
      taxonomyVersion: require('../services/skillGapRequirements').TAXONOMY_VERSION,
      requirementMatrixVersion: require('../services/skillGapRequirements').MATRIX_VERSION,
      sourceReferences: [{ type: 'profile', timestamp: at }],
    },
  };
  assert.ok(compatibleSkillGap(cache, context));
  assert.equal(
    compatibleSkillGap(cache, { ...context, profileRevision: '2026-01-01T00:00:00Z' }),
    null,
  );
  assert.equal(compatibleSkillGap(cache, { ...context, userId: 'foreign' }), null);
});

test('recorded portfolio dimensions stay attached to their assessment when current Skill Gap evidence changes', () => {
  const derive = require('../controllers/dashboardcontroller').__test.deriveReadinessBreakdown;
  for (const recorded of [null, 0, 50]) {
    const result = derive({
      portfolioScore: {
        breakdown: { skillCoverage: 88 },
        scoring: { breakdown: { skillCoverage: { value: recorded } } },
      },
      skillGapCache: { analysisData: { coverage: 100 } },
    });
    assert.equal(result.skillCoverage, recorded);
  }
});
