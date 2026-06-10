const axios = require('axios');
const crypto = require('node:crypto');
const { rankJobs } = require('../utils/jobRanker');
const { getIntegrationSecretsSync } = require('./platformSettingsService');
const JobCache = require('../models/jobCache');
const JobSourceHealth = require('../models/jobSourceHealth');

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const JSEARCH_BASE = 'https://jsearch.p.rapidapi.com/search';
const JSEARCH_TIMEOUT_MS = Number.parseInt(process.env.JSEARCH_TIMEOUT_MS || '10000', 10);
const JSEARCH_RETRIES = Number.parseInt(process.env.JSEARCH_RETRIES || '1', 10);
const JOOBLE_BASE = 'https://jooble.org/api';
const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs';
const REMOTIVE_BASE = 'https://remotive.com/api/remote-jobs';
const ARBEITNOW_BASE = 'https://www.arbeitnow.com/api/job-board-api';
const REMOTEOK_BASE = 'https://remoteok.com/api';
const SECONDARY_SOURCE_TIMEOUT_MS = Number.parseInt(process.env.JOB_SOURCE_TIMEOUT_MS || '9000', 10);
const JOB_LIMITS = {
  defaultPage: 1,
  minPage: 1,
  defaultLimit: 10,
  maxLimit: 20
};

const PLATFORM_COLORS = {
  LinkedIn: { bg: '#0077B5', text: '#ffffff' },
  Indeed: { bg: '#003A9B', text: '#ffffff' },
  Rozee: { bg: '#e8282f', text: '#ffffff' },
  Glassdoor: { bg: '#0CAA41', text: '#ffffff' },
  RemoteOK: { bg: '#14b8a6', text: '#ffffff' },
  JSearch: { bg: '#2563eb', text: '#ffffff' },
  Jooble: { bg: '#f97316', text: '#111827' },
  Adzuna: { bg: '#a855f7', text: '#ffffff' },
  Remotive: { bg: '#22c55e', text: '#052e16' },
  Arbeitnow: { bg: '#38bdf8', text: '#082f49' },
  Other: { bg: '#6366f1', text: '#ffffff' }
};

const LOCATION_ALIASES = {
  all: 'All',
  remote: 'Remote',
  pakistan: 'Pakistan',
  usa: 'USA',
  europe: 'Europe'
};

const VALID_PLATFORMS = ['All', 'JSearch', 'Jooble', 'Adzuna', 'Remotive', 'Arbeitnow', 'LinkedIn', 'Indeed', 'Rozee', 'Glassdoor', 'RemoteOK'];
const VALID_JOB_TYPES = ['All', 'Full Time', 'Part Time', 'Contract', 'Internship', 'Remote'];
const VALID_EXP_LEVELS = ['All', 'Intern', 'Entry', '1-2 years', '3-5 years', '5+ years'];
const VALID_LOCATIONS = ['All', 'Remote', 'Pakistan', 'USA', 'Europe'];
const LIVE_SOURCE_KEYS = ['jsearch', 'jooble', 'adzuna', 'remotive', 'arbeitnow', 'remoteok'];
const SOURCE_DISPLAY_NAMES = {
  jsearch: 'JSearch',
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  arbeitnow: 'ArbeitNow',
  remoteok: 'RemoteOK'
};
const ADZUNA_COUNTRY_ALIASES = {
  eu: 'gb',
  europe: 'gb',
  usa: 'us',
  us: 'us',
  'united states': 'us',
  uk: 'gb',
  gb: 'gb',
  'united kingdom': 'gb',
  england: 'gb',
  pakistan: 'pk',
  pk: 'pk',
  canada: 'ca',
  ca: 'ca',
  australia: 'au',
  au: 'au',
  germany: 'de',
  de: 'de',
  france: 'fr',
  fr: 'fr',
  netherlands: 'nl',
  nl: 'nl',
  spain: 'es',
  es: 'es',
  italy: 'it',
  it: 'it',
  india: 'in',
  in: 'in'
};
const ADZUNA_SUPPORTED_COUNTRIES = new Set([
  'au', 'br', 'ca', 'de', 'fr', 'gb', 'in', 'it', 'nl', 'nz', 'pl', 'ru', 'sg', 'us', 'za', 'es'
]);
const SKILL_ALIASES = {
  angular: ['angular', 'angularjs', 'typescript', 'javascript', 'frontend', 'front end', 'front-end'],
  angularjs: ['angular', 'angularjs', 'typescript', 'javascript', 'frontend', 'front end', 'front-end'],
  'angular js': ['angular', 'angularjs', 'typescript', 'javascript', 'frontend', 'front end', 'front-end'],
  react: ['react', 'react.js', 'reactjs', 'javascript', 'typescript', 'frontend', 'front end', 'front-end'],
  'react.js': ['react', 'react.js', 'reactjs', 'javascript', 'typescript', 'frontend', 'front end', 'front-end'],
  reactjs: ['react', 'react.js', 'reactjs', 'javascript', 'typescript', 'frontend', 'front end', 'front-end'],
  node: ['node', 'node.js', 'nodejs', 'express', 'backend', 'back end', 'back-end', 'javascript'],
  'node.js': ['node', 'node.js', 'nodejs', 'express', 'backend', 'back end', 'back-end', 'javascript'],
  'node js': ['node', 'node.js', 'nodejs', 'express', 'backend', 'back end', 'back-end', 'javascript'],
  nodejs: ['node', 'node.js', 'nodejs', 'express', 'backend', 'back end', 'back-end', 'javascript']
};
const JOB_CACHE_TTL_HOURS = Math.max(24, Math.min(48, Number.parseInt(process.env.JOB_CACHE_TTL_HOURS || '36', 10) || 36));
const JOB_CACHE_TTL_MS = JOB_CACHE_TTL_HOURS * 60 * 60 * 1000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toText = (value) => String(value || '').trim();
const buildSourceSummarySeed = () => LIVE_SOURCE_KEYS.reduce((accumulator, key) => {
  accumulator[key] = 0;
  return accumulator;
}, {});
const uniqueStrings = (values = [], limit = 12) => {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = toText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }

  return output;
};

function normaliseSourceKey(raw) {
  const value = toText(raw).toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('jsearch')) return 'jsearch';
  if (value.includes('jooble')) return 'jooble';
  if (value.includes('adzuna')) return 'adzuna';
  if (value.includes('remotive')) return 'remotive';
  if (value.includes('arbeitnow') || value.includes('arbeit now')) return 'arbeitnow';
  if (value.includes('remoteok') || value.includes('remote ok')) return 'remoteok';
  return value;
}

function createSourceSummary(jobs = []) {
  return jobs.reduce((accumulator, job) => {
    const key = normaliseSourceKey(job?.source || job?.platform || 'unknown');
    accumulator[key] = Number(accumulator[key] || 0) + 1;
    return accumulator;
  }, buildSourceSummarySeed());
}

function buildSourceQuery(options = {}, filters = {}) {
  const knownSkills = uniqueStrings(options.knownSkills || [], 18);
  const resumeSkills = uniqueStrings(options.resumeSkills || [], 18);
  return [
    toText(options.careerStack) || 'Full Stack',
    'developer',
    knownSkills.slice(0, 2).join(' '),
    resumeSkills.slice(0, 2).join(' '),
    filters.skills
  ].map(toText).filter(Boolean).join(' ').slice(0, 90);
}

function logSourceFailure(failure = {}) {
  const source = toText(failure.source) || 'unknown';
  const reason = toText(failure.reason) || 'request_failed';
  const status = failure.statusCode || failure.status ? ` status=${failure.statusCode || failure.status}` : '';
  const configured = typeof failure.configured === 'boolean' ? ` configured=${failure.configured}` : '';
  const endpoint = toText(failure.endpoint) ? ` endpoint=${failure.endpoint}` : '';
  const requestQuery = toText(failure.requestQuery) ? ` query="${failure.requestQuery}"` : '';
  const detail = toText(failure.detail) ? ` detail=${failure.detail}` : '';
  console.warn(`[JobService][SourceFailure] source=${source} reason=${reason}${status}${configured}${endpoint}${requestQuery}${detail}`);
}

