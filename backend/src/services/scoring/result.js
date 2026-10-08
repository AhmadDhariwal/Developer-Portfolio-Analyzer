'use strict';

const { numeric, clamp, round } = require('./math');
const { LIMITS, buildEvidence, leanWarnings } = require('./evidence');

const createScoreResult = ({ score, breakdown = {}, warnings = [], evidence = {}, ruleVersion, calculatedAt, digits = 0 }) => {
  if (typeof ruleVersion !== 'string' || !/^[a-z][a-z0-9-]*-v\d+$/.test(ruleVersion) || ruleVersion.length > 80) throw new TypeError('Explicit scoring ruleVersion is required');
  const time = calculatedAt === undefined ? new Date() : new Date(calculatedAt);
  if (calculatedAt === null || Number.isNaN(time.getTime())) throw new TypeError('Invalid calculatedAt');
  const value = numeric(score);
  const safeBreakdown = Object.fromEntries(Object.entries(breakdown || {}).slice(0, LIMITS.breakdown)
    .filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(key) && key.length <= LIMITS.keyLength)
    .map(([key, item]) => [key, {
      value: numeric(item?.value), weight: numeric(item?.weight),
      contribution: numeric(item?.contribution), available: item?.available === true
    }]));
  return {
    score: value === null ? null : round(clamp(value), digits),
    breakdown: safeBreakdown,
    warnings: leanWarnings(value === null ? [...warnings, 'score_unavailable'] : warnings),
    evidence: buildEvidence(evidence), ruleVersion, calculatedAt: time.toISOString()
  };
};

module.exports = { createScoreResult };
