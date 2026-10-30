const GitHubAdapter = require('./githubAdapter');
const LinkedInAdapter = require('./linkedinAdapter');
const LeetCodeAdapter = require('./leetcodeAdapter');
const KaggleAdapter = require('./kaggleAdapter');
const StackOverflowAdapter = require('./stackoverflowAdapter');
const HackerRankAdapter = require('./hackerrankAdapter');
const PortfolioScannerAdapter = require('./portfolioScannerAdapter');
const CertificationsAdapter = require('./certificationsAdapter');
const DevBlogsAdapter = require('./devBlogsAdapter');
const kaggleResources = require('./kaggleResources');

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
    description:
      'Connect LinkedIn OpenID basic profile and optional email claims. Endorsements and network analytics are unavailable.',
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
    name: 'Kaggle Resources',
    get available() {
      return kaggleResources.validateConfig().ok;
    },
    get description() {
      return this.available
        ? 'Observe up to 20 public notebooks and 20 datasets per sync. Ownership unverified; no scoring impact. Counts describe a sample.'
        : 'Configure KAGGLE_API_TOKEN to observe public resources. The separate Kaggle Linked Profile remains available.';
    },
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
    provider: 'portfolio',
    name: 'Portfolio Website',
    description:
      'Observe public HTML, technology hints, SEO metadata and request timing. Scores are heuristic, not a browser performance audit.',
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
    name: 'Dev.to',
    description: 'Observe up to 30 public Dev.to articles with devto@username.',
    category: 'Content & Branding',
    authMode: 'manual'
  }
];

module.exports = { getAdapter, marketplace };
