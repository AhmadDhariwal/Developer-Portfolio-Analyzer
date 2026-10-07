'use strict';
const { numeric, safeAverage } = require('./math');
const { scoreFeatures } = require('./aggregate');
const RULE_VERSION = 'portfolio-score-v1';
const BASE_WEIGHTS = Object.freeze({ codeQuality: 0.32, skillCoverage: 0.28, industryReadiness: 0.22, projectImpact: 0.18 });
const STACK_WEIGHTS = Object.freeze({
  Frontend: Object.freeze({ codeQuality: 0.3, skillCoverage: 0.34, industryReadiness: 0.2, projectImpact: 0.16 }),
  Backend: Object.freeze({ codeQuality: 0.36, skillCoverage: 0.24, industryReadiness: 0.22, projectImpact: 0.18 }),
  'AI/ML': Object.freeze({ codeQuality: 0.28, skillCoverage: 0.24, industryReadiness: 0.28, projectImpact: 0.2 })
});
const getWeights = (careerStack) => ({ ...(Object.hasOwn(STACK_WEIGHTS, careerStack) ? STACK_WEIGHTS[careerStack] : BASE_WEIGHTS) });

const calculate = ({ githubAnalysis = {}, resumeAnalysis = {}, skillGapAnalysis = {}, integrationInsight = {}, careerStack } = {}, options = {}) => {
  const integrationAvailable = integrationInsight?.present !== false
    && !(Array.isArray(integrationInsight?.providers) && integrationInsight.providers.length === 0);
  const inputs = {
    githubCodeQuality: githubAnalysis?.present === false ? null : numeric(githubAnalysis?.scores?.codeQuality) ?? numeric(githubAnalysis?.score),
    resumeAts: resumeAnalysis?.present === false ? null : numeric(resumeAnalysis?.atsScore),
    resumeKeywords: resumeAnalysis?.present === false ? null : numeric(resumeAnalysis?.keywordDensity),
    resumeContent: resumeAnalysis?.present === false ? null : numeric(resumeAnalysis?.contentQuality),
    resumeFormat: resumeAnalysis?.present === false ? null : numeric(resumeAnalysis?.formatScore),
    githubImpact: githubAnalysis?.present === false ? null : numeric(githubAnalysis?.scores?.projectImpact),
    githubConsistency: githubAnalysis?.present === false ? null : numeric(githubAnalysis?.scores?.consistency),
    githubContribution: githubAnalysis?.present === false ? null : numeric(githubAnalysis?.scores?.contribution),
    integration: integrationAvailable ? numeric(integrationInsight?.integrationScore) : null
  };
  const features = {
    codeQuality: inputs.githubCodeQuality,
    skillCoverage: skillGapAnalysis?.present === false ? null : numeric(skillGapAnalysis?.coverage),
    industryReadiness: safeAverage([inputs.resumeAts, inputs.resumeKeywords, inputs.resumeContent, inputs.resumeFormat]),
    projectImpact: safeAverage([inputs.githubImpact, inputs.githubConsistency, inputs.githubContribution, inputs.integration])
  };
  // AI numeric fields are intentionally outside this deterministic interface.
  return scoreFeatures(features, getWeights(careerStack), RULE_VERSION, { ...options, inputs });
};
module.exports = { RULE_VERSION, BASE_WEIGHTS, STACK_WEIGHTS, getWeights, calculate };
