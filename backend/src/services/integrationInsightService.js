const IntegrationInsight = require('../models/integrationInsight');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));

const uniqLower = (arr = []) => {
  const seen = new Set();
  return arr.filter((item) => {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const computeIntegrationScore = (providers = []) => {
  if (!providers.length) return 0;

  const averageProfile = providers.reduce((sum, p) => sum + Number(p.profileScore || 0), 0) / providers.length;
  const averageActivity = providers.reduce((sum, p) => sum + Number(p.activityScore || 0), 0) / providers.length;
  const averageConfidence = providers.reduce((sum, p) => sum + Number(p.confidence || 0), 0) / providers.length;

  return clamp(Math.round((averageProfile * 0.38) + (averageActivity * 0.42) + (averageConfidence * 0.2)));
};

const upsertProviderInsight = async ({ userId, providerInsight }) => {
  const existing = await IntegrationInsight.findOne({ userId });
  const safeInsight = {
    provider: providerInsight.provider,
    profileScore: clamp(providerInsight.profileScore),
    activityScore: clamp(providerInsight.activityScore),
    confidence: clamp(providerInsight.confidence),
    inferredSkills: uniqLower(providerInsight.inferredSkills || []),
    normalized: providerInsight.normalized || {},
    syncedAt: providerInsight.syncedAt || new Date()
  };

  if (!existing) {
    const mergedSkills = uniqLower(safeInsight.inferredSkills);
    const integrationScore = computeIntegrationScore([safeInsight]);
    return IntegrationInsight.create({
      userId,
      providers: [safeInsight],
      mergedSkills,
      integrationScore,
      updatedAt: new Date()
    });
  }

  const providers = Array.isArray(existing.providers) ? [...existing.providers] : [];
  const index = providers.findIndex((p) => p.provider === safeInsight.provider);
  if (index >= 0) providers[index] = safeInsight;
  else providers.push(safeInsight);

  const mergedSkills = uniqLower(providers.flatMap((p) => p.inferredSkills || []));
  existing.providers = providers;
  existing.mergedSkills = mergedSkills;
  existing.integrationScore = computeIntegrationScore(providers);
  existing.updatedAt = new Date();
  await existing.save();
  return existing;
};

const getIntegrationInsight = async (userId) => {
  const doc = await IntegrationInsight.findOne({ userId }).lean();
  if (!doc) {
    return {
      providers: [],
      mergedSkills: [],
      integrationScore: 0,
      updatedAt: null
    };
  }
  return {
    providers: doc.providers || [],
    mergedSkills: doc.mergedSkills || [],
    integrationScore: clamp(doc.integrationScore || 0),
    updatedAt: doc.updatedAt || null
  };
};

module.exports = { upsertProviderInsight, getIntegrationInsight, computeIntegrationScore };
