const axios = require('axios');
const cron = require('node-cron');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { invalidateInterviewPrepCache } = require('./redisCacheService');

const INGEST_CRON_EXPR = process.env.INTERVIEW_QUESTION_INGEST_CRON || '0 */6 * * *';

const SKILL_CONFIG = [
  { skill: 'javascript', devToTag: 'javascript', githubQuery: 'javascript interview question' },
  { skill: 'react', devToTag: 'react', githubQuery: 'react interview question' },
  { skill: 'mern', devToTag: 'nodejs', githubQuery: 'mern interview question' }
];

const inferDifficulty = (text = '') => {
  const lower = String(text || '').toLowerCase();
  if (/architecture|scalability|distributed|consistency|tradeoff/.test(lower)) return 'hard';
  if (/debug|performance|optimi|state|async|design/.test(lower)) return 'medium';
  return 'easy';
};

const normalizeQuestionFromTitle = (title = '') => {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.endsWith('?') ? clean : `${clean}?`;
};

const normalizeAnswer = (description = '', fallbackSkill = '') => {
  const clean = String(description || '').replace(/\s+/g, ' ').trim();
  if (clean.length >= 25) {
    return clean.slice(0, 260);
  }
  return `Review the core ${fallbackSkill} concept, explain tradeoffs, and demonstrate a practical implementation example.`;
};

const fetchDevToArticles = async (tag) => {
  const response = await axios.get('https://dev.to/api/articles', {
    params: { tag, per_page: 10 },
    timeout: 10000
  });
  return Array.isArray(response.data) ? response.data : [];
};

const fetchGitHubIssues = async (query) => {
  const response = await axios.get('https://api.github.com/search/issues', {
    params: { q: query, per_page: 10, sort: 'updated', order: 'desc' },
    headers: {
      Accept: 'application/vnd.github+json'
    },
    timeout: 10000
  });

  const items = response.data?.items;
  return Array.isArray(items) ? items : [];
};

const normalizeScrapedItems = ({ skill, devToItems = [], githubItems = [] }) => {
  const normalized = [];

  for (const item of devToItems) {
    const question = normalizeQuestionFromTitle(item?.title || '');
    if (!question) continue;
    normalized.push({
      skill,
      question,
      answer: normalizeAnswer(item?.description || item?.body_markdown || '', skill),
      difficulty: inferDifficulty(`${item?.title || ''} ${item?.description || ''}`),
      tags: [skill, 'scraped', 'devto'],
      source: 'scraped',
      popularity: 15
    });
  }

  for (const item of githubItems) {
    const question = normalizeQuestionFromTitle(item?.title || '');
    if (!question) continue;
    normalized.push({
      skill,
      question,
      answer: normalizeAnswer(item?.body || '', skill),
      difficulty: inferDifficulty(`${item?.title || ''} ${item?.body || ''}`),
      tags: [skill, 'scraped', 'github'],
      source: 'scraped',
      popularity: 15
    });
  }

  return normalized;
};

const upsertScrapedQuestions = async (records = []) => {
  if (!Array.isArray(records) || records.length === 0) {
    return 0;
  }

  const operations = records.map((record) => ({
    updateOne: {
      filter: {
        skill: record.skill,
        question: record.question
      },
      update: {
        $setOnInsert: {
          ...record,
          createdAt: new Date()
        }
      },
      upsert: true
    }
  }));

  const result = await InterviewQuestionBank.bulkWrite(operations, { ordered: false });
  return Number(result.upsertedCount || 0);
};

const runInterviewQuestionIngestion = async () => {
  let totalInserted = 0;

  for (const config of SKILL_CONFIG) {
    try {
      const [devToItems, githubItems] = await Promise.all([
        fetchDevToArticles(config.devToTag),
        fetchGitHubIssues(config.githubQuery)
      ]);

      const normalized = normalizeScrapedItems({
        skill: config.skill,
        devToItems,
        githubItems
      });

      const inserted = await upsertScrapedQuestions(normalized);
      totalInserted += inserted;
    } catch (error) {
      console.error(`[interview-ingestion] failed for ${config.skill}:`, error.message);
    }
  }

  if (totalInserted > 0) {
    await invalidateInterviewPrepCache();
  }

  return totalInserted;
};

const startInterviewQuestionIngestionScheduler = () => {
  cron.schedule(INGEST_CRON_EXPR, async () => {
    try {
      const inserted = await runInterviewQuestionIngestion();
      console.log(`[interview-ingestion] completed. inserted=${inserted}`);
    } catch (error) {
      console.error('[interview-ingestion] cron error:', error.message);
    }
  });

  console.log(`[interview-ingestion] scheduler started with cron: ${INGEST_CRON_EXPR}`);
};

module.exports = {
  runInterviewQuestionIngestion,
  startInterviewQuestionIngestionScheduler
};