const developerContext = require('./developerContextService');
const axios = require('axios');
const pool = require('./newsPoolService');
const governance = require('./newsGovernanceService');
const logger = require('../utils/logger');
const { fromNewsAPI, fromGNews, fromHackerNews, fromDevTo, fromReddit } = require('../utils/newsFormatter');
const { rankNewsItems } = require('../utils/newsRanker');
const { getIntegrationSecretsSync } = require('./platformSettingsService');
const { getDeveloperSignals, buildSignalHash } = require('./developerSignalService');
const {
  buildNewsSkillEvidence,
  relatedNewsSkillEvidence,
  SKILL_EVIDENCE_RULE_VERSION
} = require('./newsSkillEvidenceService');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const PROVIDER_TIMEOUT_MS = 7000;
const REDDIT_FEEDS = ['programming', 'webdev', 'MachineLearning', 'devops'];
const SOURCE_NAMES = ['NewsAPI', 'GNews', 'Hacker News', 'Dev.to', 'Reddit'];
const NEWS_TABS = ['for-you', 'trending', 'latest'];
const NEWS_CATEGORIES = [
  'All',
  'Frontend',
  'Backend',
  'Full Stack',
  'AI / ML',
  'DevOps',
  'Mobile',
  'Cybersecurity',
  'Web3'
];
const NEWS_SOURCES = ['All', ...SOURCE_NAMES];
const NEWS_DATE_FILTERS = ['today', 'week', 'month'];
const NEWS_POPULARITY_FILTERS = ['all', 'high'];
const SAFE_PROVIDER_FAILURES = new Set([
  'Provider disabled in platform settings',
  'Provider API key is not configured'
]);

const sanitizeProviderDiagnostics = (diagnostics = []) =>
  (Array.isArray(diagnostics) ? diagnostics : []).map((diagnostic) => ({
    provider: String(diagnostic?.provider || 'Unknown'),
    enabled: Boolean(diagnostic?.enabled),
    configured: Boolean(diagnostic?.configured),
    reachable: Boolean(diagnostic?.reachable),
    articlesFetched: Math.max(0, Number(diagnostic?.articlesFetched || 0)),
    lastSuccess: diagnostic?.lastSuccess || null,
    lastFailure: diagnostic?.lastFailure
      ? SAFE_PROVIDER_FAILURES.has(diagnostic.lastFailure)
        ? diagnostic.lastFailure
        : 'Provider request failed.'
      : null
  }));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const uniqueStrings = (values = [], limit = 8) => {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
};

const normalizeSkillNames = (values = [], limit = 18) =>
  uniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => value?.name || value?.skill || value?.title || value)
      .filter(Boolean),
    limit
  );

