const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));

const computeProviderScores = (provider, ingested = {}) => {
  const profile = ingested.profile || {};
  const activity = ingested.activity || {};

  if (provider === 'github') {
    const profileScore = clamp((Number(profile.publicRepos || 0) * 2) + (Number(profile.followers || 0) * 0.4));
    const activityScore = clamp((Number(activity.starsReceived || 0) * 0.6) + (Number(activity.forksReceived || 0) * 0.8));
    return { profileScore, activityScore };
  }

  if (provider === 'linkedin') {
    return {
      profileScore: clamp(Number(activity.profileCompleteness || 0)),
      activityScore: clamp(Number(activity.accountActivityProxy || 0))
    };
  }

  if (provider === 'leetcode') {
    const solved = Number(profile.solvedProblems || 0);
    const profileScore = clamp((solved / 8) + (Number(profile.reputation || 0) * 0.02));
    const activityScore = clamp((Number(activity.easy || 0) * 0.12) + (Number(activity.medium || 0) * 0.22) + (Number(activity.hard || 0) * 0.4));
    return { profileScore, activityScore };
  }

  const medals = activity.medals || {};
  const profileScore = clamp((Number(profile.competitions || 0) * 1.8) + (Number(profile.notebooks || 0) * 1.5));
  const activityScore = clamp((Number(medals.gold || 0) * 25) + (Number(medals.silver || 0) * 12) + (Number(medals.bronze || 0) * 7));
  return { profileScore, activityScore };
};

const normalizeIngestion = (provider, ingested) => {
  const inferredSkills = Array.isArray(ingested?.inferredSkills)
    ? ingested.inferredSkills.map((skill) => String(skill || '').trim()).filter(Boolean)
    : [];
  const { profileScore, activityScore } = computeProviderScores(provider, ingested);

  const baseConfidence = {
    github: 82,
    linkedin: 60,
    leetcode: 72,
    kaggle: 68
  }[provider] || 60;

  const confidenceBoost = Math.min(15, inferredSkills.length * 3);

  return {
    provider,
    profileScore,
    activityScore,
    confidence: clamp(baseConfidence + confidenceBoost),
    inferredSkills,
    normalized: {
      profile: ingested?.profile || {},
      activity: ingested?.activity || {}
    },
    syncedAt: new Date()
  };
};

module.exports = { computeProviderScores, normalizeIngestion };
