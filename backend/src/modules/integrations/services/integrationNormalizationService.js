const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, toFiniteNumber(value)));

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

  if (provider === 'kaggle') {
    const medals = activity.medals || {};
    const profileScore = clamp((Number(profile.competitions || 0) * 1.8) + (Number(profile.notebooks || 0) * 1.5));
    const activityScore = clamp((Number(medals.gold || 0) * 25) + (Number(medals.silver || 0) * 12) + (Number(medals.bronze || 0) * 7));
    return { profileScore, activityScore };
  }

  if (provider === 'stackoverflow') {
    const reputation = Number(profile.reputation || 0);
    const answers = Number(profile.answerCount || 0);
    const badges = Number(profile.totalBadges || 0);
    // Reputation is the primary signal; answers and badges add secondary weight
    const profileScore = clamp((Math.log10(Math.max(1, reputation)) / Math.log10(50000)) * 80 + (badges * 0.5));
    const activityScore = clamp((answers * 0.8) + (Number(profile.goldBadges || 0) * 5) + (Number(profile.silverBadges || 0) * 2));
    return { profileScore, activityScore };
  }

  if (provider === 'hackerrank') {
    const certs = Number(profile.totalCertifications || 0);
    const badges = Number(profile.totalBadges || 0);
    const codingScore = Number(profile.codingScore || 0);
    const profileScore = clamp(codingScore);
    const activityScore = clamp((certs * 15) + (badges * 5));
    return { profileScore, activityScore };
  }

  if (provider === 'portfolio') {
    const seoScore = Number(activity.seoScore || 0);
    const perfScore = Number(activity.performanceScore || 0);
    const techCount = Array.isArray(activity.technologies) ? activity.technologies.length : 0;
    const isReachable = Boolean(profile.isReachable);
    const profileScore = clamp(isReachable ? (seoScore * 0.5) + (techCount * 3) : 0);
    const activityScore = clamp(isReachable ? perfScore : 0);
    return { profileScore, activityScore };
  }

  if (provider === 'certifications') {
    const certScore = Number(profile.certScore || 0);
    const totalCerts = Number(profile.totalCertifications || 0);
    const profileScore = clamp(certScore);
    const activityScore = clamp(totalCerts * 10);
    return { profileScore, activityScore };
  }

  if (provider === 'devblogs') {
    const totalArticles = Number(profile.totalArticles || 0);
    const totalReactions = Number(profile.totalReactions || 0);
    const brandingScore = Number(profile.brandingScore || 0);
    const profileScore = clamp(brandingScore);
    const activityScore = clamp((totalArticles * 4) + (Math.min(totalReactions, 500) * 0.08));
    return { profileScore, activityScore };
  }

  // Fallback for unknown providers
  return { profileScore: 0, activityScore: 0 };
};

const normalizeIngestion = (provider, ingested) => {
  const inferredSkills = Array.isArray(ingested?.inferredSkills)
    ? [...new Map(ingested.inferredSkills
      .map((skill) => String(skill || '').trim())
      .filter(Boolean)
      .map((skill) => [skill.toLowerCase(), skill])).values()]
    : [];
  const { profileScore, activityScore } = computeProviderScores(provider, ingested);

  const baseConfidence = {
    github: 82,
    linkedin: 60,
    leetcode: 72,
    kaggle: 68,
    stackoverflow: 78,
    hackerrank: 70,
    portfolio: 65,
    certifications: 75,
    devblogs: 62
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
