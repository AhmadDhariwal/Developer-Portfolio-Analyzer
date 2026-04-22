const { MATCHING_WEIGHTS } = require('./weightConfig');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const normalizeFeatures = (features = {}) => ({
  skillMatch: clamp(features.skillMatch),
  projectQuality: clamp(features.projectQuality),
  github: clamp(features.github),
  experience: clamp(features.experience),
  consistency: clamp(features.consistency),
  growth: clamp(features.growth)
});

const calculateWeightedScore = (features = {}, weights = MATCHING_WEIGHTS) => {
  const normalized = normalizeFeatures(features);
  const breakdown = {
    skillMatch: {
      raw: normalized.skillMatch,
      weight: weights.skillMatch,
      weighted: Number((normalized.skillMatch * weights.skillMatch).toFixed(2))
    },
    projectQuality: {
      raw: normalized.projectQuality,
      weight: weights.projectQuality,
      weighted: Number((normalized.projectQuality * weights.projectQuality).toFixed(2))
    },
    github: {
      raw: normalized.github,
      weight: weights.github,
      weighted: Number((normalized.github * weights.github).toFixed(2))
    },
    experience: {
      raw: normalized.experience,
      weight: weights.experience,
      weighted: Number((normalized.experience * weights.experience).toFixed(2))
    },
    consistency: {
      raw: normalized.consistency,
      weight: weights.consistency,
      weighted: Number((normalized.consistency * weights.consistency).toFixed(2))
    },
    growth: {
      raw: normalized.growth,
      weight: weights.growth,
      weighted: Number((normalized.growth * weights.growth).toFixed(2))
    }
  };

  const finalScore = Number(Object.values(breakdown)
    .reduce((total, item) => total + item.weighted, 0)
    .toFixed(2));

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
