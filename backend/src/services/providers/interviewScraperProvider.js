const axios = require('axios');
const {
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeDifficulty,
  sanitizeTags
} = require('../interviewQuestionQualityService');

const inferDifficulty = (text = '') => {
  const lower = String(text || '').toLowerCase();
  if (/architecture|distributed|tradeoff|consistency|scalability|throughput/.test(lower)) return 'hard';
  if (/performance|optimization|debug|state|index|cache|auth/.test(lower)) return 'medium';
  return 'easy';
};

const normalizeAnswer = (value = '') => {
  const cleaned = normalizeAnswerText(value);
  if (cleaned.length >= 45) {
    return cleaned.slice(0, 420);
  }
  return '';
};

const sourceMeta = (url, host) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== host || parsed.username || parsed.password || parsed.port)
      return {};
    return {
      url: `${parsed.origin}${parsed.pathname}`,
      verificationStatus: 'unverified',
      fetchedAt: new Date().toISOString()
    };
  } catch {
    return {};
  }
};

const topicSearchTerms = (topicKey = '') => {
  const lookup = {
    nodejs: 'node.js interview question',
    expressjs: 'express.js interview question',
    nextjs: 'next.js interview question',
    'rest-apis': 'rest api interview question',
    graphql: 'graphql interview question',
    postgresql: 'postgresql interview question',
    'full-stack-web-development': 'full stack web development interview question'
  };
  return lookup[topicKey] || `${topicKey} interview question`;
};

const fetchDevToArticles = async (tag = '') => {
  const response = await axios.get('https://dev.to/api/articles', {
    params: { tag, per_page: 20 },
    timeout: 9000
  });
  return Array.isArray(response.data) ? response.data : [];
};

const fetchGitHubIssues = async (query = '') => {
  const headers = {
    Accept: 'application/vnd.github+json'
  };

  const githubToken = String(process.env.GITHUB_TOKEN || '').trim();
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await axios.get('https://api.github.com/search/issues', {
    params: { q: query, per_page: 20, sort: 'updated', order: 'desc' },
    headers,
    timeout: 9000
  });

  const items = response.data?.items;
  return Array.isArray(items) ? items : [];
};

const normalizeScraped = ({ topicKey, topicType, devToItems = [], githubItems = [] }) => {
  const normalized = [];

  for (const item of devToItems) {
    const question = normalizeQuestionText(item?.title || '');
    if (!question) continue;
    normalized.push({
      question,
      sourceMeta: sourceMeta(item?.url, 'dev.to'),
      answer: normalizeAnswer(item?.description || item?.body_markdown || '', topicKey),
      difficulty: sanitizeDifficulty(inferDifficulty(`${item?.title || ''} ${item?.description || ''}`)),
      tags: sanitizeTags([topicKey, topicType, 'scraped', 'devto'])
    });
  }

  for (const item of githubItems) {
    const question = normalizeQuestionText(item?.title || '');
    if (!question) continue;
    normalized.push({
      question,
      sourceMeta: sourceMeta(item?.html_url, 'github.com'),
      answer: normalizeAnswer(item?.body || '', topicKey),
      difficulty: sanitizeDifficulty(inferDifficulty(`${item?.title || ''} ${item?.body || ''}`)),
      tags: sanitizeTags([topicKey, topicType, 'scraped', 'github'])
    });
  }

  return normalized;
};

const scrapeQuestionsForTopic = async ({ topicKey, topicType, count = 10 }) => {
  const searchTerm = topicSearchTerms(topicKey);
  const devToTag = String(topicKey || '').replace(/[^a-z0-9]/g, '');

  try {
    const results = await Promise.allSettled([fetchDevToArticles(devToTag), fetchGitHubIssues(searchTerm)]);

    const [devToItems, githubItems] = results.map((result) => (result.status === 'fulfilled' ? result.value : []));
    return normalizeScraped({ topicKey, topicType, devToItems, githubItems })
      .filter((item) => item.answer && item.sourceMeta.url)
      .slice(0, Math.min(50, Math.max(1, count)));
  } catch (_error) {
    return [];
  }
};

module.exports = {
  scrapeQuestionsForTopic
};
