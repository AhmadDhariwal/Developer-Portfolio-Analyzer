const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const predictGrowthPotential = ({
  explicitGrowthScore,
  weeklyCoverageDelta,
  readinessDelta,
  sprintCompletionRate,
  githubConsistencySignal,
  projectVelocity
} = {}) => {
  if (explicitGrowthScore !== undefined && explicitGrowthScore !== null) {
    return clamp(explicitGrowthScore);
  }

  const normalizedCoverage = clamp((Number(weeklyCoverageDelta) || 0) + 50);
  const normalizedReadiness = clamp((Number(readinessDelta) || 0) + 50);
  const normalizedCompletion = clamp(sprintCompletionRate);
  const normalizedConsistency = clamp(githubConsistencySignal);
  const normalizedVelocity = clamp(projectVelocity);

  const weighted =
    normalizedCoverage * 0.25 +
    normalizedReadiness * 0.25 +
    normalizedCompletion * 0.2 +
    normalizedConsistency * 0.2 +
    normalizedVelocity * 0.1;

  return Number(clamp(weighted).toFixed(2));
};

module.exports = {
  predictGrowthPotential
};
