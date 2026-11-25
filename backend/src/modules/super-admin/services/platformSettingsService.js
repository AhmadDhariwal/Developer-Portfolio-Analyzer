const crypto = require('node:crypto');
const PlatformSettings = require('../models/platformSettings');
const { getRedisCacheClient } = require('../../../core/cache/redisCacheService');

const DEFAULT_SETTINGS = {
  general: {
    platformName: 'DevInsight AI',
    logoUrl: '',
    maintenanceMode: false,
    defaultTimezone: 'Asia/Karachi',
    defaultLanguage: 'en'
  },
  ai: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    usageLimitPerDay: 5000,
    recommendationLimit: 10,
    promptTemplate: '',
    providerApiKey: ''
  },
  organization: {
    allowOrgCreation: false,
    maxTeamsPerOrganization: 10,
    recruiterLimitPerOrg: 5,
    adminInvitesRequireApproval: true
  },
  recruiter: {
    enableRecruiterAccess: true,
    candidateVisibility: 'public',
    activityThresholdDays: 14
  },
  developer: {
    publicPortfolioVisibility: true,
    githubRequirement: true,
    profileCompletionRequirement: 70
  },
  security: {
    jwtExpiresIn: '20h',
    otpExpiryMinutes: 10,
    otpMaxAttempts: 3,
    passwordMinLength: 6,
    requireStrongPassword: false,
    loginMaxFailures: 6,
    loginLockoutMinutes: 10,
    globalRateLimitMax: 500
  },
  analytics: {
    refreshIntervalMinutes: 30,
    dashboardCacheMinutes: 10,
    enableStructuredLogging: true
  },
  notifications: {
    emailNotifications: true,
    systemAlerts: true,
    recruiterAlerts: true,
    adminAlerts: true
  },
  integrations: {
    github: { enabled: true, apiKey: '' },
    news: { enabled: true, apiKey: '' },
    jobs: { enabled: true, apiKey: '' }
  }
};

const CACHE_TTL_MS = 30 * 1000;
let settingsCache = { value: null, expiresAt: 0 };
let refreshPromise;
let synchronizationTimer;
let synchronizationStopped = true;
let synchronizationEpoch = 0;
let observedRevision;
let cacheGeneration = 0;
const revisionKey = () => `platform-settings:revision:${PlatformSettings.db.name}:global`;

const unavailable = () =>
  Object.assign(new Error('Platform settings are temporarily unavailable.'), {
    status: 503
  });

const getKey = () => {
  const source = String(process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'devinsight-settings-key');
  return crypto.createHash('sha256').update(source).digest();
};

const encryptSecret = (value) => {
  const plaintext = String(value || '').trim();
  if (!plaintext) return '';

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
};