const parseDateRange = (dateRange = '') => {
  const now = new Date();
  const lower = String(dateRange || '').toLowerCase();
  if (lower === 'today') return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (lower === 'week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (lower === 'month') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
};

const normalizeFilters = (filters = {}) => {
  const tab = String(filters.tab || 'for-you').toLowerCase();
  const category = String(filters.category || 'All').trim();
  const source = String(filters.source || 'All').trim();
  const dateRange = String(filters.date || 'week').toLowerCase();
  const popularity = String(filters.popularity || 'all').toLowerCase();

  return {
    tab: NEWS_TABS.includes(tab) ? tab : 'for-you',
    category: NEWS_CATEGORIES.includes(category) ? category : 'All',
    source: NEWS_SOURCES.includes(source) ? source : 'All',
    dateRange: NEWS_DATE_FILTERS.includes(dateRange) ? dateRange : 'week',
    search: String(filters.search || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 80),
    popularity: NEWS_POPULARITY_FILTERS.includes(popularity) ? popularity : 'all',
    page: Math.max(1, Number.parseInt(filters.page, 10) || 1),
    limit: clamp(Number.parseInt(filters.limit, 10) || DEFAULT_LIMIT, 1, MAX_LIMIT)
  };
};

const fetchJson = async (source, url, options = {}) => {
  const reservation = await governance.reserve(source);
  if (!reservation.allowed) throw new Error('Provider admission denied');
  try {
    const response = await axios.get(url, {
      ...options,
      timeout: PROVIDER_TIMEOUT_MS,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      headers: { Accept: 'application/json', ...options.headers }
    });
    await governance.finish(reservation, { status: response.status, headers: response.headers });
    return response.data;
  } catch (error) {
    await governance.finish(reservation, {
      failed: true,
      status: error.response?.status || 0,
      headers: error.response?.headers || {}
    });
    // No immediate retry: scheduled attempts must obtain a new reservation.
    throw new Error('Provider request failed');
  }
};

const fetchFromNewsApi = async (sinceDate, token) => {
  const from = sinceDate.toISOString().slice(0, 10);
  const query = encodeURIComponent('(software OR programming OR developer OR javascript OR nodejs)');
  const url = `https://newsapi.org/v2/everything?q=${query}&from=${from}&language=en&sortBy=publishedAt&pageSize=50`;
  const payload = await fetchJson('newsapi', url, { headers: { 'X-Api-Key': token } });
  return fromNewsAPI(payload);
};

const fetchFromGNews = async (sinceDate, token) => {
  const from = sinceDate.toISOString();
  const query = encodeURIComponent('developer OR programming OR software engineering');
  const url = `https://gnews.io/api/v4/search?q=${query}&lang=en&from=${encodeURIComponent(from)}&max=10&apikey=${encodeURIComponent(token)}`;
  const payload = await fetchJson('gnews', url);
  return fromGNews(payload);
};

const fetchFromHackerNews = async () => {
  const query = encodeURIComponent('developer OR javascript OR node OR ai');
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=40`;
  const payload = await fetchJson('hackernews', url);
  return fromHackerNews(payload);
};

const fetchFromDevTo = async () => {
  const payload = await fetchJson('devto', 'https://dev.to/api/articles?per_page=30&top=7');
  return fromDevTo(payload);
};

const fetchFromReddit = async () => {
  const payload = await fetchJson(
    'reddit',
    `https://oauth.reddit.com/r/${REDDIT_FEEDS[Math.floor(Date.now() / 1200000) % REDDIT_FEEDS.length]}/top?t=week&limit=20`,
    {
      headers: {
        Authorization: `Bearer ${process.env.NEWS_REDDIT_ACCESS_TOKEN}`,
        'User-Agent': process.env.NEWS_REDDIT_USER_AGENT
      }
    }
  );
  return fromReddit(payload);
};

const uniqueNewsItems = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const urlKey = String(item?.url || '').trim();
    const titleKey = String(item?.title || '')
      .trim()
      .toLowerCase();
    const key = urlKey || titleKey;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return Boolean(item?.title && item?.url);
  });
};

const matchesFilters = (item, filters, sinceTimestamp) => {
  if (!item?.url || !item?.title) return false;
  if (filters.source !== 'All' && item.source !== filters.source) return false;
  if (filters.category !== 'All' && item.category !== filters.category) return false;
  if (filters.search) {
    const haystack = `${item.title} ${item.description} ${item.source} ${(item.tags || []).join(' ')}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  const publishedAt = new Date(item.publishedAt).getTime();
  if (
    !Number.isFinite(publishedAt) ||
    publishedAt > Date.now() + 300000 ||
    (Number.isFinite(sinceTimestamp) && publishedAt < sinceTimestamp)
  )
    return false;
  if (filters.popularity === 'high' && Number(item.popularity || 0) < 200) return false;
  return true;
};

const extractTrendingTopics = (items = []) => {
  const counters = new Map();
  items.forEach((item) => {
    const text = `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
    ['javascript', 'typescript', 'react', 'angular', 'node', 'docker', 'kubernetes', 'ai', 'llm', 'security'].forEach(
      (topic) => {
        if (new RegExp(`(^|[^a-z0-9])${topic}(?=$|[^a-z0-9])`, 'i').test(text))
          counters.set(topic, (counters.get(topic) || 0) + 1);
      }
    );
  });
  return [...counters.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([topic]) => topic);
};

