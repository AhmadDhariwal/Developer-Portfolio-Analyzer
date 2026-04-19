const axios = require('axios');
const crypto = require('node:crypto');
const AnalysisCache = require('../models/analysisCache');
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

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const CACHE_TTL_MS = 1000 * 60 * 20;
const REDDIT_FEEDS = ['programming', 'webdev', 'MachineLearning', 'devops'];

const SOURCE_NAMES = ['NewsAPI', 'GNews', 'Hacker News', 'Dev.to', 'Reddit'];

const parseDateRange = (dateRange = '') => {
  const now = new Date();
  const lower = String(dateRange).toLowerCase();
  if (lower === 'today') return new Date(now.getTime() - (24 * 60 * 60 * 1000));
  if (lower === 'week') return new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  if (lower === 'month') return new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  return new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
};

const normalizeFilters = (filters = {}) => {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(filters.limit, 10) || DEFAULT_LIMIT));
  return {
    tab: String(filters.tab || 'for-you').toLowerCase(),
    category: String(filters.category || 'All'),
    source: String(filters.source || 'All'),
    dateRange: String(filters.date || 'week'),
    search: String(filters.search || '').trim(),
    popularity: String(filters.popularity || 'all').toLowerCase(),
    page,
    limit
  };
};

const hashKey = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);

const fetchJson = async (url, options = {}) => {
  const response = await axios.get(url, { timeout: 9000, ...options });
  return response.data;
};

const fetchFromNewsApi = async (sinceDate) => {
  const token = String(process.env.NEWS_API_KEY || '').trim();
  if (!token) return [];
  const from = sinceDate.toISOString().slice(0, 10);
  const query = encodeURIComponent('(software OR programming OR developer OR javascript OR nodejs)');
  const url = `https://newsapi.org/v2/everything?q=${query}&from=${from}&language=en&sortBy=publishedAt&pageSize=50&apiKey=${token}`;
  const payload = await fetchJson(url);
  return fromNewsAPI(payload);
};

const fetchFromGNews = async (sinceDate) => {
  const token = String(process.env.GNEWS_API_KEY || '').trim();
  if (!token) return [];
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

const uniqueByUrl = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.url || item.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const matchesFilters = (item, filters) => {
  if (filters.source !== 'All' && item.source !== filters.source) return false;
  if (filters.category !== 'All' && item.category !== filters.category) return false;
  if (filters.search) {
    const haystack = `${item.title} ${item.description} ${item.source}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  const publishedAt = new Date(item.publishedAt).getTime();
  if (publishedAt < parseDateRange(filters.dateRange).getTime()) return false;
  if (filters.popularity === 'high' && Number(item.popularity || 0) < 200) return false;
  return true;
};

const extractTrendingTopics = (items = []) => {
  const counters = new Map();
  items.forEach((item) => {
    const text = `${item.title} ${item.description}`.toLowerCase();
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

const buildUserContext = async (user) => {
  const defaults = {
    careerStack: user?.careerStack || 'Full Stack',
    experienceLevel: user?.experienceLevel || 'Student',
    careerGoal: user?.careerGoal || '',
    resumeSkills: [],
    githubTechnologies: [],
    skillGaps: []
  };
  if (!user?._id) return defaults;

  const latest = await AnalysisCache.findOne({ userId: user._id }).sort({ updatedAt: -1 }).lean();
  if (!latest?.analysisData) return defaults;

  const data = latest.analysisData;
  const yourSkills = Array.isArray(data.yourSkills) ? data.yourSkills : [];
  const missingSkills = Array.isArray(data.missingSkills) ? data.missingSkills : [];
  const githubLanguages = Array.isArray(data.githubStats?.languageDistribution)
    ? data.githubStats.languageDistribution.map((entry) => entry.language).filter(Boolean)
    : [];
  return {
    ...defaults,
    resumeSkills: yourSkills.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean),
    githubTechnologies: githubLanguages,
    skillGaps: missingSkills.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean)
  };
};

const fetchAllSources = async (sinceDate) => {
  const [newsApi, gnews, hackerNews, devTo, reddit] = await Promise.allSettled([
    fetchFromNewsApi(sinceDate),
    fetchFromGNews(sinceDate),
    fetchFromHackerNews(),
    fetchFromDevTo(),
    fetchFromReddit()
  ]);
  return {
    NewsAPI: newsApi.status === 'fulfilled' ? newsApi.value : [],
    GNews: gnews.status === 'fulfilled' ? gnews.value : [],
    'Hacker News': hackerNews.status === 'fulfilled' ? hackerNews.value : [],
    'Dev.to': devTo.status === 'fulfilled' ? devTo.value : [],
    Reddit: reddit.status === 'fulfilled' ? reddit.value : []
  };
};

const getNewsFeed = async ({ user, query }) => {
  const filters = normalizeFilters(query);
  const userContext = await buildUserContext(user);
  const cacheLookupKey = hashKey({ userId: String(user?._id || 'public'), filters, userContext });

  const cached = await NewsCache.findOne({ cacheKey: cacheLookupKey, expiresAt: { $gt: new Date() } }).lean();
  if (cached) {
    return {
      items: cached.items,
      total: cached.total,
      sourceSummary: cached.sourceSummary || {},
      trendingTopics: cached.trendingTopics || [],
      fromCache: true,
      filters
    };
  }

  const sourceBuckets = await fetchAllSources(parseDateRange(filters.dateRange));
  const merged = uniqueByUrl(Object.values(sourceBuckets).flat());
  const filtered = merged.filter((item) => matchesFilters(item, filters));
  const ranked = rankNewsItems(filtered, userContext, filters.tab);
  const sourceSummary = SOURCE_NAMES.reduce((acc, sourceName) => {
    acc[sourceName] = ranked.filter((item) => item.source === sourceName).length;
    return acc;
  }, {});
  const trendingTopics = extractTrendingTopics(ranked);

  const total = ranked.length;
  const start = (filters.page - 1) * filters.limit;
  const items = ranked.slice(start, start + filters.limit);

  NewsCache.findOneAndUpdate(
    { cacheKey: cacheLookupKey },
    {
      $set: {
        cacheKey: cacheLookupKey,
        filters,
        items,
        total,
        sourceSummary,
        trendingTopics,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS)
      }
    },
    { upsert: true }
  ).catch((error) => logger.warn('news cache write failed', { error: error.message }));

  return { items, total, sourceSummary, trendingTopics, fromCache: false, filters };
};

module.exports = { getNewsFeed, buildUserContext };
