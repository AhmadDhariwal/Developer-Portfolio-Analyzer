const GitHubAdapter = require('./githubAdapter');
const LinkedInAdapter = require('./linkedinAdapter');
const LeetCodeAdapter = require('./leetcodeAdapter');
const KaggleAdapter = require('./kaggleAdapter');
const StackOverflowAdapter = require('./stackoverflowAdapter');
const HackerRankAdapter = require('./hackerrankAdapter');
const PortfolioScannerAdapter = require('./portfolioScannerAdapter');
const CertificationsAdapter = require('./certificationsAdapter');
const DevBlogsAdapter = require('./devBlogsAdapter');

const ADAPTERS = {
  github: new GitHubAdapter(),
  linkedin: new LinkedInAdapter(),
  leetcode: new LeetCodeAdapter(),
  kaggle: new KaggleAdapter(),
  stackoverflow: new StackOverflowAdapter(),
  hackerrank: new HackerRankAdapter(),
  portfolio: new PortfolioScannerAdapter(),
  certifications: new CertificationsAdapter(),
  devblogs: new DevBlogsAdapter()
};

const getAdapter = (provider) => {
  if (typeof provider !== 'string') return null;
  const key = provider.toLowerCase();
  return Object.hasOwn(ADAPTERS, key) ? ADAPTERS[key] : null;
};

const marketplace = [
  // ── Existing integrations ──────────────────────────────────────────────
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
    description:
      'Profile ingestion is unavailable until a documented Kaggle profile API and authorized access are configured.',
    category: 'Data Science',
    authMode: 'manual'
  },
  // ── New integrations ───────────────────────────────────────────────────
  {
    provider: 'stackoverflow',
    name: 'Stack Overflow',
    description:
      'Fetch reputation, badges, and top tags to validate backend and problem-solving credibility.',
    category: 'Developer Community',
    authMode: 'manual'
  },
  {
    provider: 'hackerrank',
    name: 'HackerRank',
    description:
      'Public developer profile ingestion is unavailable because no supported HackerRank profile API is configured.',
    category: 'Practice Platform',
    authMode: 'manual'
  },
  {
    provider: 'portfolio',
    name: 'Portfolio Website',
    description: 'Scan your portfolio URL for technologies, SEO signals, and performance metrics.',
    category: 'Personal Branding',
    authMode: 'manual'
  },
  {
    provider: 'certifications',
    name: 'Certifications',
    description:
      'Record self-reported certification names; adding a name does not verify a credential.',
    category: 'Learning & Credentials',
    authMode: 'manual'
  },
  {
    provider: 'devblogs',
    name: 'Dev Blogs',
    description:
      'Observe up to 30 public Dev.to articles with devto@username. Hashnode requires approved Pro API access.',
    category: 'Content & Branding',
    authMode: 'manual'
  }
];

module.exports = { getAdapter, marketplace };