// Bounded per-account signal resolution only; public article data is shared separately.
// Cross-worker signal changes converge within 15 seconds. Existing profile and sprint
// mutation hooks evict locally; refresh always resolves current canonical signals.
const signalCache = new Map();
const getCachedDeveloperSignals = async (userId, force = false) => {
  const key = String(userId);
  const cached = signalCache.get(key);
  if (!force && cached && cached.until > Date.now()) return cached.promise;
  const entry = { until: Date.now() + 15000 };
  entry.promise = Promise.resolve()
    .then(() => getDeveloperSignals(userId))
    .then((signals) => ({ signals, signalHash: buildSignalHash(signals) }))
    .catch(() => {
      if (signalCache.get(key) === entry) signalCache.delete(key);
      logger.warn('news canonical signals unavailable');
      return { signals: {}, signalHash: 'signals-unavailable' };
    });
  signalCache.delete(key);
  while (signalCache.size >= 250) signalCache.delete(signalCache.keys().next().value);
  signalCache.set(key, entry);
  return entry.promise;
};
const invalidateNewsSignalCache = (userId) => {
  signalCache.delete(String(userId));
};

const buildUserContext = async (user, options = {}) => {
  const defaults = {
    careerStack: developerContext.resolveCareerStack(user) || 'Full Stack',
    experienceLevel: developerContext.resolveExperienceLevel(user) || 'Student',
    careerGoal: user?.careerGoal || '',
    resumeSkills: [],
    githubTechnologies: [],
    skillGaps: [],
    detectedSkills: [],
    skillEvidence: [],
    knownSkills: [],
    targetRole: user?.careerGoal || developerContext.resolveCareerStack(user) || 'Developer',
    jobDemandSkills: [],
    recommendationTechnologies: [],
    activeLearningFocus: '',
    signalHash: 'no-signals',
    signals: {}
  };
  if (!user?._id) return defaults;

  const { signals, signalHash } = await getCachedDeveloperSignals(user._id, !!options.forceRefresh);
  const careerProfile = signals.careerProfileSignal || signals.careerProfile || {};
  const github = signals.githubSignals || {};
  const resume = signals.resumeSignals || {};
  const skillGap = signals.skillGapSignals || {};
  const sprint = signals.careerSprintSignal || signals.careerSprintSignals || {};
  const weekly = signals.weeklyReportSignal || signals.weeklyReportSignals || {};
  const integration = signals.integrationSignal || signals.integrationSignals || {};
  const portfolio = signals.portfolioSignal || signals.portfolioSignals || {};
  const jobsDemand = signals.jobsDemandSignal || signals.jobsDemandSignals || {};
  const recommendations = signals.recommendationSignal || signals.recommendationSignals || {};

  const resumeSkills = normalizeSkillNames(
    [...(resume.skills || []), ...(resume.technicalSkills || []), ...(resume.extractedSkills || [])],
    24
  );
  const githubTechnologies = normalizeSkillNames(
    [
      ...(github.technologies || []),
      ...(github.languageDistribution || []).map((entry) => entry?.language),
      ...(github.repositories || []).flatMap((repo) => [repo?.language, ...(repo?.technologies || [])])
    ],
    18
  );
  const skillGaps = normalizeSkillNames(
    [
      ...(skillGap.missingSkills || []),
      ...(skillGap.weakSkills || []),
      ...(skillGap.immediateSkills || []),
      ...(skillGap.shortTermSkills || []),
      ...(recommendations.skills?.missingSkills || []),
      ...(github.weakAreas || []),
      ...(weekly.repeatedWeakAreas || []),
      ...(sprint.repeatedIncompleteSkills || [])
    ],
    24
  );
  const knownSkills = normalizeSkillNames(
    [
      ...resumeSkills,
      ...githubTechnologies,
      ...(skillGap.knownSkills || []),
      ...(skillGap.provenSkills || []),
      ...(integration.detectedSkills || []),
      ...(portfolio.portfolioSkills || []),
      ...(sprint.completedSkillSignals || [])
    ],
    36
  );
  const jobDemandSkills = normalizeSkillNames(jobsDemand.topSkills || [], 18);
  const recommendationTechnologies = normalizeSkillNames(recommendations.skills?.recommendedTechnologies || [], 18);

  const context = {
    ...defaults,
    careerStack: developerContext.resolveCareerStack(user) || careerProfile.careerStack || defaults.careerStack,
    experienceLevel:
      developerContext.resolveExperienceLevel(user) || careerProfile.experienceLevel || defaults.experienceLevel,
    careerGoal: user.careerGoal || careerProfile.careerGoal || '',
    resumeSkills,
    githubTechnologies,
    skillGaps,
    detectedSkills: knownSkills.slice(0, 18),
    knownSkills,
    targetRole: user.careerGoal || careerProfile.careerGoal || developerContext.resolveCareerStack(user) || 'Developer',
    jobDemandSkills,
    recommendationTechnologies,
    activeLearningFocus: sprint.activeLearningFocus || '',
    signalHash,
    signals
  };
  return { ...context, skillEvidence: buildNewsSkillEvidence(user, context) };
};

