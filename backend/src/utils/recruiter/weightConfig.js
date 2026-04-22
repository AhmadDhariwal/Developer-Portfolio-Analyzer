const MATCHING_WEIGHTS = Object.freeze({
  skillMatch: 0.3,
  projectQuality: 0.2,
  github: 0.15,
  experience: 0.15,
  consistency: 0.1,
  growth: 0.1
});

const RANKING_FEATURES = Object.freeze([
  'skillMatch',
  'projectQuality',
  'github',
  'experience',
  'consistency',
  'growth'
]);

module.exports = {
  MATCHING_WEIGHTS,
  RANKING_FEATURES
};
