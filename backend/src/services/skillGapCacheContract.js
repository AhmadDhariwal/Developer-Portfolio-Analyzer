'use strict';
const context = require('./developerContextService');
const evidence = require('./skillGapEvidenceService');
const requirements = require('./skillGapRequirements');
const { numeric, clampScore } = require('./scoring/math');
const ANALYSIS_VERSION = 'v9-skill-evidence-governance';

// Current consumer reads must not borrow historical or temporary assessments.
const buildScope = ({ userId, user, resumeIdentity, now = Date.now() }) => {
  const username = String(context.resolveGithubUsername(user) || '').trim();
  return {
    userId,
    githubUsername: {
      $regex: '^' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
      $options: 'i'
    },
    careerStack: context.resolveCareerStack(user),
    experienceLevel: context.resolveExperienceLevel(user),
    resumeHash: resumeIdentity.resumeHash,
    resumeAnalysisId: resumeIdentity.resumeAnalysisId,
    analysisVersion: ANALYSIS_VERSION,
    'analysisData.ruleVersion': evidence.RULE_VERSION,
    'analysisData.evidencePolicyVersion': evidence.EVIDENCE_POLICY_VERSION,
    'analysisData.taxonomyVersion': requirements.TAXONOMY_VERSION,
    'analysisData.requirementMatrixVersion': requirements.MATRIX_VERSION,
    'analysisData.cacheMetadata.temporary': { $ne: true },
    'analysisData.missingSkills': { $exists: true },
    createdAt: { $gt: new Date(now - 7 * 86400000) }
  };
};
const coverage = (value) => (numeric(value) === null ? null : clampScore(value));
module.exports = { ANALYSIS_VERSION, buildScope, coverage };