const fetchAllSources = async (sinceDate) => {
  const integrations = getIntegrationSecretsSync();
  const sharedNewsToken = String(integrations?.newsApiKey || '').trim();
  const newsApiToken = String(process.env.NEWS_API_KEY || sharedNewsToken).trim();
  const gnewsToken = String(process.env.GNEWS_API_KEY || '').trim();
  const newsEnabled = integrations?.newsEnabled !== false;
  const providers = [
    {
      name: 'NewsAPI',
      enabled: newsEnabled,
      configured: Boolean(newsApiToken),
      fetcher: () => fetchFromNewsApi(sinceDate, newsApiToken)
    },
    {
      name: 'GNews',
      enabled: newsEnabled,
      configured: Boolean(gnewsToken),
      fetcher: () => fetchFromGNews(sinceDate, gnewsToken)
    },
    { name: 'Hacker News', enabled: newsEnabled, configured: true, fetcher: () => fetchFromHackerNews() },
    { name: 'Dev.to', enabled: newsEnabled, configured: true, fetcher: () => fetchFromDevTo() },
    {
      name: 'Reddit',
      enabled: newsEnabled,
      configured: Boolean(process.env.NEWS_REDDIT_ACCESS_TOKEN && process.env.NEWS_REDDIT_USER_AGENT),
      fetcher: () => fetchFromReddit()
    }
  ];

  const nowIso = new Date().toISOString();
  const settled = await Promise.allSettled(
    providers.map((provider) => {
      if (!provider.enabled || !provider.configured) return Promise.resolve([]);
      return provider.fetcher();
    })
  );
  const sourceBuckets = {};
  const providerDiagnostics = [];
  const providerUsed = [];
  let providerFailureCount = 0;

  settled.forEach((result, index) => {
    const provider = providers[index];
    const providerName = provider.name;
    const diagnostic = {
      provider: providerName,
      enabled: Boolean(provider.enabled),
      configured: Boolean(provider.configured),
      reachable: false,
      articlesFetched: 0,
      lastSuccess: null,
      lastFailure: null
    };

    if (!provider.enabled) {
      sourceBuckets[providerName] = [];
      diagnostic.lastFailure = 'Provider disabled in platform settings';
      providerDiagnostics.push(diagnostic);
      return;
    }

    if (!provider.configured) {
      sourceBuckets[providerName] = [];
      diagnostic.lastFailure = 'Provider API key is not configured';
      providerDiagnostics.push(diagnostic);
      return;
    }

    if (result.status === 'fulfilled') {
      sourceBuckets[providerName] = Array.isArray(result.value) ? result.value : [];
      diagnostic.reachable = true;
      diagnostic.articlesFetched = sourceBuckets[providerName].length;
      diagnostic.lastSuccess = nowIso;
      if (sourceBuckets[providerName].length) providerUsed.push(providerName);
    } else {
      providerFailureCount += 1;
      sourceBuckets[providerName] = [];
      diagnostic.lastFailure = 'Provider request failed.';
      logger.warn('news provider failed', { provider: providerName });
    }
    providerDiagnostics.push(diagnostic);
  });

  return { sourceBuckets, providerUsed, providerFailureCount, providerDiagnostics };
};