function sourceErrorMessage(failure = null) {
  if (!failure) return '';
  return toText(failure.detail || failure.reason || 'Source request failed').slice(0, 300);
}

function redactRequestParams(params = {}) {
  return Object.entries(params || {}).reduce((accumulator, [key, value]) => {
    const normalizedKey = String(key || '').toLowerCase();
    accumulator[key] = /(^|_)(key|secret|token|password)($|_)|^app_id$/.test(normalizedKey)
      ? (toText(value) ? '[configured]' : '')
      : value;
    return accumulator;
  }, {});
}

function safeResponseBody(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.slice(0, 1000);
  try {
    return JSON.parse(JSON.stringify(value)).toString === Object.prototype.toString
      ? JSON.parse(JSON.stringify(value))
      : value;
  } catch {
    return String(value).slice(0, 1000);
  }
}

function buildProviderDiagnostics({
  source,
  endpoint = '',
  requestQuery = '',
  requestParams = {},
  statusCode = null,
  responseBody = null,
  configured = true,
  reachable = false,
  lastSuccessAt = null,
  lastFailureAt = null
} = {}) {
  return {
    source: normaliseSourceKey(source),
    endpoint: toText(endpoint),
    requestQuery: toText(requestQuery),
    requestParams: redactRequestParams(requestParams),
    statusCode: statusCode || null,
    responseBody: safeResponseBody(responseBody),
    configured: Boolean(configured),
    reachable: Boolean(reachable),
    lastSuccessAt,
    lastFailureAt
  };
}

function buildSourceFailure({
  source,
  reason = 'request_failed',
  status,
  configured = true,
  detail = '',
  diagnostics = null
} = {}) {
  return {
    source: normaliseSourceKey(source),
    reason,
    status,
    configured,
    detail: toText(detail),
    ...(diagnostics ? buildProviderDiagnostics({ ...diagnostics, source, configured, reachable: false, lastFailureAt: new Date() }) : {})
  };
}

async function updateSourceHealthStats(sourceResults = []) {
  if (!Array.isArray(sourceResults) || !sourceResults.length) return;

  const now = new Date();
  await Promise.all(sourceResults.map((result) => {
    const source = normaliseSourceKey(result.source);
    const jobsFetched = Array.isArray(result.jobs) ? result.jobs.length : 0;
    const reachable = Boolean(result.configured && !result.failure);
    const update = {
      source,
      configured: Boolean(result.configured),
      reachable,
      jobsFetched,
      error: result.failure ? sourceErrorMessage(result.failure) : '',
      endpoint: result.diagnostics?.endpoint || result.failure?.endpoint || '',
      requestQuery: result.diagnostics?.requestQuery || result.failure?.requestQuery || '',
      requestParams: result.diagnostics?.requestParams || result.failure?.requestParams || null,
      statusCode: result.diagnostics?.statusCode || result.failure?.statusCode || result.failure?.status || null,
      responseBody: result.diagnostics?.responseBody || result.failure?.responseBody || null
    };

    if (reachable) {
      update.lastSuccessAt = now;
    } else if (result.failure) {
      update.lastFailureAt = now;
    }

    return JobSourceHealth.findOneAndUpdate(
      { source },
      { $set: update },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).catch((error) => {
      console.warn(`[JobService] Failed to update source health for ${source}: ${error.message}`);
    });
  }));
}

function buildSourceResult(source, jobs = [], failure = null, configured = true, diagnostics = null) {
  return {
    source,
    jobs: Array.isArray(jobs) ? jobs : [],
    configured,
    failure,
    diagnostics: diagnostics ? buildProviderDiagnostics({
      ...diagnostics,
      source,
      configured,
      reachable: configured && !failure
    }) : null
  };
}

function computeCacheExpiry() {
  return new Date(Date.now() + JOB_CACHE_TTL_MS);
}

function toJobCacheDocument(job = {}) {
  const normalized = normaliseJob(job, 0, job.source || job.platform || 'Unknown');
  if (!isUsableJob(normalized)) return null;

  const platform = normalisePlatform(normalized.platform || normalized.source);

  return {
    jobId: toText(normalized.id),
    externalJobId: toText(normalized.externalJobId),
    source: toText(normalized.source || normalized.platform || 'Other'),
    platform: platform === 'All' ? 'Other' : platform,
    title: normalized.title,
    company: normalized.company,
    companyLogo: toText(normalized.companyLogo),
    description: normalized.description,
    requirements: Array.isArray(normalized.requirements) ? normalized.requirements : [],
    benefits: Array.isArray(normalized.benefits) ? normalized.benefits : [],
    skills: Array.isArray(normalized.skills) ? normalized.skills : [],
    salary: normalized.salary,
    location: normalized.location,
    jobType: normalized.jobType,
    experienceLevel: normalized.experienceLevel,
    applyUrl: toText(normalized.applyUrl || normalized.url),
    postedDate: normalized.postedDate,
    lastSynced: new Date(),
    expiresAt: computeCacheExpiry()
  };
}

function mapCachedJobRecord(record = {}, index = 0) {
  return normaliseJob({
    id: record.jobId,
    externalJobId: record.externalJobId,
    title: record.title,
    company: record.company,
    companyLogo: record.companyLogo,
    location: record.location,
    salary: record.salary,
    jobType: record.jobType,
    skills: record.skills,
    postedDate: record.postedDate,
    description: record.description,
    requirements: record.requirements,
    benefits: record.benefits,
    platform: record.platform || record.source,
    url: record.applyUrl,
    applyUrl: record.applyUrl,
    experienceLevel: record.experienceLevel
  }, index, record.source || record.platform || 'Cached');
}

async function syncJobsToCache(jobs = []) {
  const documents = jobs
    .map((job) => toJobCacheDocument(job))
    .filter(Boolean);

  if (!documents.length) {
    return {
      attempted: 0,
      synced: 0,
      upserted: 0,
      modified: 0,
      matched: 0,
      skippedRecentlySynced: 0,
      failed: false
    };
  }

  const recentlySyncedSince = new Date(Date.now() - 60 * 60 * 1000);
  const recentlySyncedKeys = await JobCache.find({
    expiresAt: { $gt: new Date() },
    lastSynced: { $gte: recentlySyncedSince }
  }).select('source externalJobId applyUrl').lean();

  const recentKeySet = new Set(
    recentlySyncedKeys.map((record) => [
      toText(record.source).toLowerCase(),
      toText(record.externalJobId).toLowerCase(),
      toText(record.applyUrl).toLowerCase().replace(/\/$/, '')
    ].join('|'))
  );

  const deduped = documents.filter((document) => {
    const key = [
      toText(document.source).toLowerCase(),
      toText(document.externalJobId).toLowerCase(),
      toText(document.applyUrl).toLowerCase().replace(/\/$/, '')
    ].join('|');
    return !recentKeySet.has(key);
  });

  const skippedRecentlySynced = documents.length - deduped.length;

  if (!deduped.length) {
    return {
      attempted: documents.length,
      synced: 0,
      upserted: 0,
      modified: 0,
      matched: 0,
      skippedRecentlySynced,
      failed: false
    };
  }

  try {
    const result = await JobCache.bulkWrite(
      deduped.map((document) => ({
        updateOne: {
          filter: { jobId: document.jobId },
          update: { $set: document },
          upsert: true
        }
      })),
      { ordered: false }
    );

    return {
      attempted: documents.length,
      synced: deduped.length,
      upserted: Number(result.upsertedCount || 0),
      modified: Number(result.modifiedCount || 0),
      matched: Number(result.matchedCount || 0),
      skippedRecentlySynced,
      failed: false
    };
  } catch (error) {
    console.warn('[JobService] Failed to sync JobCache:', error.message);
    return {
      attempted: documents.length,
      synced: 0,
      upserted: 0,
      modified: 0,
      matched: 0,
      skippedRecentlySynced,
      failed: true,
      error: error.message
    };
  }
}

