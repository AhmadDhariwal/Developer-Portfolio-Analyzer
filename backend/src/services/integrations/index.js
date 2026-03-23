const GitHubAdapter = require('./githubAdapter');
const LinkedInAdapter = require('./linkedinAdapter');
const LeetCodeAdapter = require('./leetcodeAdapter');
const KaggleAdapter = require('./kaggleAdapter');

const ADAPTERS = {
  github: new GitHubAdapter(),
  linkedin: new LinkedInAdapter(),
  leetcode: new LeetCodeAdapter(),
  kaggle: new KaggleAdapter()
};

const getAdapter = (provider) => ADAPTERS[String(provider || '').toLowerCase()] || null;

const marketplace = [
  {
    provider: 'linkedin',
    name: 'LinkedIn',
    description: 'Import headline, endorsements, and networking signals.',
    category: 'Professional Network',
    authMode: 'oauth2'
  },
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Sync repositories, contribution activity, and language signals.',
    category: 'Code Hosting',
    authMode: 'oauth2'
  },
  {
    provider: 'leetcode',
    name: 'LeetCode',
    description: 'Track coding challenge consistency and difficulty progress.',
    category: 'Practice Platform',
    authMode: 'manual'
  },
  {
    provider: 'kaggle',
    name: 'Kaggle',
    description: 'Ingest ML competitions, notebooks, and dataset contributions.',
    category: 'Data Science',
    authMode: 'manual'
  }
];

module.exports = { getAdapter, marketplace };
