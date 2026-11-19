'use strict';

const { numeric, clamp, weightedCalculation } = require('./math');
const { createScoreResult } = require('./result');

const scoreFeatures = (values, weights, ruleVersion, options = {}) => {
  const signals = Object.entries(weights).map(([id, weight]) => ({ id, weight,
    value: numeric(values?.[id]) === null ? null : clamp(values[id]) }));
  // Preserve the original multiplication/addition order for a complete formula.
  // Renormalization is needed only when an optional input is unavailable.
  const complete = signals.every(signal => signal.value !== null);
  const calculated = weightedCalculation(signals, { normalize: !complete });
  return createScoreResult({
    score: calculated.value, breakdown: calculated.breakdown, warnings: calculated.warnings,
    evidence: { sources: options.sources, inputs: { ...options.inputs, ...Object.fromEntries(signals.map(signal => [signal.id, signal.value])) }, facts: options.facts },
    ruleVersion, calculatedAt: options.calculatedAt
  });
};

module.exports = { scoreFeatures };