const decryptSecret = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 3) return '';
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const deepMerge = (target, source) => {
  const output = Array.isArray(target) ? [...target] : { ...target };
  if (!source || typeof source !== 'object') return output;

  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      target?.[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
};

const normalizeNumber = (value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const normalizeBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeString = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
};

const buildStoredDocument = (input = {}, existing = null) => {
  const base = deepClone(existing || DEFAULT_SETTINGS);
  const next = deepMerge(base, input);

  next.general.platformName = normalizeString(input?.general?.platformName, base.general.platformName);
  next.general.logoUrl = normalizeString(input?.general?.logoUrl, base.general.logoUrl);
  next.general.maintenanceMode = normalizeBoolean(input?.general?.maintenanceMode, base.general.maintenanceMode);
  next.general.defaultTimezone = normalizeString(input?.general?.defaultTimezone, base.general.defaultTimezone);
  next.general.defaultLanguage = normalizeString(input?.general?.defaultLanguage, base.general.defaultLanguage);

  next.ai.enabled = normalizeBoolean(input?.ai?.enabled, base.ai.enabled);
  next.ai.provider = normalizeString(input?.ai?.provider, base.ai.provider);
  next.ai.model = normalizeString(input?.ai?.model, base.ai.model);
  next.ai.usageLimitPerDay = normalizeNumber(input?.ai?.usageLimitPerDay, base.ai.usageLimitPerDay, {
    min: 0,
    max: 1_000_000
  });
  next.ai.recommendationLimit = normalizeNumber(input?.ai?.recommendationLimit, base.ai.recommendationLimit, {
    min: 1,
    max: 100
  });
  next.ai.promptTemplate = normalizeString(input?.ai?.promptTemplate, base.ai.promptTemplate);
  if (input?.ai?.providerApiKey !== undefined) {
    next.ai.providerApiKey = normalizeString(input.ai.providerApiKey)
      ? encryptSecret(input.ai.providerApiKey)
      : existing?.ai?.providerApiKey || '';
  }

  next.organization.allowOrgCreation = normalizeBoolean(
    input?.organization?.allowOrgCreation,
    base.organization.allowOrgCreation
  );
  next.organization.maxTeamsPerOrganization = normalizeNumber(
    input?.organization?.maxTeamsPerOrganization,
    base.organization.maxTeamsPerOrganization,
    { min: 1, max: 1000 }
  );
  next.organization.recruiterLimitPerOrg = normalizeNumber(
    input?.organization?.recruiterLimitPerOrg,
    base.organization.recruiterLimitPerOrg,
    { min: 1, max: 1000 }
  );
  next.organization.adminInvitesRequireApproval = normalizeBoolean(
    input?.organization?.adminInvitesRequireApproval,
    base.organization.adminInvitesRequireApproval
  );

  next.recruiter.enableRecruiterAccess = normalizeBoolean(
    input?.recruiter?.enableRecruiterAccess,
    base.recruiter.enableRecruiterAccess
  );
  next.recruiter.candidateVisibility = normalizeString(
    input?.recruiter?.candidateVisibility,
    base.recruiter.candidateVisibility
  );
  next.recruiter.activityThresholdDays = normalizeNumber(
    input?.recruiter?.activityThresholdDays,
    base.recruiter.activityThresholdDays,
    { min: 1, max: 365 }
  );

  next.developer.publicPortfolioVisibility = normalizeBoolean(
    input?.developer?.publicPortfolioVisibility,
    base.developer.publicPortfolioVisibility
  );
  next.developer.githubRequirement = normalizeBoolean(
    input?.developer?.githubRequirement,
    base.developer.githubRequirement
  );
  next.developer.profileCompletionRequirement = normalizeNumber(
    input?.developer?.profileCompletionRequirement,
    base.developer.profileCompletionRequirement,
    { min: 0, max: 100 }
  );

  next.security.jwtExpiresIn = normalizeString(input?.security?.jwtExpiresIn, base.security.jwtExpiresIn);
  next.security.otpExpiryMinutes = normalizeNumber(input?.security?.otpExpiryMinutes, base.security.otpExpiryMinutes, {
    min: 1,
    max: 120
  });
  next.security.otpMaxAttempts = normalizeNumber(input?.security?.otpMaxAttempts, base.security.otpMaxAttempts, {
    min: 1,
    max: 20
  });
  next.security.passwordMinLength = normalizeNumber(
    input?.security?.passwordMinLength,
    base.security.passwordMinLength,
    { min: 6, max: 64 }
  );
  next.security.requireStrongPassword = normalizeBoolean(
    input?.security?.requireStrongPassword,
    base.security.requireStrongPassword
  );
  next.security.loginMaxFailures = normalizeNumber(input?.security?.loginMaxFailures, base.security.loginMaxFailures, {
    min: 1,
    max: 50
  });
  next.security.loginLockoutMinutes = normalizeNumber(
    input?.security?.loginLockoutMinutes,
    base.security.loginLockoutMinutes,
    { min: 1, max: 1440 }
  );
  next.security.globalRateLimitMax = normalizeNumber(
    input?.security?.globalRateLimitMax,
    base.security.globalRateLimitMax,
    { min: 10, max: 100000 }
  );

  next.analytics.refreshIntervalMinutes = normalizeNumber(
    input?.analytics?.refreshIntervalMinutes,
    base.analytics.refreshIntervalMinutes,
    { min: 1, max: 1440 }
  );
  next.analytics.dashboardCacheMinutes = normalizeNumber(
    input?.analytics?.dashboardCacheMinutes,
    base.analytics.dashboardCacheMinutes,
    { min: 1, max: 1440 }
  );
  next.analytics.enableStructuredLogging = normalizeBoolean(
    input?.analytics?.enableStructuredLogging,
    base.analytics.enableStructuredLogging
  );

  next.notifications.emailNotifications = normalizeBoolean(
    input?.notifications?.emailNotifications,
    base.notifications.emailNotifications
  );
  next.notifications.systemAlerts = normalizeBoolean(
    input?.notifications?.systemAlerts,
    base.notifications.systemAlerts
  );
  next.notifications.recruiterAlerts = normalizeBoolean(
    input?.notifications?.recruiterAlerts,
    base.notifications.recruiterAlerts
  );
  next.notifications.adminAlerts = normalizeBoolean(input?.notifications?.adminAlerts, base.notifications.adminAlerts);

  next.integrations.github.enabled = normalizeBoolean(
    input?.integrations?.github?.enabled,
    base.integrations.github.enabled
  );
  next.integrations.news.enabled = normalizeBoolean(input?.integrations?.news?.enabled, base.integrations.news.enabled);
  next.integrations.jobs.enabled = normalizeBoolean(input?.integrations?.jobs?.enabled, base.integrations.jobs.enabled);
  if (input?.integrations?.github?.apiKey !== undefined) {
    next.integrations.github.apiKey = normalizeString(input.integrations.github.apiKey)
      ? encryptSecret(input.integrations.github.apiKey)
      : existing?.integrations?.github?.apiKey || '';
  }
  if (input?.integrations?.news?.apiKey !== undefined) {
    next.integrations.news.apiKey = normalizeString(input.integrations.news.apiKey)
      ? encryptSecret(input.integrations.news.apiKey)
      : existing?.integrations?.news?.apiKey || '';
  }
  if (input?.integrations?.jobs?.apiKey !== undefined) {
    next.integrations.jobs.apiKey = normalizeString(input.integrations.jobs.apiKey)
      ? encryptSecret(input.integrations.jobs.apiKey)
      : existing?.integrations?.jobs?.apiKey || '';
  }

  return next;
};

const maskSecret = (value) => (value ? 'configured' : '');

const sanitizeForClient = (doc) => {
  const data = deepClone(doc || DEFAULT_SETTINGS);
  return {
    general: data.general,
    ai: {
      ...data.ai,
      providerApiKey: ''
    },
    organization: data.organization,
    recruiter: data.recruiter,
    developer: data.developer,
    security: data.security,
    analytics: data.analytics,
    notifications: data.notifications,
    integrations: {
      github: { ...data.integrations.github, apiKey: '' },
      news: { ...data.integrations.news, apiKey: '' },
      jobs: { ...data.integrations.jobs, apiKey: '' }
    },
    secretStatus: {
      aiProviderApiKey: maskSecret(data.ai?.providerApiKey),
      githubApiKey: maskSecret(data.integrations?.github?.apiKey),
      newsApiKey: maskSecret(data.integrations?.news?.apiKey),
      jobsApiKey: maskSecret(data.integrations?.jobs?.apiKey)
    },
    updatedAt: doc?.updatedAt || null,
    createdAt: doc?.createdAt || null
  };
};

const getSettingsDocument = async (force = false) => {
  if (!force && settingsCache.value && settingsCache.expiresAt > Date.now()) {
    return settingsCache.value;
  }

  if (refreshPromise) return refreshPromise;
  const generation = cacheGeneration;
  refreshPromise = (async () => {
    let doc = await PlatformSettings.findOne({ scope: 'global' }).setOptions({ timeoutMS: 5000 }).lean();
    if (!doc)
      doc = await PlatformSettings.findOneAndUpdate(
        { scope: 'global' },
        {
          $setOnInsert: {
            scope: 'global',
            ...deepClone(DEFAULT_SETTINGS),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        },
        {
          upsert: true,
          returnDocument: 'after',
          timestamps: false,
          timeoutMS: 5000
        }
      ).lean();
    // An overlapping local write owns the newer cache, even if this read completes last.
    if (generation === cacheGeneration) {
      settingsCache = { value: doc, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return settingsCache.value;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
};

const getSettings = async () => sanitizeForClient(await getSettingsDocument());

const getSettingsSnapshotSync = () => {
  // Preserve pre-start configuration consumers. API readiness awaits Mongo warmup
  // and request middleware revalidates before any policy-dependent handler runs.
  if (!settingsCache.value && synchronizationStopped) return deepClone(DEFAULT_SETTINGS);
  if (!settingsCache.value || settingsCache.expiresAt <= Date.now()) {
    getSettingsDocument().catch(() => {});
    throw unavailable();
  }
  return settingsCache.value;
};

// Share the existing bounded Redis command client. Revision polling avoids a second
// subscription connection and recovers missed notifications automatically.
const startSettingsSynchronization = async () => {
  await getSettingsDocument();
  if (!synchronizationStopped) return;
  synchronizationStopped = false;
  const epoch = ++synchronizationEpoch;
  const tick = async () => {
    try {
      const redis = getRedisCacheClient();
      const revision = redis ? await redis.get(revisionKey()).catch(() => null) : null;
      const changed = revision !== null && revision !== observedRevision;
      if (changed || settingsCache.expiresAt <= Date.now() + 5000) {
        // A read begun before this invalidation may have observed the old document.
        if (changed && refreshPromise) await refreshPromise;
        await getSettingsDocument(true);
        if (revision !== null) observedRevision = revision;
      }
    } catch {
      // The last verified snapshot remains usable only until its hard deadline.
    } finally {
      if (!synchronizationStopped && epoch === synchronizationEpoch) {
        synchronizationTimer = setTimeout(tick, 1500 + Math.random() * 500);
        synchronizationTimer.unref?.();
      }
    }
  };
  synchronizationTimer = setTimeout(tick, 0);
  synchronizationTimer.unref?.();
};

const stopSettingsSynchronization = () => {
  synchronizationStopped = true;
  synchronizationEpoch += 1;
  clearTimeout(synchronizationTimer);
};

const getOrganizationSettingsSync = () => {
  const settings = getSettingsSnapshotSync();
  return settings?.organization || deepClone(DEFAULT_SETTINGS.organization);
};

const getRecruiterSettingsSync = () => {
  const settings = getSettingsSnapshotSync();
  return settings?.recruiter || deepClone(DEFAULT_SETTINGS.recruiter);
};

const getDeveloperSettingsSync = () => {
  const settings = getSettingsSnapshotSync();
  return settings?.developer || deepClone(DEFAULT_SETTINGS.developer);
};

const getAnalyticsSettingsSync = () => {
  const settings = getSettingsSnapshotSync();
  return settings?.analytics || deepClone(DEFAULT_SETTINGS.analytics);
};

const updateSettings = async (payload = {}, updatedBy = null, attempt = 0) => {
  // Read the authority for each write. Compare-and-swap preserves concurrent patches.
  const existing =
    (await PlatformSettings.findOne({ scope: 'global' }).setOptions({ timeoutMS: 5000 }).lean()) ||
    (await getSettingsDocument());
  const stored = buildStoredDocument(payload, existing);
  delete stored._id;
  delete stored.createdAt;
  delete stored.updatedAt;
  const updated = await PlatformSettings.findOneAndUpdate(
    { scope: 'global', updatedAt: existing?.updatedAt || { $exists: false } },
    {
      $set: {
        ...stored,
        scope: 'global',
        updatedAt: new Date(Math.max(Date.now(), new Date(existing.updatedAt || 0).getTime() + 1)),
        updatedBy: updatedBy || undefined
      }
    },
    { returnDocument: 'after', timestamps: false, timeoutMS: 5000 }
  ).lean();
  if (!updated && attempt < 4) return updateSettings(payload, updatedBy, attempt + 1);
  if (!updated) throw Object.assign(new Error('Settings changed concurrently. Please retry.'), { status: 409 });
  cacheGeneration += 1;
  // Concurrent write responses can arrive in the opposite order to Mongo commits.
  if (new Date(updated.updatedAt).getTime() >= new Date(settingsCache.value?.updatedAt || 0).getTime()) {
    settingsCache = { value: updated, expiresAt: Date.now() + CACHE_TTL_MS };
  }
  const redis = getRedisCacheClient();
  if (redis) await redis.set(revisionKey(), crypto.randomUUID()).catch(() => {});
  return sanitizeForClient(updated);
};

const getSecuritySnapshot = async () => {
  const settings = await getSettingsDocument();
  return settings?.security || DEFAULT_SETTINGS.security;
};

const getAiSnapshotSync = () => {
  const settings = getSettingsSnapshotSync();
  const ai = settings?.ai || DEFAULT_SETTINGS.ai;
  return {
    enabled: ai?.enabled !== false,
    configured: Boolean(settingsCache.value?.ai),
    provider: String(ai?.provider || DEFAULT_SETTINGS.ai.provider),
    model: String(ai?.model || DEFAULT_SETTINGS.ai.model),
    apiKey: decryptSecret(ai?.providerApiKey || '')
  };
};

const getIntegrationSecretsSync = () => {
  const settings = getSettingsSnapshotSync();
  const integrations = settings?.integrations || DEFAULT_SETTINGS.integrations;
  return {
    githubEnabled: integrations?.github?.enabled !== false,
    newsEnabled: integrations?.news?.enabled !== false,
    jobsEnabled: integrations?.jobs?.enabled !== false,
    githubApiKey: decryptSecret(integrations?.github?.apiKey || ''),
    newsApiKey: decryptSecret(integrations?.news?.apiKey || ''),
    jobsApiKey: decryptSecret(integrations?.jobs?.apiKey || '')
  };
};

module.exports = {
  startSettingsSynchronization,
  stopSettingsSynchronization,
  DEFAULT_SETTINGS,
  getSettings,
  getSettingsSnapshotSync,
  getOrganizationSettingsSync,
  getRecruiterSettingsSync,
  getDeveloperSettingsSync,
  getAnalyticsSettingsSync,
  updateSettings,
  getSecuritySnapshot,
  getAiSnapshotSync,
  getIntegrationSecretsSync
};