async function loadActiveCachedJobs() {
  const now = new Date();
  const records = await JobCache.find({ expiresAt: { $gt: now } })
    .sort({ lastSynced: -1, updatedAt: -1 })
    .lean();

  return records
    .map((record, index) => mapCachedJobRecord(record, index))
    .filter(isUsableJob);
}

async function findCachedJobById(id = '') {
  const normalizedId = toText(id);
  if (!normalizedId) return null;

  const record = await JobCache.findOne({
    expiresAt: { $gt: new Date() },
    $or: [
      { jobId: normalizedId },
      { externalJobId: normalizedId }
    ]
  }).lean();

  return record ? mapCachedJobRecord(record, 0) : null;
}

function inferJobStack(job = {}) {
  const haystack = [
    job.title,
    job.description,
    ...(job.skills || [])
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  if (/(machine learning|tensorflow|pytorch|data science|\bai\b|\bml\b|llm)/.test(haystack)) return 'AI/ML';
  if (/(react|angular|vue|frontend|front-end|html|css|ui|ux|next\.js)/.test(haystack)) {
    if (/(node|express|api|backend|server|django|flask|spring|laravel|postgres|mongodb)/.test(haystack)) return 'Full Stack';
    return 'Frontend';
  }
  if (/(node|express|api|backend|server|django|flask|spring|laravel|postgres|mongodb|java|golang|php)/.test(haystack)) return 'Backend';
  return 'Full Stack';
}

const QUALITY_THRESHOLDS = {
  sourceDiversity: { excellent: 4, healthy: 2 },
  stackDiversity: { excellent: 6, healthy: 3 },
  freshnessRatio: { excellent: 0.6, healthy: 0.3 },
  validApplyUrlRatio: { excellent: 0.9, healthy: 0.7 }
};

async function getJobCacheMetrics() {
  const now = new Date();
  const records = await JobCache.find({ expiresAt: { $gt: now } })
    .select('source title description skills location experienceLevel jobType applyUrl postedDate lastSynced createdAt updatedAt')
    .lean();

  const jobsBySource = records.reduce((accumulator, job) => {
    const key = normaliseSourceKey(job.source || 'unknown');
    accumulator[key] = Number(accumulator[key] || 0) + 1;
    return accumulator;
  }, buildSourceSummarySeed());

  const jobsByStack = records.reduce((accumulator, job) => {
    const stack = inferJobStack(job);
    accumulator[stack] = Number(accumulator[stack] || 0) + 1;
    return accumulator;
  }, {});

  const jobsByExperience = records.reduce((accumulator, job) => {
    const level = toText(job.experienceLevel) || 'Unspecified';
    accumulator[level] = Number(accumulator[level] || 0) + 1;
    return accumulator;
  }, {});

  const locationCategories = { remoteJobs: 0, onsiteJobs: 0, hybridJobs: 0 };
  const jobsByLocation = records.reduce((accumulator, job) => {
    const loc = toText(job.location).toLowerCase();
    let region = 'Other';

    if (loc.includes('remote')) {
      locationCategories.remoteJobs += 1;
      region = 'Remote';
    } else if (loc.includes('hybrid')) {
      locationCategories.hybridJobs += 1;
      region = 'Hybrid';
    } else if (!loc || loc === 'unspecified') {
      region = 'Unspecified';
      locationCategories.onsiteJobs += 1;
    } else {
      locationCategories.onsiteJobs += 1;
      if (/(usa|united states|new york|san francisco|seattle|austin|chicago)/.test(loc)) region = 'USA';
      else if (/(europe|uk|london|germany|berlin|france|spain|netherlands|amsterdam|remote eu)/.test(loc)) region = 'Europe';
      else if (/(pakistan|lahore|karachi|islamabad)/.test(loc)) region = 'Pakistan';
      else if (/(india|bangalore|mumbai|delhi)/.test(loc)) region = 'India';
      else if (/(canada|toronto|vancouver)/.test(loc)) region = 'Canada';
      else if (/(australia|sydney|melbourne)/.test(loc)) region = 'Australia';
    }

    accumulator[region] = Number(accumulator[region] || 0) + 1;
    return accumulator;
  }, {});

  const timestamps = records
    .map((job) => new Date(job.lastSynced || job.updatedAt || job.createdAt).getTime())
    .filter((value) => Number.isFinite(value));

  const fortyEightHoursAgo = Date.now() - (48 * 60 * 60 * 1000);
  const freshJobs = timestamps.filter((ts) => ts >= fortyEightHoursAgo).length;
  const validApplyUrlJobs = records.filter((job) => isHttpUrl(job.applyUrl)).length;

  return {
    totalCachedJobs: records.length,
    jobsBySource,
    jobsByStack,
    jobsByExperience,
    jobsByLocation,
    ...locationCategories,
    oldestJob: timestamps.length ? new Date(Math.min(...timestamps)) : null,
    newestJob: timestamps.length ? new Date(Math.max(...timestamps)) : null,
    qualityMetrics: {
      sourceDiversity: Object.values(jobsBySource).filter((v) => v > 0).length,
      stackDiversity: Object.keys(jobsByStack).length,
      freshnessRatio: records.length ? freshJobs / records.length : 0,
      validApplyUrlRatio: records.length ? validApplyUrlJobs / records.length : 0,
      freshJobs,
      validApplyUrlJobs
    }
  };
}

function computeQualityScore(qualityMetrics = {}) {
  const { sourceDiversity = 0, stackDiversity = 0, freshnessRatio = 0, validApplyUrlRatio = 0 } = qualityMetrics;

  const scores = [
    sourceDiversity >= QUALITY_THRESHOLDS.sourceDiversity.excellent ? 2
      : sourceDiversity >= QUALITY_THRESHOLDS.sourceDiversity.healthy ? 1 : 0,
    stackDiversity >= QUALITY_THRESHOLDS.stackDiversity.excellent ? 2
      : stackDiversity >= QUALITY_THRESHOLDS.stackDiversity.healthy ? 1 : 0,
    freshnessRatio >= QUALITY_THRESHOLDS.freshnessRatio.excellent ? 2
      : freshnessRatio >= QUALITY_THRESHOLDS.freshnessRatio.healthy ? 1 : 0,
    validApplyUrlRatio >= QUALITY_THRESHOLDS.validApplyUrlRatio.excellent ? 2
      : validApplyUrlRatio >= QUALITY_THRESHOLDS.validApplyUrlRatio.healthy ? 1 : 0
  ];

  const total = scores.reduce((sum, s) => sum + s, 0);
  if (total >= 7) return 'EXCELLENT';
  if (total >= 4) return 'HEALTHY';
  return 'LOW';
}

function computeCacheStatus(totalCachedJobs) {
  if (totalCachedJobs >= 300) return 'EXCELLENT';
  if (totalCachedJobs >= 100) return 'HEALTHY';
  return 'LOW';
}

async function getCacheHealth() {
  const metrics = await getJobCacheMetrics();
  return {
    totalCachedJobs: metrics.totalCachedJobs,
    jobsBySource: metrics.jobsBySource,
    jobsByStack: metrics.jobsByStack,
    jobsByExperience: metrics.jobsByExperience,
    jobsByLocation: metrics.jobsByLocation,
    remoteJobs: metrics.remoteJobs,
    onsiteJobs: metrics.onsiteJobs,
    hybridJobs: metrics.hybridJobs,
    oldestJob: metrics.oldestJob,
    newestJob: metrics.newestJob,
    cacheStatus: computeCacheStatus(metrics.totalCachedJobs),
    qualityScore: computeQualityScore(metrics.qualityMetrics),
    qualityMetrics: metrics.qualityMetrics
  };
}

async function getSourceHealth() {
  const metrics = await getJobCacheMetrics();
  const healthRows = await JobSourceHealth.find({}).lean();
  const healthBySource = healthRows.reduce((accumulator, row) => {
    accumulator[normaliseSourceKey(row.source)] = row;
    return accumulator;
  }, {});
  const integrations = getIntegrationSecretsSync();
  const rapidApiKey = String(process.env.RAPIDAPI_KEY || integrations?.jobsApiKey || '').trim();
  const configuredBySource = {
    jsearch: integrations?.jobsEnabled !== false && Boolean(rapidApiKey && rapidApiKey !== 'your_rapidapi_key'),
    jooble: Boolean(toText(process.env.JOOBLE_API_KEY)),
    adzuna: Boolean(toText(process.env.ADZUNA_APP_ID) && toText(process.env.ADZUNA_APP_KEY)),
    remotive: true,
    arbeitnow: true,
    remoteok: true
  };

  const sources = LIVE_SOURCE_KEYS.reduce((accumulator, source) => {
    const row = healthBySource[source] || {};
    const displayName = SOURCE_DISPLAY_NAMES[source] || source;
    accumulator[displayName] = {
      source: displayName,
      configured: row.configured ?? configuredBySource[source] ?? false,
      reachable: Boolean(row.reachable),
      jobsFetched: Number(row.jobsFetched || 0),
      lastSuccessAt: row.lastSuccessAt || null,
      lastFailureAt: row.lastFailureAt || null,
      error: row.error || '',
      endpoint: row.endpoint || '',
      requestQuery: row.requestQuery || '',
      requestParams: row.requestParams || null,
      statusCode: row.statusCode || null,
      responseBody: row.responseBody || null,
      cacheCount: Number(metrics.jobsBySource[source] || 0)
    };
    return accumulator;
  }, {});

  return {
    sources,
    cacheMetrics: metrics
  };
}

function normalisePlatform(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'All';
  if (value.includes('jsearch')) return 'JSearch';
  if (value.includes('jooble')) return 'Jooble';
  if (value.includes('adzuna')) return 'Adzuna';
  if (value.includes('remotive')) return 'Remotive';
  if (value.includes('arbeitnow') || value.includes('arbeit now')) return 'Arbeitnow';
  if (value.includes('linkedin')) return 'LinkedIn';
  if (value.includes('indeed')) return 'Indeed';
  if (value.includes('rozee')) return 'Rozee';
  if (value.includes('glassdoor')) return 'Glassdoor';
  if (value.includes('remoteok') || value.includes('remote ok')) return 'RemoteOK';
  return 'All';
}

function normaliseJobType(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'All';
  if (value.includes('full')) return 'Full Time';
  if (value.includes('part')) return 'Part Time';
  if (value.includes('contract')) return 'Contract';
  if (value.includes('intern')) return 'Internship';
  if (value.includes('remote')) return 'Remote';
  return 'All';
}

function normaliseLocation(raw) {
  const value = toText(raw).toLowerCase();
  return LOCATION_ALIASES[value] || 'All';
}

function normaliseExperienceFilter(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'All';
  if (value.includes('student') || value.includes('intern')) return 'Intern';
  if (value.includes('entry') || value.includes('0-1') || value.includes('junior')) return 'Entry';
  if (value.includes('1-2') || value.includes('0-2')) return '1-2 years';
  if (value.includes('3-5') || value.includes('2-3') || value.includes('mid')) return '3-5 years';
  if (value.includes('5+') || value.includes('senior') || value.includes('lead')) return '5+ years';
  return 'All';
}

function normaliseJobFilters(query = {}) {
  const platform = normalisePlatform(query.platform ?? query.source);
  const location = normaliseLocation(query.location);
  const skills = toText(query.skills ?? query.skill).replace(/\s+/g, ' ').slice(0, 60);
  const jobType = normaliseJobType(query.jobType);
  const expLevel = normaliseExperienceFilter(query.expLevel ?? query.experienceLevel);
  const page = Math.max(JOB_LIMITS.minPage, Number.parseInt(query.page, 10) || JOB_LIMITS.defaultPage);
  const limit = clamp(Number.parseInt(query.limit, 10) || JOB_LIMITS.defaultLimit, 1, JOB_LIMITS.maxLimit);

  return {
    platform: VALID_PLATFORMS.includes(platform) ? platform : 'All',
    location: VALID_LOCATIONS.includes(location) ? location : 'All',
    skills,
    jobType: VALID_JOB_TYPES.includes(jobType) ? jobType : 'All',
    expLevel: VALID_EXP_LEVELS.includes(expLevel) ? expLevel : 'All',
    page,
    limit
  };
}

function stableId(prefix, values = []) {
  const seed = values.map((value) => toText(value).toLowerCase()).join('|');
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
  return `${prefix}_${hash}`;
}

function inferPlatform(url = '', preferred = '') {
  const lower = toText(url).toLowerCase();
  const normalizedPreferred = normalisePlatform(preferred);
  if (normalizedPreferred && normalizedPreferred !== 'All') return normalizedPreferred;
  if (lower.includes('jooble.org')) return 'Jooble';
  if (lower.includes('adzuna.')) return 'Adzuna';
  if (lower.includes('remotive.com')) return 'Remotive';
  if (lower.includes('arbeitnow.com')) return 'Arbeitnow';
  if (lower.includes('linkedin.com')) return 'LinkedIn';
  if (lower.includes('indeed.com')) return 'Indeed';
  if (lower.includes('rozee.pk')) return 'Rozee';
  if (lower.includes('glassdoor.com')) return 'Glassdoor';
  if (lower.includes('remoteok.com')) return 'RemoteOK';
  return 'Other';
}

function mapExperienceMonthsToLabel(months) {
  if (months < 12) return 'Entry';
  if (months < 36) return '1-2 years';
  if (months < 60) return '3-5 years';
  return '5+ years';
}

function normaliseExperienceLabel(raw) {
  const value = toText(raw);
  if (!value) return 'Entry';
  const normalized = normaliseExperienceFilter(value);
  return normalized === 'All' ? 'Entry' : normalized;
}

function normalizeProviderQuery(query = '', fallback = 'software developer') {
  const normalized = toText(query).replace(/[^\w\s+#./-]/g, ' ').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 90);
}

function normalizeAdzunaCountry(raw = '') {
  const value = toText(raw || 'us').toLowerCase();
  const country = ADZUNA_COUNTRY_ALIASES[value] || value;
  return ADZUNA_SUPPORTED_COUNTRIES.has(country) ? country : 'us';
}

function getAdzunaWhere(filters = {}, country = 'us') {
  const location = normaliseLocation(filters.location);
  if (!location || location === 'All' || location === 'Remote') return '';
  if (location === 'USA') return country === 'us' ? 'United States' : '';
  if (location === 'Pakistan') return country === 'pk' ? 'Pakistan' : '';
  if (location === 'Europe') return '';
  return location;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(toText(value));
}

function stripHtml(value = '') {
  return toText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeStringList(values = [], limit = 12) {
  if (Array.isArray(values)) return uniqueStrings(values, limit);
  const text = stripHtml(values);
  if (!text) return [];
  return uniqueStrings(text.split(/\n|,|•|;|\|/), limit);
}

function extractSkillsFromText(...parts) {
  const catalog = [
    'Angular', 'React', 'Vue.js', 'Next.js', 'Node.js', 'Express', 'TypeScript', 'JavaScript',
    'Python', 'Django', 'Flask', 'Java', 'Spring Boot', 'PHP', 'Laravel', '.NET', 'C#',
    'Ruby', 'Rails', 'Go', 'Golang', 'GraphQL', 'REST APIs', 'MongoDB', 'PostgreSQL',
    'MySQL', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'CI/CD', 'Git',
    'Tailwind CSS', 'SCSS', 'HTML', 'CSS', 'Redux', 'RxJS', 'Jest', 'Cypress',
    'TensorFlow', 'PyTorch', 'Machine Learning', 'Data Science', 'LLM'
  ];
  const haystack = parts.map(stripHtml).join(' ').toLowerCase();
  return uniqueStrings(
    catalog.filter((skill) => haystack.includes(skill.toLowerCase())),
    10
  );
}

function normaliseJob(job = {}, index = 0, source = 'Unknown') {
  const title = toText(job.title) || 'Software Engineer';
  const company = toText(job.company) || 'Technology Company';
  const location = toText(job.location) || 'Remote';
  const description = stripHtml(job.description) || 'Opportunity details were not provided by the source.';
  const applyUrl = isHttpUrl(job.applyUrl) ? toText(job.applyUrl) : (isHttpUrl(job.url) ? toText(job.url) : '');
  const url = isHttpUrl(job.url) ? toText(job.url) : applyUrl;
  const platform = inferPlatform(job.url, job.platform);
  const skills = uniqueStrings(
    Array.isArray(job.skills) && job.skills.length ? job.skills : extractSkillsFromText(title, description, job.requirements),
    10
  );
  const jobType = normaliseJobType(job.jobType) === 'All'
    ? (location.toLowerCase().includes('remote') ? 'Remote' : 'Full Time')
    : normaliseJobType(job.jobType);
  const postedDate = /\d{4}-\d{2}-\d{2}/.test(toText(job.postedDate))
    ? toText(job.postedDate)
    : new Date().toISOString().split('T')[0];
  const experienceLevel = normaliseExperienceLabel(job.experienceLevel);
  const salary = toText(job.salary) || 'Competitive';
  const requirements = normalizeStringList(job.requirements, 12);
  const benefits = normalizeStringList(job.benefits, 10);

  return {
    id: toText(job.id) || stableId('job', [source, title, company, location, platform, index]),
    externalJobId: toText(job.externalJobId || job.id),
    title,
    company,
    companyLogo: toText(job.companyLogo),
    location,
    salary,
    jobType,
    skills,
    postedDate,
    description,
    requirements,
    benefits,
    platform,
    url,
    applyUrl,
    experienceLevel,
    source,
    matchScore: Number(job.matchScore || 0),
    whyMatched: toText(job.whyMatched),
    missingSkills: uniqueStrings(job.missingSkills || [], 5),
    logoFallback: company.charAt(0).toUpperCase(),
    platformColor: PLATFORM_COLORS[platform] || PLATFORM_COLORS.Other
  };
}

function mapJSearchJob(job = {}, index = 0) {
  const applyLink = toText(job.job_apply_link);
  const location = [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ') || (job.job_is_remote ? 'Remote' : 'Remote');
  const salary = job.job_min_salary && job.job_max_salary
    ? `$${job.job_min_salary}-${job.job_max_salary}/${job.job_salary_period || 'year'}`
    : 'Competitive';
  const highlights = job.job_highlights || {};
  const skills = Array.isArray(job.job_required_skills)
    ? job.job_required_skills
    : extractSkillsFromText(job.job_title, job.job_description, highlights.Qualifications);
  const experienceLevel = typeof job.job_required_experience?.required_experience_in_months === 'number'
    ? mapExperienceMonthsToLabel(job.job_required_experience.required_experience_in_months)
    : 'Entry';

  return normaliseJob({
    id: stableId('jsearch', [job.job_id || index, job.job_title, job.employer_name, applyLink]),
    externalJobId: job.job_id,
    title: job.job_title,
    company: job.employer_name,
    companyLogo: job.employer_logo || '',
    location,
    salary,
    jobType: String(job.job_employment_type || '').replace('_', ' '),
    skills,
    postedDate: job.job_posted_at_datetime_utc ? String(job.job_posted_at_datetime_utc).split('T')[0] : '',
    description: job.job_description,
    requirements: highlights.Qualifications || [],
    benefits: highlights.Benefits || [],
    platform: 'JSearch',
    url: applyLink,
    applyUrl: applyLink,
    experienceLevel
  }, index, 'JSearch');
}

async function fetchJSearchJobs(query, maxResults = 80) {
  const integrations = getIntegrationSecretsSync();
  const rapidApiKey = String(process.env.RAPIDAPI_KEY || integrations?.jobsApiKey || '').trim();
  const safeQuery = normalizeProviderQuery(query);
  const baseDiagnostics = {
    source: 'jsearch',
    endpoint: JSEARCH_BASE,
    requestQuery: safeQuery,
    requestParams: { query: safeQuery, page: 1, num_pages: 1 }
  };
  if (integrations?.jobsEnabled === false) {
    console.warn('[JobService] JSearch disabled by platform settings.');
    return buildSourceResult('jsearch', [], buildSourceFailure({
      source: 'jsearch',
      reason: 'disabled_by_settings',
      configured: false,
      diagnostics: baseDiagnostics
    }), false, baseDiagnostics);
  }
  if (!rapidApiKey || rapidApiKey === 'your_rapidapi_key') {
    console.warn('[JobService] JSearch disabled: RAPIDAPI_KEY is missing or placeholder.');
    return buildSourceResult('jsearch', [], buildSourceFailure({
      source: 'jsearch',
      reason: 'missing_api_key',
      configured: false,
      diagnostics: baseDiagnostics
    }), false, baseDiagnostics);
  }

  const headers = {
    'X-RapidAPI-Key': rapidApiKey,
    'X-RapidAPI-Host': JSEARCH_HOST,
    'User-Agent': 'Developer-Portfolio-Analyzer/1.0'
  };

  let lastFailure = null;
  let lastSuccessfulDiagnostics = null;
  for (let attempt = 0; attempt <= JSEARCH_RETRIES; attempt += 1) {
    const relaxedQuery = normalizeProviderQuery(attempt > 0 ? `${safeQuery} developer` : safeQuery);
    const maxPages = Math.max(1, Math.min(Math.ceil(maxResults / 10), attempt > 0 ? 2 : 3));
    const attemptDiagnostics = {
      ...baseDiagnostics,
      requestQuery: relaxedQuery,
      requestParams: { query: relaxedQuery, page: 1, num_pages: 1 }
    };

    try {
      const aggregated = [];

      for (let page = 1; page <= maxPages; page += 1) {
        const requestParams = { query: relaxedQuery, page, num_pages: 1 };
        const response = await axios.get(JSEARCH_BASE, {
          params: requestParams,
          headers,
          timeout: JSEARCH_TIMEOUT_MS
        });
        const pageJobs = response.data?.data || [];
        attemptDiagnostics.requestParams = requestParams;
        attemptDiagnostics.statusCode = response.status;
        attemptDiagnostics.responseBody = { dataCount: Array.isArray(pageJobs) ? pageJobs.length : 0 };
        lastSuccessfulDiagnostics = { ...attemptDiagnostics };
        if (!pageJobs.length) break;
        aggregated.push(...pageJobs);
        if (aggregated.length >= maxResults) break;
      }

      if (aggregated.length) {
        return buildSourceResult(
          'jsearch',
          aggregated.slice(0, maxResults).map((job, index) => mapJSearchJob(job, index)),
          null,
          true,
          {
            ...attemptDiagnostics,
            statusCode: 200,
            responseBody: { jobsFetched: aggregated.length }
          }
        );
      }
    } catch (error) {
      const status = error?.response?.status;
      const message = error?.response?.data?.message || error.message;
      lastFailure = buildSourceFailure({
        source: 'jsearch',
        reason: 'request_failed',
        status,
        configured: true,
        detail: message,
        diagnostics: {
          ...attemptDiagnostics,
          statusCode: status,
          responseBody: error?.response?.data || null
        }
      });
      console.warn(`[JobService] JSearch attempt ${attempt + 1} failed${status ? ` (${status})` : ''}: ${message}`);

      if (status === 401 || status === 403) break;
      if (status === 429 && attempt < JSEARCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }

  if (lastSuccessfulDiagnostics && !lastFailure) {
    return buildSourceResult('jsearch', [], null, true, {
      ...lastSuccessfulDiagnostics,
      responseBody: { jobsFetched: 0 }
    });
  }

  return buildSourceResult('jsearch', [], lastFailure || buildSourceFailure({
    source: 'jsearch',
    reason: 'request_failed',
    configured: true,
    detail: 'JSearch returned no jobs for the validated query.',
    diagnostics: baseDiagnostics
  }), true, lastFailure || baseDiagnostics);
}

function mapJoobleJob(job = {}, index = 0) {
  const url = toText(job.link || job.url);
  const description = stripHtml(job.snippet || job.description);
  return normaliseJob({
    id: stableId('jooble', [job.id || index, job.title, job.company, url]),
    externalJobId: job.id,
    title: job.title,
    company: job.company,
    companyLogo: '',
    location: job.location || 'Remote',
    salary: job.salary,
    jobType: job.type,
    skills: extractSkillsFromText(job.title, description),
    postedDate: job.updated ? String(job.updated).split('T')[0] : '',
    description,
    requirements: [],
    benefits: [],
    platform: 'Jooble',
    url,
    applyUrl: url,
    experienceLevel: job.experienceLevel
  }, index, 'Jooble');
}

async function fetchJoobleJobs(query, filters = {}, maxResults = 40) {
  const apiKey = toText(process.env.JOOBLE_API_KEY);
  const endpoint = `${JOOBLE_BASE}/${apiKey ? '[configured]' : ''}`;
  const requestParams = {
    keywords: normalizeProviderQuery(query),
    location: filters.location && filters.location !== 'All' ? filters.location : '',
    page: 1
  };
  const diagnostics = {
    source: 'jooble',
    endpoint,
    requestQuery: requestParams.keywords,
    requestParams
  };
  if (!apiKey) {
    return buildSourceResult('jooble', [], buildSourceFailure({
      source: 'jooble',
      reason: 'missing_api_key',
      configured: false,
      diagnostics
    }), false, diagnostics);
  }

  try {
    const response = await axios.post(`${JOOBLE_BASE}/${apiKey}`, requestParams, {
      timeout: SECONDARY_SOURCE_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' }
    });
    const jobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
    return buildSourceResult('jooble', jobs.slice(0, maxResults).map((job, index) => mapJoobleJob(job, index)), null, true, {
      ...diagnostics,
      statusCode: response.status,
      responseBody: { jobsFetched: jobs.length }
    });
  } catch (error) {
    const status = error?.response?.status;
    console.warn(`[JobService] Jooble failed: ${status || ''} ${error.message}`);
    return buildSourceResult('jooble', [], buildSourceFailure({
      source: 'jooble',
      reason: 'request_failed',
      status,
      configured: true,
      detail: error.message,
      diagnostics: {
        ...diagnostics,
        statusCode: status,
        responseBody: error?.response?.data || null
      }
    }), true, {
      ...diagnostics,
      statusCode: status,
      responseBody: error?.response?.data || null
    });
  }
}

function mapAdzunaJob(job = {}, index = 0) {
  const company = typeof job.company === 'object' ? job.company?.display_name : job.company;
  const location = typeof job.location === 'object'
    ? [job.location.display_name, job.location.area?.slice(-1)?.[0]].filter(Boolean).join(', ')
    : job.location;
  const salary = job.salary_min && job.salary_max
    ? `${job.salary_min}-${job.salary_max}`
    : '';

  return normaliseJob({
    id: stableId('adzuna', [job.id || index, job.title, company, job.redirect_url]),
    externalJobId: job.id,
    title: job.title,
    company,
    companyLogo: '',
    location,
    salary,
    jobType: job.contract_time || job.contract_type,
    skills: extractSkillsFromText(job.title, job.description),
    postedDate: job.created ? String(job.created).split('T')[0] : '',
    description: job.description,
    requirements: [],
    benefits: [],
    platform: 'Adzuna',
    url: job.redirect_url,
    applyUrl: job.redirect_url,
    experienceLevel: job.experienceLevel
  }, index, 'Adzuna');
}

async function fetchAdzunaJobs(query, filters = {}, maxResults = 40) {
  const appId = toText(process.env.ADZUNA_APP_ID);
  const appKey = toText(process.env.ADZUNA_APP_KEY);
  const country = normalizeAdzunaCountry(process.env.ADZUNA_COUNTRY || 'us');
  const endpoint = `${ADZUNA_BASE}/${country}/search/1`;
  const safeQuery = normalizeProviderQuery(
    filters.location === 'Remote' ? `${query} remote` : query,
    'software developer'
  );
  const where = getAdzunaWhere(filters, country);
  const requestParams = {
    app_id: appId,
    app_key: appKey,
    results_per_page: Math.min(Math.max(Number(maxResults) || 1, 1), 50),
    what: safeQuery,
    ...(where ? { where } : {}),
    'content-type': 'application/json'
  };
  const diagnostics = {
    source: 'adzuna',
    endpoint,
    requestQuery: safeQuery,
    requestParams
  };
  if (!appId || !appKey) {
    return buildSourceResult('adzuna', [], buildSourceFailure({
      source: 'adzuna',
      reason: 'missing_api_key',
      configured: false,
      diagnostics
    }), false, diagnostics);
  }

  try {
    const response = await axios.get(endpoint, {
      params: requestParams,
      timeout: SECONDARY_SOURCE_TIMEOUT_MS
    });
    const jobs = Array.isArray(response.data?.results) ? response.data.results : [];
    return buildSourceResult(
      'adzuna',
      jobs.slice(0, maxResults).map((job, index) => mapAdzunaJob(job, index)),
      null,
      true,
      {
        ...diagnostics,
        statusCode: response.status,
        responseBody: { jobsFetched: jobs.length }
      }
    );
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.message || error.message;
    console.warn(`[JobService] Adzuna failed: ${status || ''} ${detail}`);
    return buildSourceResult('adzuna', [], buildSourceFailure({
      source: 'adzuna',
      reason: 'request_failed',
      status,
      configured: true,
      detail,
      diagnostics: {
        ...diagnostics,
        statusCode: status,
        responseBody: error?.response?.data || null
      }
    }), true, {
      ...diagnostics,
      statusCode: status,
      responseBody: error?.response?.data || null
    });
  }
}

function mapRemotiveJob(job = {}, index = 0) {
  const description = stripHtml(job.description);
  return normaliseJob({
    id: stableId('remotive', [job.id || index, job.title, job.company_name, job.url]),
    externalJobId: job.id,
    title: job.title,
    company: job.company_name,
    companyLogo: job.company_logo,
    location: job.candidate_required_location || 'Remote',
    salary: job.salary,
    jobType: job.job_type,
    skills: Array.isArray(job.tags) ? job.tags : extractSkillsFromText(job.title, description),
    postedDate: job.publication_date ? String(job.publication_date).split('T')[0] : '',
    description,
    requirements: [],
    benefits: [],
    platform: 'Remotive',
    url: job.url,
    applyUrl: job.url,
    experienceLevel: job.experienceLevel
  }, index, 'Remotive');
}

async function fetchRemotiveJobs(query, maxResults = 40) {
  const requestQuery = normalizeProviderQuery(query);
  const diagnostics = {
    source: 'remotive',
    endpoint: REMOTIVE_BASE,
    requestQuery,
    requestParams: { search: requestQuery }
  };
  try {
    const response = await axios.get(REMOTIVE_BASE, {
      params: { search: requestQuery },
      timeout: SECONDARY_SOURCE_TIMEOUT_MS
    });
    const jobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
    return buildSourceResult('remotive', jobs.slice(0, maxResults).map((job, index) => mapRemotiveJob(job, index)), null, true, {
      ...diagnostics,
      statusCode: response.status,
      responseBody: { jobsFetched: jobs.length }
    });
  } catch (error) {
    const status = error?.response?.status;
    console.warn(`[JobService] Remotive failed: ${status || ''} ${error.message}`);
    return buildSourceResult('remotive', [], buildSourceFailure({
      source: 'remotive',
      reason: 'request_failed',
      status,
      configured: true,
      detail: error.message,
      diagnostics: {
        ...diagnostics,
        statusCode: status,
        responseBody: error?.response?.data || null
      }
    }), true, {
      ...diagnostics,
      statusCode: status,
      responseBody: error?.response?.data || null
    });
  }
}

function mapArbeitnowJob(job = {}, index = 0) {
  const createdAt = Number(job.created_at);
  const postedDate = Number.isFinite(createdAt) && createdAt > 0
    ? new Date(createdAt * 1000).toISOString().split('T')[0]
    : '';
  const description = stripHtml(job.description);

  return normaliseJob({
    id: stableId('arbeitnow', [job.slug || index, job.title, job.company_name, job.url]),
    externalJobId: job.slug,
    title: job.title,
    company: job.company_name,
    companyLogo: '',
    location: job.location || (job.remote ? 'Remote' : 'Europe'),
    salary: job.salary,
    jobType: Array.isArray(job.job_types) ? job.job_types[0] : job.job_types,
    skills: Array.isArray(job.tags) ? job.tags : extractSkillsFromText(job.title, description),
    postedDate,
    description,
    requirements: [],
    benefits: [],
    platform: 'Arbeitnow',
    url: job.url,
    applyUrl: job.url,
    experienceLevel: job.experienceLevel
  }, index, 'Arbeitnow');
}

async function fetchArbeitnowJobs(query, maxResults = 40) {
  const requestQuery = normalizeProviderQuery(query);
  const diagnostics = {
    source: 'arbeitnow',
    endpoint: ARBEITNOW_BASE,
    requestQuery,
    requestParams: {}
  };
  try {
    const response = await axios.get(ARBEITNOW_BASE, {
      timeout: SECONDARY_SOURCE_TIMEOUT_MS
    });
    const jobs = Array.isArray(response.data?.data) ? response.data.data : [];
    const needle = toText(requestQuery).toLowerCase();
    const filtered = needle
      ? jobs.filter((job) => `${job.title || ''} ${job.company_name || ''} ${(job.tags || []).join(' ')} ${stripHtml(job.description)}`.toLowerCase().includes(needle.split(' ')[0]))
      : jobs;
    return buildSourceResult('arbeitnow', filtered.slice(0, maxResults).map((job, index) => mapArbeitnowJob(job, index)), null, true, {
      ...diagnostics,
      statusCode: response.status,
      responseBody: { jobsFetched: filtered.length }
    });
  } catch (error) {
    const status = error?.response?.status;
    console.warn(`[JobService] Arbeitnow failed: ${status || ''} ${error.message}`);
    return buildSourceResult('arbeitnow', [], buildSourceFailure({
      source: 'arbeitnow',
      reason: 'request_failed',
      status,
      configured: true,
      detail: error.message,
      diagnostics: {
        ...diagnostics,
        statusCode: status,
        responseBody: error?.response?.data || null
      }
    }), true, {
      ...diagnostics,
      statusCode: status,
      responseBody: error?.response?.data || null
    });
  }
}

function mapRemoteOkJob(job = {}, index = 0) {
  const description = stripHtml(job.description);
  return normaliseJob({
    id: stableId('remoteok', [job.id || job.slug || index, job.position, job.company, job.url]),
    externalJobId: job.id || job.slug,
    title: job.position || job.title,
    company: job.company,
    companyLogo: job.company_logo || job.logo,
    location: job.location || 'Remote',
    salary: job.salary || '',
    jobType: 'Remote',
    skills: Array.isArray(job.tags) ? job.tags : extractSkillsFromText(job.position, description),
    postedDate: job.date ? String(job.date).split('T')[0] : '',
    description,
    requirements: [],
    benefits: [],
    platform: 'RemoteOK',
    url: job.url || (job.slug ? `https://remoteok.com/remote-jobs/${job.slug}` : ''),
    applyUrl: job.apply_url || job.url || (job.slug ? `https://remoteok.com/remote-jobs/${job.slug}` : ''),
    experienceLevel: job.experienceLevel
  }, index, 'RemoteOK');
}

async function fetchRemoteOkJobs(query, maxResults = 40) {
  const requestQuery = normalizeProviderQuery(query);
  const diagnostics = {
    source: 'remoteok',
    endpoint: REMOTEOK_BASE,
    requestQuery,
    requestParams: {}
  };
  try {
    const response = await axios.get(REMOTEOK_BASE, {
      timeout: SECONDARY_SOURCE_TIMEOUT_MS,
      headers: { 'User-Agent': 'Developer-Portfolio-Analyzer/1.0' }
    });
    const rows = Array.isArray(response.data) ? response.data : [];
    const jobs = rows.filter((row) => row && typeof row === 'object' && !row.legal);
    const needle = toText(requestQuery).toLowerCase().split(/\s+/).filter(Boolean)[0];
    const filtered = needle
      ? jobs.filter((job) => `${job.position || ''} ${job.company || ''} ${(job.tags || []).join(' ')} ${stripHtml(job.description)}`.toLowerCase().includes(needle))
      : jobs;
    return buildSourceResult('remoteok', filtered.slice(0, maxResults).map((job, index) => mapRemoteOkJob(job, index)), null, true, {
      ...diagnostics,
      statusCode: response.status,
      responseBody: { jobsFetched: filtered.length }
    });
  } catch (error) {
    const status = error?.response?.status;
    console.warn(`[JobService] RemoteOK failed: ${status || ''} ${error.message}`);
    return buildSourceResult('remoteok', [], buildSourceFailure({
      source: 'remoteok',
      reason: 'request_failed',
      status,
      configured: true,
      detail: error.message,
      diagnostics: {
        ...diagnostics,
        statusCode: status,
        responseBody: error?.response?.data || null
      }
    }), true, {
      ...diagnostics,
      statusCode: status,
      responseBody: error?.response?.data || null
    });
  }
}

function matchesLocation(job, filterLocation) {
  if (!filterLocation || filterLocation === 'All') return true;
  const location = toText(job.location).toLowerCase();
  if (filterLocation === 'Remote') return location.includes('remote');
  if (filterLocation === 'Pakistan') {
    return ['pakistan', 'lahore', 'karachi', 'islamabad', 'rawalpindi'].some((value) => location.includes(value));
  }
  if (filterLocation === 'USA') {
    return ['usa', 'united states', 'new york', 'san francisco', 'seattle', 'austin'].some((value) => location.includes(value));
  }
  if (filterLocation === 'Europe') {
    return ['europe', 'uk', 'london', 'germany', 'berlin', 'amsterdam', 'remote eu'].some((value) => location.includes(value));
  }
  return true;
}

function matchesSkill(job, filterSkills) {
  if (!filterSkills) return true;
  const needle = filterSkills.toLowerCase().trim();
  const aliases = SKILL_ALIASES[needle] || [needle];
  const haystack = [
    job.title,
    job.description,
    job.company,
    job.jobType,
    job.experienceLevel,
    ...(job.skills || []),
    ...(job.requirements || []),
    ...(job.benefits || [])
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  return aliases.some((alias) => {
    const normalizedAlias = String(alias || '').toLowerCase().trim();
    if (!normalizedAlias) return false;
    return haystack.includes(normalizedAlias);
  });
}

function experienceBucket(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'unknown';
  if (['student', 'intern', 'internship', 'entry', 'entry level', 'junior', '0-1 years', '1-2 years', '0-2 years'].some((keyword) => value.includes(keyword))) {
    return 'junior';
  }
  if (['3-5 years', '2-3 years', 'mid', 'mid-level', 'mid level'].some((keyword) => value.includes(keyword))) {
    return 'mid';
  }
  if (['5+ years', 'senior', 'lead', 'principal'].some((keyword) => value.includes(keyword))) {
    return 'senior';
  }
  return 'unknown';
}

function jobHasExplicitExperienceSignal(job = {}) {
  const haystack = [
    job.title,
    job.description,
    ...(job.requirements || [])
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  return /\b(student|intern|internship|entry|junior|mid|senior|lead|principal|[0-9]\s*\+?\s*(years?|yrs?))\b/.test(haystack);
}

function matchesExperience(job, filterExperience) {
  if (!filterExperience || filterExperience === 'All') return true;

  const targetBucket = experienceBucket(filterExperience);
  if (targetBucket === 'unknown') return true;

  const jobBucket = experienceBucket(job.experienceLevel);
  if (jobBucket === 'unknown') return true;

  if (jobBucket === 'junior' && !jobHasExplicitExperienceSignal(job)) {
    return true;
  }

  return jobBucket === targetBucket;
}

function evaluateFilterRemoval(job = {}, filters = {}) {
  if (filters.platform && filters.platform !== 'All' && job.platform !== filters.platform) return 'platform';
  if (!matchesLocation(job, filters.location)) return 'location';
  if (!matchesSkill(job, filters.skills)) return 'skill';
  if (filters.jobType && filters.jobType !== 'All' && toText(job.jobType).toLowerCase() !== filters.jobType.toLowerCase()) return 'jobType';
  if (!matchesExperience(job, filters.expLevel)) return 'experience';
  return '';
}

function applyFilters(jobs = [], filters = {}) {
  return jobs.filter((job) => !evaluateFilterRemoval(job, filters));
}

function applyFiltersWithDiagnostics(jobs = [], filters = {}, hasActiveFilters = true) {
  if (!hasActiveFilters) {
    return {
      jobs,
      diagnostics: {
        before: jobs.length,
        after: jobs.length,
        removed: 0,
        removedBySkill: 0,
        removedByExperience: 0,
        removedByLocation: 0,
        removedByPlatform: 0
      }
    };
  }

  const diagnostics = {
    before: jobs.length,
    after: 0,
    removed: 0,
    removedBySkill: 0,
    removedByExperience: 0,
    removedByLocation: 0,
    removedByPlatform: 0
  };
  const filtered = [];

  for (const job of jobs) {
    const removedBy = evaluateFilterRemoval(job, filters);
    if (!removedBy) {
      filtered.push(job);
      continue;
    }

    diagnostics.removed += 1;
    if (removedBy === 'skill') diagnostics.removedBySkill += 1;
    if (removedBy === 'experience') diagnostics.removedByExperience += 1;
    if (removedBy === 'location') diagnostics.removedByLocation += 1;
    if (removedBy === 'platform') diagnostics.removedByPlatform += 1;
  }

  diagnostics.after = filtered.length;
  if (diagnostics.before > 0 && diagnostics.removed / diagnostics.before >= 0.9) {
    diagnostics.warning = 'Filters may be too restrictive.';
  }

  return {
    jobs: filtered,
    diagnostics
  };
}

function dedupeJobs(jobs = []) {
  const seen = new Set();
  return jobs.filter((job) => {
    const urlKey = toText(job.applyUrl || job.url).toLowerCase().replace(/\/$/, '');
    const key = `${job.title}|${job.company}|${urlKey}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isUsableJob(job = {}) {
  return Boolean(toText(job.title) && toText(job.company) && isHttpUrl(job.applyUrl || job.url));
}

async function fetchLiveJobSources(query, filters) {
  const results = await Promise.all([
    fetchJSearchJobs(query, 40),
    fetchJoobleJobs(query, filters, 35),
    fetchAdzunaJobs(query, filters, 35),
    fetchRemotiveJobs(query, 35),
    fetchArbeitnowJobs(query, 35),
    fetchRemoteOkJobs(query, 35)
  ]);

  const failures = results
    .map((result) => result.failure)
    .filter(Boolean);
  failures.forEach((failure) => logSourceFailure(failure));

  const fetchedSourceSummary = results.reduce((accumulator, result) => {
    accumulator[result.source] = Number(accumulator[result.source] || 0) + result.jobs.length;
    return accumulator;
  }, buildSourceSummarySeed());

  const liveJobs = results.flatMap((result) => result.jobs || []);
  const usableJobs = liveJobs
    .map((job, index) => normaliseJob(job, index, job.source || job.platform || 'Unknown'))
    .filter(isUsableJob);
  const usableSourceSummary = createSourceSummary(usableJobs);
  const dedupedUsableJobs = dedupeJobs(usableJobs);
  const dedupedSourceSummary = createSourceSummary(dedupedUsableJobs);

  return {
    jobs: dedupedUsableJobs,
    sourceResults: results,
    diagnostics: {
      sourceSummaryFetched: fetchedSourceSummary,
      sourceSummaryUsable: usableSourceSummary,
      sourceSummaryAfterSourceDedupe: dedupedSourceSummary,
      sourceFailures: failures,
      sourceConfigs: results.reduce((accumulator, result) => {
        accumulator[result.source] = { configured: result.configured };
        return accumulator;
      }, {}),
      sourceDedupe: {
        before: usableJobs.length,
        after: dedupedUsableJobs.length,
        removed: Math.max(0, usableJobs.length - dedupedUsableJobs.length)
      },
      liveJobsFetched: liveJobs.length,
      allLiveSourcesFailed: results.every((result) => !result.jobs.length)
    }
  };
}

async function refreshJobCache(options = {}) {
  const filters = normaliseJobFilters(options);
  const query = buildSourceQuery(options, filters);
  const liveResult = await fetchLiveJobSources(query, filters);
  const cacheWrite = await syncJobsToCache(liveResult.jobs);
  await updateSourceHealthStats(liveResult.sourceResults);

  return {
    query,
    filters,
    liveResult,
    cacheWrite
  };
}

async function buildJobPool(options = {}) {
  const filters = normaliseJobFilters(options);
  const careerStack = toText(options.careerStack) || 'Full Stack';
  const experienceLevel = toText(options.experienceLevel) || 'Student';
  const skillGaps = uniqueStrings(options.skillGaps || [], 12);
  const knownSkills = uniqueStrings(options.knownSkills || [], 18);
  const resumeSkills = uniqueStrings(options.resumeSkills || [], 18);
  const githubSkills = uniqueStrings(options.githubSkills || [], 18);
  const query = buildSourceQuery({
    careerStack,
    knownSkills,
    resumeSkills
  }, filters);

  const syncResult = await refreshJobCache({
    careerStack,
    knownSkills,
    resumeSkills,
    ...filters
  });
  const cachedJobs = await loadActiveCachedJobs();
  let pool = cachedJobs;
  const hasActiveFilters = [filters.platform, filters.location, filters.jobType, filters.expLevel]
    .some((value) => value && value !== 'All')
    || Boolean(filters.skills);
  const filterResult = applyFiltersWithDiagnostics(pool, filters, hasActiveFilters);
  pool = filterResult.jobs;
  const cacheFilterStats = filterResult.diagnostics;

  const rankInputJobs = dedupeJobs(pool).filter(isUsableJob);
  const rankedJobs = rankJobs(rankInputJobs, {
    careerStack,
    experienceLevel,
    skillGaps,
    knownSkills,
    resumeSkills,
    githubSkills
  });

  return {
    jobs: rankedJobs,
    diagnostics: {
      query,
      sourceSummaryFetched: syncResult.liveResult.diagnostics.sourceSummaryFetched,
      sourceSummaryUsable: syncResult.liveResult.diagnostics.sourceSummaryUsable,
      sourceSummaryAfterSourceDedupe: syncResult.liveResult.diagnostics.sourceSummaryAfterSourceDedupe,
      sourceSummaryBeforeRank: createSourceSummary(rankInputJobs),
      sourceSummaryFinal: createSourceSummary(rankedJobs),
      sourceFailures: syncResult.liveResult.diagnostics.sourceFailures,
      sourceConfigs: syncResult.liveResult.diagnostics.sourceConfigs,
      cacheCount: cachedJobs.length,
      cacheWrite: syncResult.cacheWrite,
      liveJobsFetched: syncResult.liveResult.diagnostics.liveJobsFetched,
      allLiveSourcesFailed: syncResult.liveResult.diagnostics.allLiveSourcesFailed,
      applyFilters: cacheFilterStats,
      dedupeJobs: {
        before: pool.length,
        after: rankInputJobs.length,
        removed: Math.max(0, pool.length - rankInputJobs.length)
      },
      rankJobs: {
        inputCount: rankInputJobs.length,
        sourceSummary: createSourceSummary(rankInputJobs)
      },
      cacheFallback: {
        available: cachedJobs.length,
        used: syncResult.liveResult.jobs.length === 0 && cachedJobs.length > 0
      },
      fromCacheOnly: syncResult.liveResult.jobs.length === 0 && rankedJobs.length > 0
    }
  };
}

module.exports = {
  buildJobPool,
  refreshJobCache,
  findCachedJobById,
  syncJobsToCache,
  getSourceHealth,
  getCacheHealth,
  getJobCacheMetrics,
  normaliseJobFilters,
  normaliseJob,
  applyFilters,
  isUsableJob,
  computeCacheStatus
};
