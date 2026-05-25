const axios = require('axios');
const crypto = require('node:crypto');
const AnalysisCache = require('../models/analysisCache');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const NewsCache = require('../models/news');
const logger = require('../utils/logger');
const {
  fromNewsAPI,
  fromGNews,
  fromHackerNews,
  fromDevTo,
  fromReddit
} = require('../utils/newsFormatter');
const { rankNewsItems } = require('../utils/newsRanker');
const { getIntegrationSecretsSync } = require('./platformSettingsService');

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const CACHE_TTL_MS = 1000 * 60 * 20;
const REDDIT_FEEDS = ['programming', 'webdev', 'MachineLearning', 'devops'];
const SOURCE_NAMES = ['NewsAPI', 'GNews', 'Hacker News', 'Dev.to', 'Reddit'];
const NEWS_TABS = ['for-you', 'trending', 'latest'];
const NEWS_CATEGORIES = ['All', 'Frontend', 'Backend', 'Full Stack', 'AI / ML', 'DevOps', 'Mobile', 'Cybersecurity', 'Web3'];
const NEWS_SOURCES = ['All', ...SOURCE_NAMES];
const NEWS_DATE_FILTERS = ['today', 'week', 'month'];
const NEWS_POPULARITY_FILTERS = ['all', 'high'];

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

const parseDateRange = (dateRange = '') => {
  const now = new Date();
  const lower = String(dateRange || '').toLowerCase();
  if (lower === 'today') return new Date(now.getTime() - (24 * 60 * 60 * 1000));
  if (lower === 'week') return new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  if (lower === 'month') return new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  return new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
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
    search: String(filters.search || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    popularity: NEWS_POPULARITY_FILTERS.includes(popularity) ? popularity : 'all',
    page: Math.max(1, Number.parseInt(filters.page, 10) || 1),
    limit: clamp(Number.parseInt(filters.limit, 10) || DEFAULT_LIMIT, 1, MAX_LIMIT)
  };
};

const hashKey = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);

const fetchJson = async (url, options = {}) => {
  const response = await axios.get(url, { timeout: 9000, ...options });
  return response.data;
};

const fetchFromNewsApi = async (sinceDate) => {
  const integrations = getIntegrationSecretsSync();
  const token = String(process.env.NEWS_API_KEY || integrations?.newsApiKey || '').trim();
  if (integrations?.newsEnabled === false || !token) return [];
  const from = sinceDate.toISOString().slice(0, 10);
  const query = encodeURIComponent('(software OR programming OR developer OR javascript OR nodejs)');
  const url = `https://newsapi.org/v2/everything?q=${query}&from=${from}&language=en&sortBy=publishedAt&pageSize=50&apiKey=${token}`;
  const payload = await fetchJson(url);
  return fromNewsAPI(payload);
};

const fetchFromGNews = async (sinceDate) => {
  const integrations = getIntegrationSecretsSync();
  const token = String(process.env.GNEWS_API_KEY || integrations?.newsApiKey || '').trim();
  if (integrations?.newsEnabled === false || !token) return [];
  const from = sinceDate.toISOString();
  const query = encodeURIComponent('developer OR programming OR software engineering');
  const url = `https://gnews.io/api/v4/search?q=${query}&lang=en&from=${encodeURIComponent(from)}&max=30&apikey=${token}`;
  const payload = await fetchJson(url);
  return fromGNews(payload);
};

const fetchFromHackerNews = async () => {
  const query = encodeURIComponent('developer OR javascript OR node OR ai');
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=40`;
  const payload = await fetchJson(url);
  return fromHackerNews(payload);
};

const fetchFromDevTo = async () => {
  const payload = await fetchJson('https://dev.to/api/articles?per_page=30&top=7');
  return fromDevTo(payload);
};

const fetchFromReddit = async () => {
  const requests = REDDIT_FEEDS.map((feed) =>
    fetchJson(`https://www.reddit.com/r/${feed}/top.json?t=week&limit=20`, {
      headers: { 'User-Agent': 'DevInsightAI-NewsHub/1.0' }
    }).catch(() => null)
  );
  const payloads = await Promise.all(requests);
  return payloads.flatMap((payload) => (payload ? fromReddit(payload) : []));
};