const buildRecommendedBasedOn = ({ userContext, filters, lastUpdated, sourceStatus, fromCache }) => {
  const activeFilterParts = [];
  if (filters.category !== 'All') activeFilterParts.push(filters.category);
  if (filters.source !== 'All') activeFilterParts.push(filters.source);
  if (filters.search) activeFilterParts.push(`search: ${filters.search}`);
  if (filters.popularity !== 'all') activeFilterParts.push(`${filters.popularity} popularity`);
  if (filters.dateRange !== 'week') activeFilterParts.push(filters.dateRange);

  return {
    careerStack: userContext.careerStack,
    experienceLevel: userContext.experienceLevel,
    targetRole: userContext.targetRole,
    signalHash: userContext.signalHash,
    detectedSkills: userContext.detectedSkills.slice(0, 5),
    skillEvidence: userContext.skillEvidence,
    skillEvidenceRuleVersion: SKILL_EVIDENCE_RULE_VERSION,
    skillGaps: userContext.skillGaps.slice(0, 4),
    jobDemandSkills: userContext.jobDemandSkills.slice(0, 5),
    recommendationTechnologies: userContext.recommendationTechnologies.slice(0, 5),
    activeFilters: {
      tab: filters.tab,
      category: filters.category,
      source: filters.source,
      date: filters.dateRange,
      search: filters.search,
      popularity: filters.popularity
    },
    lastUpdated,
    sourceStatus,
    fromCache,
    summary: [
      `News is personalized for your ${userContext.careerStack} path.`,
      userContext.detectedSkills.length
        ? `Detected skills used: ${userContext.detectedSkills.slice(0, 4).join(', ')}.`
        : 'General developer relevance was used because skill signals are limited.',
      userContext.jobDemandSkills.length
        ? `Market demand considered: ${userContext.jobDemandSkills.slice(0, 3).join(', ')}.`
        : '',
      activeFilterParts.length
        ? `Active filters: ${activeFilterParts.join(', ')}.`
        : 'No extra filters are active right now.'
    ]
      .filter(Boolean)
      .join(' ')
  };
};

const getNewsFeed = async ({ user, query = {} }) => {
  const startedAt = Date.now();
  const filters = normalizeFilters(query);
  const [userContext, snapshot] = await Promise.all([
    buildUserContext(user, {
      forceRefresh: ['1', 'true', 'yes'].includes(String(query.refresh || query.bypassCache || '').toLowerCase())
    }),
    pool.readPool()
  ]);
  const sinceTimestamp = parseDateRange(filters.dateRange).getTime();
  const ranked = rankNewsItems(
    uniqueNewsItems(snapshot?.allItems || []).filter((item) => matchesFilters(item, filters, sinceTimestamp)),
    userContext,
    filters.tab
  );
  const start = (filters.page - 1) * filters.limit;
  const sourceSummary = Object.fromEntries(
    SOURCE_NAMES.map((name) => [name, ranked.filter((item) => item.source === name).length])
  );
  const freshness = pool.freshness(snapshot);
  return {
    items: ranked.slice(start, start + filters.limit).map((item) => ({
      ...item,
      relatedSkillEvidence: relatedNewsSkillEvidence(item, userContext.skillEvidence)
    })),
    total: ranked.length,
    sourceSummary,
    trendingTopics: extractTrendingTopics(ranked),
    fromCache: Boolean(snapshot),
    filters,
    recommendedBasedOn: buildRecommendedBasedOn({
      userContext,
      filters,
      lastUpdated: snapshot?.lastUpdated || null,
      sourceStatus:
        freshness === 'fresh'
          ? 'Cached source coverage is current.'
          : freshness === 'stale'
            ? 'Serving stale cached source coverage.'
            : 'News ingestion is warming up.',
      fromCache: Boolean(snapshot)
    }),
    telemetry: {
      cacheHit: Boolean(snapshot),
      providerFailureCount: snapshot?.providerFailureCount || 0,
      providerUsed: snapshot?.providerUsed || [],
      providerDiagnostics: sanitizeProviderDiagnostics(snapshot?.providerDiagnostics),
      signalHash: userContext.signalHash,
      responseTimeMs: Date.now() - startedAt,
      freshness,
      staleFallback: freshness === 'stale',
      lastUpdated: snapshot?.lastUpdated || null
    }
  };
};
const refreshNewsPool = () => pool.refreshPool(() => fetchAllSources(new Date(Date.now() - 30 * 86400000)));
let scheduler;
const startNewsIngestionScheduler = () => {
  if (scheduler || process.env.NEWS_INGESTION_ENABLED === 'false') return;
  const tick = () => refreshNewsPool().catch(() => logger.warn('news ingestion failed'));
  scheduler = setInterval(tick, 60000);
  scheduler.unref?.();
  tick();
};
const stopNewsIngestionScheduler = () => {
  clearInterval(scheduler);
  scheduler = null;
};
module.exports = {
  getNewsFeed,
  buildUserContext,
  invalidateNewsSignalCache,
  refreshNewsPool,
  startNewsIngestionScheduler,
  stopNewsIngestionScheduler
};
