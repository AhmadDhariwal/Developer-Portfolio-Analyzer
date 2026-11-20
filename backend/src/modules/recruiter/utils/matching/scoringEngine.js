const { MATCHING_WEIGHTS, RANKING_FEATURES } = require('./weightConfig');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const normalizeFeatures = (features = {}) =>
  Object.fromEntries(
    RANKING_FEATURES.map((key) => [key, features[key] == null ? null : clamp(features[key])])
  );

const calculateWeightedScore = (features = {}, weights = MATCHING_WEIGHTS) => {
  const normalized = normalizeFeatures(features);
  const breakdown = Object.fromEntries(
    RANKING_FEATURES.map((key) => {
      const raw = normalized[key];
      const weight = weights[key];
      return [
        key,
        { raw, weight, weighted: raw === null ? null : Number((raw * weight).toFixed(2)) }
      ];
    })
  );

  const finalScore = Number(
    Object.values(breakdown)
      .filter((item) => item.weighted !== null)
      .reduce((total, item) => total + item.weighted, 0)
      .toFixed(2)
  );

  return {
    finalScore,
    normalizedFeatures: normalized,
    breakdown
  };
};

module.exports = {
  normalizeFeatures,
  calculateWeightedScore
};