const uniqueNewsItems = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const urlKey = String(item?.url || '').trim().toLowerCase();
    const titleKey = String(item?.title || '').trim().toLowerCase();
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
  if (Number.isFinite(sinceTimestamp) && publishedAt < sinceTimestamp) return false;
  if (filters.popularity === 'high' && Number(item.popularity || 0) < 200) return false;
  return true;
};

const extractTrendingTopics = (items = []) => {
  const counters = new Map();
  items.forEach((item) => {
    const text = `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
    ['javascript', 'typescript', 'react', 'angular', 'node', 'docker', 'kubernetes', 'ai', 'llm', 'security']
      .forEach((topic) => {
        if (text.includes(topic)) counters.set(topic, (counters.get(topic) || 0) + 1);
      });
  });
  return [...counters.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([topic]) => topic);
};

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map ? Array.from(skillsMap.values()) : Object.values(skillsMap);
  return uniqueStrings(values.flat(), 18);
};

const buildUserContext = async (user) => {
  const defaults = {
    careerStack: user?.careerStack || 'Full Stack',
    experienceLevel: user?.experienceLevel || 'Student',
    careerGoal: user?.careerGoal || '',
    resumeSkills: [],
    githubTechnologies: [],
    skillGaps: [],
    detectedSkills: []
  };
  if (!user?._id) return defaults;

  const [latestCache, latestAnalysis, latestResume] = await Promise.all([
    AnalysisCache.findOne({ userId: user._id }).sort({ updatedAt: -1 }).lean(),
    Analysis.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean(),
    ResumeAnalysis.findOne({ userId: user._id }).sort({ analyzedAt: -1 }).lean()
  ]);

  const cacheData = latestCache?.analysisData || {};
  const githubLanguages = latestAnalysis?.languageDistribution
    ? Object.keys(
        latestAnalysis.languageDistribution instanceof Map
          ? Object.fromEntries(latestAnalysis.languageDistribution)
          : latestAnalysis.languageDistribution
      )
    : [];
  const resumeSkills = flattenResumeSkills(latestResume?.skills);
  const skillGaps = Array.isArray(cacheData.missingSkills)
    ? cacheData.missingSkills.map((skill) => (typeof skill === 'string' ? skill : skill?.name))
    : [];
  const detectedSkills = Array.isArray(cacheData.yourSkills)
    ? cacheData.yourSkills.map((skill) => (typeof skill === 'string' ? skill : skill?.name))
    : [];

  return {
    ...defaults,
    resumeSkills,
    githubTechnologies: uniqueStrings(githubLanguages, 12),
    skillGaps: uniqueStrings(skillGaps, 12),
    detectedSkills: uniqueStrings(detectedSkills, 12)
  };
};

const fetchAllSources = async (sinceDate) => {
  const providers = [
    { name: 'NewsAPI', fetcher: () => fetchFromNewsApi(sinceDate) },
    { name: 'GNews', fetcher: () => fetchFromGNews(sinceDate) },
    { name: 'Hacker News', fetcher: () => fetchFromHackerNews() },
    { name: 'Dev.to', fetcher: () => fetchFromDevTo() },
    { name: 'Reddit', fetcher: () => fetchFromReddit() }
  ];

  const settled = await Promise.allSettled(providers.map((provider) => provider.fetcher()));
  const sourceBuckets = {};
  const providerUsed = [];
  let providerFailureCount = 0;

  settled.forEach((result, index) => {
    const providerName = providers[index].name;
    if (result.status === 'fulfilled') {
      sourceBuckets[providerName] = Array.isArray(result.value) ? result.value : [];
      if (sourceBuckets[providerName].length) providerUsed.push(providerName);
    } else {
      providerFailureCount += 1;
      sourceBuckets[providerName] = [];
      logger.warn('news provider failed', { provider: providerName, error: result.reason?.message || 'Unknown error' });
    }
  });

  return { sourceBuckets, providerUsed, providerFailureCount };
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
    detectedSkills: userContext.detectedSkills.slice(0, 5),
    skillGaps: userContext.skillGaps.slice(0, 4),
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
      userContext.detectedSkills.length ? `Detected skills used: ${userContext.detectedSkills.slice(0, 4).join(', ')}.` : 'General developer relevance was used because skill signals are limited.',
      activeFilterParts.length ? `Active filters: ${activeFilterParts.join(', ')}.` : 'No extra filters are active right now.'
    ].join(' ')
  };
};

const getNewsFeed = async ({ user, query }) => {
  const startedAt = Date.now();
  const filters = normalizeFilters(query);
  const userContext = await buildUserContext(user);
  const cacheLookupKey = hashKey({
    userId: String(user?._id || 'public'),
    filters: {
      tab: filters.tab,
      category: filters.category,
      source: filters.source,
      dateRange: filters.dateRange,
      search: filters.search,
      popularity: filters.popularity
    },
    userContext: {
      careerStack: userContext.careerStack,
      experienceLevel: userContext.experienceLevel,
      detectedSkills: userContext.detectedSkills.slice(0, 6),
      skillGaps: userContext.skillGaps.slice(0, 6),
      githubTechnologies: userContext.githubTechnologies.slice(0, 6)
    }
  });

  const cached = await NewsCache.findOne({ cacheKey: cacheLookupKey, expiresAt: { $gt: new Date() } }).lean();
  if (cached) {
    const start = (filters.page - 1) * filters.limit;
    const allItems = Array.isArray(cached.allItems) ? cached.allItems : [];
    return {
      items: allItems.slice(start, start + filters.limit),
      total: Number(cached.total || allItems.length),
      sourceSummary: cached.sourceSummary || {},
      trendingTopics: Array.isArray(cached.trendingTopics) ? cached.trendingTopics : [],
      recommendedBasedOn: cached.recommendedBasedOn || {},
      fromCache: true,
      filters,
      telemetry: {
        cacheHit: true,
        providerFailureCount: Number(cached.providerFailureCount || 0),
        providerUsed: Array.isArray(cached.providerUsed) ? cached.providerUsed : [],
        responseTimeMs: Number(cached.responseTimeMs || 0)
      }
    };
  }

  const sinceTimestamp = parseDateRange(filters.dateRange).getTime();
  const { sourceBuckets, providerUsed, providerFailureCount } = await fetchAllSources(new Date(sinceTimestamp));
  const merged = uniqueNewsItems(Object.values(sourceBuckets).flat());
  const filtered = merged.filter((item) => matchesFilters(item, filters, sinceTimestamp));
  const ranked = rankNewsItems(filtered, userContext, filters.tab);
  const sourceSummary = SOURCE_NAMES.reduce((accumulator, sourceName) => {
    accumulator[sourceName] = ranked.filter((item) => item.source === sourceName).length;
    return accumulator;
  }, {});
  const trendingTopics = extractTrendingTopics(ranked);
  const total = ranked.length;
  const start = (filters.page - 1) * filters.limit;
  const items = ranked.slice(start, start + filters.limit);
  const responseTimeMs = Date.now() - startedAt;
  const lastUpdated = new Date().toISOString();
  const sourceStatus = providerUsed.length
    ? `Active sources: ${providerUsed.join(', ')}`
    : 'Fallback imagery and safe defaults are active because provider coverage is limited.';
  const recommendedBasedOn = buildRecommendedBasedOn({
    userContext,
    filters,
    lastUpdated,
    sourceStatus,
    fromCache: false
  });

  NewsCache.findOneAndUpdate(
    { cacheKey: cacheLookupKey },
    {
      $set: {
        cacheKey: cacheLookupKey,
        filters,
        allItems: ranked,
        total,
        sourceSummary,
        trendingTopics,
        recommendedBasedOn,
        providerUsed,
        providerFailureCount,
        responseTimeMs,
        lastUpdated: new Date(lastUpdated),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS)
      }
    },
    { upsert: true }
  ).catch((error) => logger.warn('news cache write failed', { error: error.message }));

  return {
    items,
    total,
    sourceSummary,
    trendingTopics,
    recommendedBasedOn,
    fromCache: false,
    filters,
    telemetry: {
      cacheHit: false,
      providerFailureCount,
      providerUsed,
      responseTimeMs
    }
  };
};

module.exports = { getNewsFeed, buildUserContext };
