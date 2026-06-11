const axios = require('axios');
const aiService = require('./aiservice');
const { getGitHubPrompt } = require('../prompts/githubPrompt');
const { getIntegrationSecretsSync } = require('./platformSettingsService');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');

const ANALYSIS_VERSION = 'github-v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const SUPPORT_LANGUAGES = new Set([
  'HTML',
  'CSS',
  'SCSS',
  'Sass',
  'Less',
  'JSON',
  'Markdown',
  'MDX',
  'YAML',
  'XML',
  'Dockerfile',
  'Shell',
  'Makefile',
  'Procfile',
  'Jupyter Notebook'
]);

class GitHubRateLimitError extends Error {
  constructor(message = 'GitHub API rate limit exceeded.', resetAt = null) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.status = 429;
    this.resetAt = resetAt;
  }
}

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const average = (values = []) => {
  const safe = values.map(Number).filter(Number.isFinite);
  if (!safe.length) return 0;
  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
};

const normalizeUsername = (username = '') => String(username || '').trim().replace(/^@/, '').toLowerCase();
const unique = (values = []) => {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const buildConfig = (extra = {}) => {
  const config = {
    headers: { Accept: 'application/vnd.github.v3+json' },
    timeout: REQUEST_TIMEOUT_MS,
    ...extra
  };

  config.headers = {
    ...(config.headers || {}),
    Accept: 'application/vnd.github.v3+json'
  };

  const integrationSettings = getIntegrationSecretsSync();
  if (integrationSettings?.githubEnabled === false) return config;

  const token = process.env.GITHUB_TOKEN || integrationSettings?.githubApiKey || '';
  if (token && token !== 'your_github_personal_access_token') {
    config.headers.Authorization = `token ${token}`;
  }
  return config;
};

const getResetAt = (headers = {}) => {
  const reset = Number(headers['x-ratelimit-reset'] || 0);
  return reset ? new Date(reset * 1000).toISOString() : null;
};

const assertRateLimit = (headers = {}) => {
  if (headers['x-ratelimit-remaining'] === '0') {
    throw new GitHubRateLimitError('GitHub API rate limit exceeded.', getResetAt(headers));
  }
};

const githubGet = async (url, options = {}) => {
  try {
    const response = await axios.get(url, buildConfig(options));
    assertRateLimit(response.headers || {});
    return response;
  } catch (error) {
    const status = error.response?.status;
    const message = String(error.response?.data?.message || error.message || '').toLowerCase();
    if (status === 403 || status === 429 || message.includes('rate limit')) {
      throw new GitHubRateLimitError('GitHub API rate limit exceeded.', getResetAt(error.response?.headers || {}));
    }
    throw error;
  }
};

const isRateLimitError = (error) =>
  error instanceof GitHubRateLimitError ||
  error?.status === 429 ||
  error?.response?.status === 403 ||
  error?.response?.status === 429 ||
  String(error?.message || '').toLowerCase().includes('rate limit');

const fetchGitHubUser = async (username) => {
  try {
    const response = await githubGet(`https://api.github.com/users/${encodeURIComponent(username)}`);
    const data = response.data || {};
    return {
      ...data,
      followers: Number(data.followers || 0),
      following: Number(data.following || 0),
      public_repos: Number(data.public_repos || 0)
    };
  } catch (error) {
    if (error.response?.status === 404) throw new Error(`GitHub user "${username}" not found.`);
    if (isRateLimitError(error)) throw error;
    throw new Error('Failed to fetch GitHub user data.');
  }
};

const fetchGitHubRepos = async (username) => {
  try {
    const response = await githubGet(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos`,
      { params: { per_page: 100, sort: 'updated', type: 'owner' } }
    );
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    throw new Error('Failed to fetch GitHub repositories.');
  }
};

const fetchRepoCommitCount = async (username, repoName) => {
  try {
    const response = await githubGet(
      `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repoName)}/contributors`,
      { params: { per_page: 100, anon: true }, timeout: 8000 }
    );
    if (!Array.isArray(response.data)) return 0;
    return response.data.reduce((sum, contributor) => sum + Number(contributor.contributions || 0), 0);
  } catch {
    return 0;
  }
};

const fetchRepoLanguages = async (username, repoName) => {
  try {
    const response = await githubGet(
      `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repoName)}/languages`,
      { timeout: 8000 }
    );
    return response.data || {};
  } catch {
    return {};
  }
};

const decodeContent = (payload) => {
  if (!payload?.content || payload.encoding !== 'base64') return '';
  try {
    return Buffer.from(payload.content, 'base64').toString('utf8').slice(0, 12000);
  } catch {
    return '';
  }
};

const fetchRepoContent = async (username, repoName, path) => {
  try {
    const response = await githubGet(
      `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repoName)}/contents/${path}`,
      { timeout: 7000 }
    );
    if (Array.isArray(response.data)) return '';
    return decodeContent(response.data);
  } catch {
    return '';
  }
};

const fetchRepoCheapSignals = async (username, repos = []) => {
  const targetRepos = repos
    .filter((repo) => !repo.fork && !repo.archived)
    .sort((a, b) => {
      const left = Number(b.stargazers_count || 0) + Number(b.forks_count || 0);
      const right = Number(a.stargazers_count || 0) + Number(a.forks_count || 0);
      if (left !== right) return left - right;
      return new Date(b.pushed_at || b.updated_at || 0) - new Date(a.pushed_at || a.updated_at || 0);
    })
    .slice(0, 8);

  const manifestPaths = [
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'Pipfile',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'Gemfile',
    'composer.json',
    'Dockerfile',
    '.github/workflows/ci.yml',
    '.github/workflows/main.yml'
  ];

  const entries = await Promise.all(targetRepos.map(async (repo) => {
    const manifests = {};
    const contents = await Promise.all(manifestPaths.map((path) => fetchRepoContent(username, repo.name, path)));
    manifestPaths.forEach((path, index) => {
      if (contents[index]) manifests[path] = contents[index];
    });

    const readme = await fetchRepoContent(username, repo.name, 'README.md');
    return [repo.name, {
      manifests,
      readme: readme.slice(0, 5000),
      hasReadme: Boolean(readme.trim()),
      readmeLength: readme.trim().length
    }];
  }));

  return Object.fromEntries(entries);
};

const TECH_CATALOG = [
  { name: 'React', category: 'Frontend', aliases: ['react', 'reactjs', 'jsx'] },
  { name: 'Angular', category: 'Frontend', aliases: ['angular', '@angular'] },
  { name: 'Vue', category: 'Frontend', aliases: ['vue', 'vuejs'] },
  { name: 'Next.js', category: 'Frontend', aliases: ['next.js', 'nextjs', 'next'] },
  { name: 'Nuxt', category: 'Frontend', aliases: ['nuxt'] },
  { name: 'Svelte', category: 'Frontend', aliases: ['svelte'] },
  { name: 'Tailwind CSS', category: 'Frontend', aliases: ['tailwind', 'tailwindcss'] },
  { name: 'TypeScript', category: 'Frontend', aliases: ['typescript', 'tsconfig'] },
  { name: 'Node.js', category: 'Backend', aliases: ['node.js', 'nodejs', 'node'] },
  { name: 'Express', category: 'Backend', aliases: ['express', 'expressjs'] },
  { name: 'NestJS', category: 'Backend', aliases: ['nestjs', '@nestjs'] },
  { name: 'Django', category: 'Backend', aliases: ['django'] },
  { name: 'Flask', category: 'Backend', aliases: ['flask'] },
  { name: 'FastAPI', category: 'Backend', aliases: ['fastapi'] },
  { name: 'Spring Boot', category: 'Backend', aliases: ['spring boot', 'spring-boot'] },
  { name: 'Laravel', category: 'Backend', aliases: ['laravel'] },
  { name: 'GraphQL', category: 'Backend', aliases: ['graphql', 'apollo'] },
  { name: 'REST APIs', category: 'Backend', aliases: ['rest api', 'restful', 'api'] },
  { name: 'MongoDB', category: 'Database', aliases: ['mongodb', 'mongoose'] },
  { name: 'PostgreSQL', category: 'Database', aliases: ['postgres', 'postgresql', 'pg'] },
  { name: 'MySQL', category: 'Database', aliases: ['mysql'] },
  { name: 'Redis', category: 'Database', aliases: ['redis'] },
  { name: 'SQLite', category: 'Database', aliases: ['sqlite'] },
  { name: 'Docker', category: 'DevOps', aliases: ['docker', 'dockerfile', 'compose'] },
  { name: 'Kubernetes', category: 'DevOps', aliases: ['kubernetes', 'k8s'] },
  { name: 'GitHub Actions', category: 'DevOps', aliases: ['github actions', '.github/workflows'] },
  { name: 'CI/CD', category: 'DevOps', aliases: ['ci/cd', 'pipeline', 'workflow'] },
  { name: 'AWS', category: 'Cloud', aliases: ['aws', 'lambda', 's3', 'ec2'] },
  { name: 'Azure', category: 'Cloud', aliases: ['azure'] },
  { name: 'Google Cloud', category: 'Cloud', aliases: ['gcp', 'google cloud', 'firebase'] },
  { name: 'Vercel', category: 'Cloud', aliases: ['vercel'] },
  { name: 'Netlify', category: 'Cloud', aliases: ['netlify'] },
  { name: 'Jest', category: 'Testing', aliases: ['jest'] },
  { name: 'Vitest', category: 'Testing', aliases: ['vitest'] },
  { name: 'Cypress', category: 'Testing', aliases: ['cypress'] },
  { name: 'Playwright', category: 'Testing', aliases: ['playwright'] },
  { name: 'Pytest', category: 'Testing', aliases: ['pytest'] },
  { name: 'React Native', category: 'Mobile', aliases: ['react native', 'react-native'] },
  { name: 'Flutter', category: 'Mobile', aliases: ['flutter', 'dart'] },
  { name: 'TensorFlow', category: 'AI/ML', aliases: ['tensorflow', 'tf.keras'] },
  { name: 'PyTorch', category: 'AI/ML', aliases: ['pytorch', 'torch'] },
  { name: 'scikit-learn', category: 'AI/ML', aliases: ['scikit-learn', 'sklearn'] },
  { name: 'Pandas', category: 'AI/ML', aliases: ['pandas'] },
  { name: 'OpenAI', category: 'AI/ML', aliases: ['openai', 'gpt', 'llm'] }
];

const LANGUAGE_TECH = {
  JavaScript: { name: 'JavaScript', category: 'Frontend' },
  TypeScript: { name: 'TypeScript', category: 'Frontend' },
  Python: { name: 'Python', category: 'Backend' },
  Java: { name: 'Java', category: 'Backend' },
  Go: { name: 'Go', category: 'Backend' },
  Rust: { name: 'Rust', category: 'Backend' },
  PHP: { name: 'PHP', category: 'Backend' },
  Ruby: { name: 'Ruby', category: 'Backend' },
  Swift: { name: 'Swift', category: 'Mobile' },
  Kotlin: { name: 'Kotlin', category: 'Mobile' },
  Dart: { name: 'Dart', category: 'Mobile' },
  C: { name: 'C', category: 'Backend' },
  'C++': { name: 'C++', category: 'Backend' },
  'C#': { name: 'C#', category: 'Backend' },
  R: { name: 'R', category: 'AI/ML' }
};

const addTechnology = (map, name, category, source, weight = 1) => {
  const key = String(name || '').trim();
  if (!key) return;
  const current = map.get(key) || { name: key, category, confidence: 0, sources: [] };
  current.category = current.category || category;
  current.confidence = clamp(current.confidence + weight, 0, 100);
  current.sources = unique([...(current.sources || []), source]).slice(0, 8);
  map.set(key, current);
};

const detectTechnologies = ({ repos = [], languageDistribution = [], repoSignals = {} }) => {
  const techMap = new Map();

  languageDistribution.forEach((entry) => {
    const language = String(entry.language || '').trim();
    const mapped = LANGUAGE_TECH[language];
    if (mapped) addTechnology(techMap, mapped.name, mapped.category, 'language', Math.max(8, Math.min(24, Number(entry.percentage || 0))));
  });

  repos.forEach((repo) => {
    const signals = repoSignals[repo.name] || {};
    const manifestText = Object.entries(signals.manifests || {})
      .map(([path, content]) => `${path}\n${content}`)
      .join('\n');
    const text = [
      repo.name,
      repo.description,
      repo.language,
      ...(Array.isArray(repo.topics) ? repo.topics : []),
      manifestText,
      signals.readme || ''
    ].join(' ').toLowerCase();

    TECH_CATALOG.forEach((tech) => {
      if (tech.aliases.some((alias) => text.includes(alias.toLowerCase()))) {
        addTechnology(techMap, tech.name, tech.category, repo.name, manifestText ? 18 : 10);
      }
    });
  });

  const technologies = Array.from(techMap.values())
    .map((tech) => ({ ...tech, confidence: clamp(tech.confidence) }))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  const categories = ['Frontend', 'Backend', 'Database', 'DevOps', 'Cloud', 'Testing', 'Mobile', 'AI/ML'];
  const byCategory = categories.reduce((acc, category) => {
    acc[category] = technologies.filter((tech) => tech.category === category).slice(0, 10);
    return acc;
  }, {});

  const totalConfidence = technologies.reduce((sum, tech) => sum + Number(tech.confidence || 0), 0);
  const technologyDistribution = technologies.map((tech) => ({
    technology: tech.name,
    category: tech.category,
    percentage: totalConfidence ? Math.round((Number(tech.confidence || 0) / totalConfidence) * 100) : 0,
    confidence: tech.confidence
  })).slice(0, 16);

  return { technologies, technologyCategories: byCategory, technologyDistribution };
};

const buildFallbackLanguageDistribution = (repos = []) => {
  const counts = {};
  let total = 0;
  repos.forEach((repo) => {
    if (!repo.language) return;
    counts[repo.language] = (counts[repo.language] || 0) + 1;
    total += 1;
  });
  return Object.entries(counts)
    .map(([language, count]) => ({ language, bytes: count, percentage: total ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.percentage - a.percentage);
};

const normalizeDistribution = (byteMap = {}) => {
  const entries = Object.entries(byteMap)
    .map(([language, bytes]) => ({ language, bytes: Number(bytes || 0) }))
    .filter((entry) => entry.language && entry.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (!total) return [];

  let remaining = 100;
  return entries.map((entry, index) => {
    const percentage = index === entries.length - 1
      ? remaining
      : Math.max(0, Math.min(100, Math.round((entry.bytes / total) * 100)));
    remaining -= percentage;
    return { ...entry, percentage };
  });
};

const buildLanguageDistribution = async (username, repos = []) => {
  const candidates = repos
    .filter((repo) => !repo.fork)
    .sort((a, b) => new Date(b.pushed_at || b.updated_at || 0) - new Date(a.pushed_at || a.updated_at || 0))
    .slice(0, 24);

  if (!candidates.length) {
    const fallback = buildFallbackLanguageDistribution(repos);
    return {
      distribution: fallback.map(({ language, percentage, bytes }) => ({ language, percentage, bytes })),
      rawLanguageBytes: Object.fromEntries(fallback.map((entry) => [entry.language, entry.bytes])),
      mainLanguageDistribution: fallback.filter((entry) => !SUPPORT_LANGUAGES.has(entry.language)),
      supportLanguageDistribution: fallback.filter((entry) => SUPPORT_LANGUAGES.has(entry.language)),
      source: 'primary_language'
    };
  }

  const payloads = await Promise.all(candidates.map((repo) => fetchRepoLanguages(username, repo.name)));
  const byteMap = {};
  payloads.forEach((payload) => {
    Object.entries(payload || {}).forEach(([language, bytes]) => {
      byteMap[language] = (byteMap[language] || 0) + Number(bytes || 0);
    });
  });

  const distribution = normalizeDistribution(byteMap);
  if (!distribution.length) {
    const fallback = buildFallbackLanguageDistribution(repos);
    return {
      distribution: fallback.map(({ language, percentage, bytes }) => ({ language, percentage, bytes })),
      rawLanguageBytes: Object.fromEntries(fallback.map((entry) => [entry.language, entry.bytes])),
      mainLanguageDistribution: fallback.filter((entry) => !SUPPORT_LANGUAGES.has(entry.language)),
      supportLanguageDistribution: fallback.filter((entry) => SUPPORT_LANGUAGES.has(entry.language)),
      source: 'primary_language'
    };
  }

  return {
    distribution,
    rawLanguageBytes: byteMap,
    mainLanguageDistribution: distribution.filter((entry) => !SUPPORT_LANGUAGES.has(entry.language)),
    supportLanguageDistribution: distribution.filter((entry) => SUPPORT_LANGUAGES.has(entry.language)),
    source: 'language_bytes'
  };
};

const buildRepoQuality = (repo, commits = 0, signals = {}, repoTechnologies = []) => {
  const descriptionScore = repo.description ? 100 : 20;
  const topicScore = clamp(((repo.topics || []).length / 5) * 100);
  const readmeLength = Number(signals.readmeLength || 0);
  const readmeScore = !signals.hasReadme ? 10 : clamp((readmeLength / 1800) * 100, 35, 100);
  const stars = Number(repo.stargazers_count || 0);
  const forks = Number(repo.forks_count || 0);
  const starSignal = clamp((Math.log10(stars + 1) / 1.7) * 100);
  const forkSignal = clamp((Math.log10(forks + 1) / 1.5) * 100);
  const commitSignal = clamp((Math.log10(Number(commits || 0) + 1) / 2.3) * 100);
  const size = Number(repo.size || 0);
  const sizeSignal = size <= 0 ? 10 : size < 50 ? 35 : size < 50000 ? 85 : 70;
  const pushedAt = repo.pushed_at || repo.updated_at;
  const recencyDays = pushedAt ? Math.max(0, (Date.now() - new Date(pushedAt).getTime()) / (24 * 60 * 60 * 1000)) : 365;
  const recencySignal = clamp(100 - Math.min(100, (recencyDays / 365) * 100));
  const techSignal = clamp((repoTechnologies.length / 4) * 100);

  return clamp(
    (readmeScore * 0.2) +
    (descriptionScore * 0.12) +
    (topicScore * 0.1) +
    (starSignal * 0.12) +
    (forkSignal * 0.08) +
    (commitSignal * 0.18) +
    (recencySignal * 0.13) +
    (sizeSignal * 0.04) +
    (techSignal * 0.03)
  );
};

const categorizeRepository = (repo, qualityScore = 0, commits = 0, repoTechnologies = []) => {
  if (repo.archived) return 'Archived';
  const text = [repo.name, repo.description, ...(repo.topics || [])].join(' ').toLowerCase();
  const stars = Number(repo.stargazers_count || 0);
  const forks = Number(repo.forks_count || 0);
  if (stars >= 25 || forks >= 8 || text.includes('open-source') || text.includes('library') || text.includes('package')) return 'Open Source';
  if (qualityScore >= 72 && commits >= 20 && repoTechnologies.length >= 2) return 'Production';
  if (text.includes('portfolio') || text.includes('resume') || text.includes('personal')) return 'Portfolio';
  if (text.includes('learn') || text.includes('tutorial') || text.includes('practice') || text.includes('course')) return 'Learning';
  return qualityScore < 45 ? 'Experimental' : 'Portfolio';
};

const deriveDeveloperLevel = ({ healthScore, repoCount, technologies = [], totalStars }) => {
  if (healthScore >= 78 && repoCount >= 8 && technologies.length >= 8) return 'Advanced';
  if (healthScore >= 45 || repoCount >= 4 || totalStars >= 5) return 'Intermediate';
  return 'Beginner';
};

const buildDeterministicScores = ({ repos = [], userData = {}, mainLanguageDistribution = [], technologies = [], repositoryActivity = [], repositoryQuality = [] }) => {
  const repoCount = repos.length;
  const totalStars = repos.reduce((sum, repo) => sum + Number(repo.stargazers_count || 0), 0);
  const totalForks = repos.reduce((sum, repo) => sum + Number(repo.forks_count || 0), 0);
  const followers = Number(userData?.followers || 0);
  const activeRepos = repos.filter((repo) => {
    const pushedAt = repo.pushed_at || repo.updated_at;
    return pushedAt && Date.now() - new Date(pushedAt).getTime() <= 180 * 24 * 60 * 60 * 1000;
  }).length;
  const totalCommits = repositoryActivity.reduce((sum, item) => sum + Number(item.commits || 0), 0);
  const readmeCoverage = repositoryQuality.length
    ? (repositoryQuality.filter((repo) => repo.hasReadme).length / repositoryQuality.length) * 100
    : 0;
  const avgRepoQuality = average(repositoryQuality.map((repo) => repo.qualityScore));

  const repoSignal = clamp((repoCount / 18) * 100);
  const starSignal = clamp((Math.log10(totalStars + 1) / 2.2) * 100);
  const forkSignal = clamp((Math.log10(totalForks + 1) / 1.8) * 100);
  const followerSignal = clamp((Math.log10(followers + 1) / 1.8) * 100);
  const contributionSignal = clamp((Math.log10(totalCommits + 1) / 2.4) * 100);
  const activitySignal = clamp((activeRepos / Math.max(Math.min(repoCount, 12), 1)) * 100);
  const diversitySignal = clamp((mainLanguageDistribution.length / 7) * 100);
  const technologySignal = clamp((technologies.length / 12) * 100);

  const codeQuality = clamp((avgRepoQuality * 0.62) + (readmeCoverage * 0.18) + (technologySignal * 0.2));
  const projectDiversity = clamp((diversitySignal * 0.48) + (technologySignal * 0.42) + (repoSignal * 0.1));
  const originality = clamp((starSignal * 0.35) + (forkSignal * 0.2) + (avgRepoQuality * 0.25) + (repoSignal * 0.2));
  const projectImpact = clamp((starSignal * 0.34) + (forkSignal * 0.2) + (repoSignal * 0.16) + (originality * 0.3));
  const profileStrength = clamp((repoSignal * 0.28) + (followerSignal * 0.18) + (starSignal * 0.2) + (activitySignal * 0.18) + (codeQuality * 0.16));
  const healthScore = clamp(
    (codeQuality * 0.24) +
    (projectDiversity * 0.17) +
    (contributionSignal * 0.18) +
    (activitySignal * 0.13) +
    (projectImpact * 0.14) +
    (profileStrength * 0.14)
  );

  return {
    codeQuality,
    projectDiversity,
    originality,
    contribution: clamp((contributionSignal * 0.7) + (activitySignal * 0.3)),
    consistency: activitySignal,
    projectImpact,
    skillCoverage: clamp((diversitySignal * 0.45) + (technologySignal * 0.55)),
    profileStrength,
    healthScore,
    overall: healthScore
  };
};

const buildInsightFallback = ({ developerLevel, strongestRepos = [], weakAreas = [] }) => ({
  developerLevel,
  strengths: strongestRepos.length
    ? strongestRepos.slice(0, 3).map((repo) => `Strong project signal in ${repo.name}`)
    : ['Public repositories are available for review'],
  weakAreas: weakAreas.length ? weakAreas.slice(0, 4) : ['Improve documentation and project descriptions'],
  summary: 'Rule-based GitHub analysis completed. AI narrative was unavailable.',
  explanation: 'Scores are deterministic and based on repository quality, activity, languages, stars, forks, and documentation.'
});

const buildAIInsights = async ({ username, userData, repos, languageSummary, technologySummary, activityMetrics, deterministicScores, weakAreas }) => {
  const topRepos = repos
    .sort((a, b) => Number(b.qualityScore || 0) - Number(a.qualityScore || 0))
    .slice(0, 8)
    .map((repo) => ({
      name: repo.name,
      category: repo.category,
      language: repo.language,
      technologies: repo.technologies.slice(0, 6),
      stars: repo.stars,
      forks: repo.forks,
      qualityScore: repo.qualityScore,
      updatedAt: repo.updatedAt
    }));

  const developerLevel = deriveDeveloperLevel({
    healthScore: deterministicScores.healthScore,
    repoCount: repos.length,
    technologies: technologySummary,
    totalStars: repos.reduce((sum, repo) => sum + Number(repo.stars || 0), 0)
  });

  const fallback = buildInsightFallback({ developerLevel, strongestRepos: repos, weakAreas });
  const prompt = getGitHubPrompt({
    username,
    profile: {
      bio: userData.bio || '',
      publicRepos: Number(userData.public_repos || repos.length),
      followers: Number(userData.followers || 0)
    },
    deterministicScores,
    topRepos,
    languageSummary,
    technologySummary: technologySummary.slice(0, 16),
    activityMetrics,
    weakAreaHints: weakAreas
  });

  const aiResult = await aiService.runAIAnalysis(prompt, fallback);
  return {
    developerLevel: String(aiResult.developerLevel || fallback.developerLevel),
    strengths: Array.isArray(aiResult.strengths) ? aiResult.strengths.slice(0, 6) : fallback.strengths,
    weakAreas: Array.isArray(aiResult.weakAreas) ? aiResult.weakAreas.slice(0, 6) : fallback.weakAreas,
    summary: String(aiResult.summary || aiResult.explanation || fallback.summary),
    explanation: String(aiResult.explanation || aiResult.summary || fallback.explanation)
  };
};

const buildWeakAreas = ({ scores, repositoryQuality = [], technologyCategories = {}, supportLanguageDistribution = [] }) => {
  const weak = [];
  const missingReadmeCount = repositoryQuality.filter((repo) => !repo.hasReadme).length;
  const noDescriptionCount = repositoryQuality.filter((repo) => !repo.description).length;
  const lowQualityCount = repositoryQuality.filter((repo) => repo.qualityScore < 45).length;
  if (missingReadmeCount) weak.push(`${missingReadmeCount} repositories need stronger README documentation`);
  if (noDescriptionCount) weak.push(`${noDescriptionCount} repositories need clear descriptions`);
  if (lowQualityCount) weak.push('Repository quality is uneven across the portfolio');
  if (scores.contribution < 45) weak.push('Contribution depth is low in recently updated repositories');
  if ((technologyCategories.Testing || []).length === 0) weak.push('Testing tools are not clearly visible');
  if ((technologyCategories.DevOps || []).length === 0) weak.push('DevOps and CI/CD signals are thin');
  const supportTotal = supportLanguageDistribution.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  if (supportTotal > 45) weak.push('Language mix is dominated by support files, so charts may overstate application code');
  return unique(weak).slice(0, 6);
};

const buildRecruiterInsights = ({ scores, repoCount, totalStars, followers, technologies = [], repositoryQuality = [] }) => {
  const topTech = technologies.slice(0, 8).map((tech) => tech.name);
  const productionRepos = repositoryQuality.filter((repo) => repo.category === 'Production' || repo.category === 'Open Source');
  const proof = [];
  if (scores.healthScore >= 75) proof.push('Strong GitHub health score with balanced quality, activity, and impact signals.');
  if (productionRepos.length) proof.push(`${productionRepos.length} repositories show production or open-source signal.`);
  if (topTech.length) proof.push(`Visible hands-on stack: ${topTech.slice(0, 5).join(', ')}.`);
  if (totalStars || followers) proof.push(`${totalStars} stars and ${followers} followers provide external validation.`);

  return {
    headline: scores.healthScore >= 75
      ? 'Strong recruiter-visible GitHub profile'
      : scores.healthScore >= 50
        ? 'Promising GitHub profile with clear improvement levers'
        : 'Early GitHub signal; needs stronger project proof',
    proofPoints: proof.slice(0, 5),
    recruiterSummary: `${repoCount} repositories analyzed with a deterministic GitHub Health Score of ${scores.healthScore}/100.`,
    interviewTalkingPoints: unique([
      ...productionRepos.slice(0, 3).map((repo) => `Discuss architecture and tradeoffs in ${repo.name}`),
      ...topTech.slice(0, 3).map((tech) => `Show practical experience with ${tech}`)
    ]).slice(0, 5)
  };
};

const compareSnapshots = (previous, current) => {
  if (!previous || !current) return null;
  return {
    previousAnalyzedAt: previous.analyzedAt,
    currentAnalyzedAt: current.analyzedAt,
    healthScoreDelta: Number(current.healthScore || 0) - Number(previous.healthScore || 0),
    repoCountDelta: Number(current.repoCount || 0) - Number(previous.repoCount || 0),
    starsDelta: Number(current.totalStars || 0) - Number(previous.totalStars || 0),
    forksDelta: Number(current.totalForks || 0) - Number(previous.totalForks || 0),
    followersDelta: Number(current.followers || 0) - Number(previous.followers || 0)
  };
};

const snapshotFromResult = (result = {}) => ({
  analyzedAt: new Date(),
  healthScore: Number(result.githubHealthScore || result.activityScore || 0),
  repoCount: Number(result.repoCount || 0),
  totalStars: Number(result.totalStars || 0),
  totalForks: Number(result.totalForks || 0),
  followers: Number(result.followers || 0),
  topLanguages: (result.mainLanguageDistribution || result.languageDistribution || []).slice(0, 5).map((entry) => entry.language),
  topTechnologies: (result.technologies || []).slice(0, 8).map((tech) => tech.name || tech.technology || tech)
});

const getCacheEntry = async (username) => {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) return null;
  return GitHubAnalysisCache
    .findOne({ normalizedUsername, analysisVersion: ANALYSIS_VERSION })
    .lean();
};

const withCacheMetadata = (result, cacheEntry, source = 'cache') => {
  const snapshots = Array.isArray(cacheEntry?.snapshots) ? cacheEntry.snapshots : [];
  return {
    ...result,
    analysisVersion: ANALYSIS_VERSION,
    cache: {
      source,
      hit: source === 'cache' || source === 'stale-cache',
      expiresAt: cacheEntry?.expiresAt || null,
      cachedAt: cacheEntry?.updatedAt || cacheEntry?.createdAt || null
    },
    analysisHistory: snapshots.slice(-6),
    comparison: result.comparison || compareSnapshots(snapshots[snapshots.length - 2], snapshots[snapshots.length - 1])
  };
};

const saveCacheResult = async (username, result, previousEntry = null) => {
  const normalizedUsername = normalizeUsername(username);
  const currentSnapshot = snapshotFromResult(result);
  const previousSnapshot = Array.isArray(previousEntry?.snapshots) && previousEntry.snapshots.length
    ? previousEntry.snapshots[previousEntry.snapshots.length - 1]
    : null;
  const comparison = compareSnapshots(previousSnapshot, currentSnapshot);
  const resultWithComparison = {
    ...result,
    comparison,
    analysisVersion: ANALYSIS_VERSION
  };

  const updated = await GitHubAnalysisCache.findOneAndUpdate(
    { normalizedUsername, analysisVersion: ANALYSIS_VERSION },
    {
      $set: {
        githubUsername: username,
        normalizedUsername,
        analysisVersion: ANALYSIS_VERSION,
        result: resultWithComparison,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS)
      },
      $push: {
        snapshots: {
          $each: [currentSnapshot],
          $slice: -12
        }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return withCacheMetadata(resultWithComparison, updated, 'fresh');
};

const fetchRepoCommitsByMonth = async (username, repoName, since, until) => {
  const monthMap = {};
  let page = 1;

  while (page <= 4) {
    try {
      const response = await githubGet(
        `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repoName)}/commits`,
        {
          timeout: 12000,
          params: {
            since: since.toISOString(),
            until: until.toISOString(),
            per_page: 100,
            page
          }
        }
      );
      const commits = Array.isArray(response.data) ? response.data : [];
      if (!commits.length) break;
      commits.forEach((commit) => {
        const dateStr = commit.commit?.author?.date || commit.commit?.committer?.date;
        if (!dateStr) return;
        const date = new Date(dateStr);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        monthMap[key] = (monthMap[key] || 0) + 1;
      });
      if (commits.length < 100) break;
      page += 1;
    } catch {
      break;
    }
  }
  return monthMap;
};

const fetchMonthlyCommitActivity = async (username, repos = []) => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const buckets = [];

  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${date.getFullYear()}-${date.getMonth()}`, label: monthNames[date.getMonth()], count: 0 });
  }

  const since = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const activeRepos = (repos || [])
    .filter((repo) => {
      const pushedAt = repo.pushed_at || repo.pushedAt;
      return pushedAt && new Date(pushedAt) >= since;
    })
    .slice(0, 12);

  const maps = await Promise.all(activeRepos.map((repo) => fetchRepoCommitsByMonth(username, repo.name || repo.repoName, since, now)));
  maps.forEach((monthMap) => {
    Object.entries(monthMap).forEach(([key, count]) => {
      const bucket = buckets.find((item) => item.key === key);
      if (bucket) bucket.count += Number(count || 0);
    });
  });

  return buckets.map((bucket) => ({ month: bucket.label, count: bucket.count }));
};

const buildFreshAnalysis = async (username) => {
  const [userData, repos] = await Promise.all([
    fetchGitHubUser(username),
    fetchGitHubRepos(username)
  ]);

  const totalStars = repos.reduce((sum, repo) => sum + Number(repo.stargazers_count || 0), 0);
  const totalForks = repos.reduce((sum, repo) => sum + Number(repo.forks_count || 0), 0);

  if (!repos.length) {
    const emptyScores = {
      codeQuality: 0,
      projectDiversity: 0,
      originality: 0,
      contribution: 0,
      consistency: 0,
      projectImpact: 0,
      skillCoverage: 0,
      profileStrength: 0,
      healthScore: 0,
      overall: 0
    };
    return {
      repoCount: 0,
      totalStars,
      totalForks,
      followers: Number(userData?.followers || 0),
      developerLevel: 'Beginner',
      strengths: [],
      weakAreas: ['No public owner repositories were found'],
      summary: 'No public repositories were available for analysis.',
      explanation: 'GitHub user data was found, but there were no public repositories to score.',
      scores: emptyScores,
      githubHealthScore: 0,
      activityScore: 0,
      languageDistribution: [],
      mainLanguageDistribution: [],
      supportLanguageDistribution: [],
      rawLanguageBytes: {},
      languageDistributionSource: 'missing',
      technologyDistribution: [],
      technologies: [],
      technologyCategories: {},
      repositoryActivity: [],
      repositories: [],
      repositoryQuality: [],
      recruiterInsights: {
        headline: 'No repository signal available',
        proofPoints: [],
        recruiterSummary: 'No public repositories were available for recruiter review.',
        interviewTalkingPoints: []
      },
      githubSignals: {}
    };
  }

  const rankedRepos = [...repos]
    .sort((a, b) => {
      const bScore = Number(b.stargazers_count || 0) + Number(b.forks_count || 0);
      const aScore = Number(a.stargazers_count || 0) + Number(a.forks_count || 0);
      if (bScore !== aScore) return bScore - aScore;
      return new Date(b.pushed_at || b.updated_at || 0) - new Date(a.pushed_at || a.updated_at || 0);
    });

  const topActivityRepos = rankedRepos.slice(0, 12);
  const [commitCounts, languageData, repoSignals] = await Promise.all([
    Promise.all(topActivityRepos.map((repo) => fetchRepoCommitCount(username, repo.name))),
    buildLanguageDistribution(username, repos),
    fetchRepoCheapSignals(username, rankedRepos)
  ]);

  const commitMap = {};
  topActivityRepos.forEach((repo, index) => {
    commitMap[repo.name] = Number(commitCounts[index] || 0);
  });

  const {
    distribution: languageDistribution,
    rawLanguageBytes,
    mainLanguageDistribution,
    supportLanguageDistribution,
    source: languageDistributionSource
  } = languageData;

  const techResult = detectTechnologies({ repos, languageDistribution, repoSignals });
  const repoTechLookup = new Map();
  repos.forEach((repo) => {
    const text = [
      repo.name,
      repo.description,
      ...(repo.topics || []),
      repo.language,
      repoSignals[repo.name]?.readme || '',
      ...Object.values(repoSignals[repo.name]?.manifests || {})
    ].join(' ').toLowerCase();
    repoTechLookup.set(
      repo.name,
      techResult.technologies
        .filter((tech) => text.includes(tech.name.toLowerCase()) || tech.sources.includes(repo.name))
        .map((tech) => tech.name)
        .slice(0, 8)
    );
  });

  const repositoryQuality = repos.map((repo) => {
    const repoTechnologies = repoTechLookup.get(repo.name) || [];
    const signals = repoSignals[repo.name] || {};
    const commits = commitMap[repo.name] || 0;
    const qualityScore = buildRepoQuality(repo, commits, signals, repoTechnologies);
    return {
      name: repo.name,
      description: repo.description || '',
      qualityScore,
      hasReadme: Boolean(signals.hasReadme),
      readmeQuality: signals.hasReadme ? clamp((Number(signals.readmeLength || 0) / 1800) * 100, 35, 100) : 0,
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      category: categorizeRepository(repo, qualityScore, commits, repoTechnologies),
      technologies: repoTechnologies,
      stars: Number(repo.stargazers_count || 0),
      forks: Number(repo.forks_count || 0),
      commits,
      updatedAt: repo.updated_at || null,
      pushedAt: repo.pushed_at || null
    };
  });

  const repositoryActivity = topActivityRepos.map((repo) => ({
    repo: repo.name,
    commits: commitMap[repo.name] || 0
  }));

  const scores = buildDeterministicScores({
    repos,
    userData,
    mainLanguageDistribution,
    technologies: techResult.technologies,
    repositoryActivity,
    repositoryQuality
  });

  const weakAreas = buildWeakAreas({
    scores,
    repositoryQuality,
    technologyCategories: techResult.technologyCategories,
    supportLanguageDistribution
  });

  const enrichedRepos = repos.map((repo) => {
    const quality = repositoryQuality.find((item) => item.name === repo.name) || {};
    return {
      name: repo.name,
      description: repo.description || '',
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      language: repo.language || 'Unknown',
      stars: Number(repo.stargazers_count || 0),
      forks: Number(repo.forks_count || 0),
      commits: commitMap[repo.name] || 0,
      activityScore: quality.qualityScore || 0,
      qualityScore: quality.qualityScore || 0,
      category: quality.category || 'Experimental',
      technologies: quality.technologies || [],
      hasReadme: Boolean(quality.hasReadme),
      readmeQuality: Number(quality.readmeQuality || 0),
      updatedAt: repo.updated_at || null,
      pushedAt: repo.pushed_at || null,
      createdAt: repo.created_at || null,
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
      size: Number(repo.size || 0)
    };
  });

  const insights = await buildAIInsights({
    username,
    userData,
    repos: enrichedRepos,
    languageSummary: mainLanguageDistribution.slice(0, 8).map((entry) => ({
      language: entry.language,
      percentage: entry.percentage
    })),
    technologySummary: techResult.technologies.map((tech) => ({
      name: tech.name,
      category: tech.category,
      confidence: tech.confidence
    })),
    activityMetrics: {
      repoCount: repos.length,
      totalStars,
      totalForks,
      followers: Number(userData?.followers || 0),
      activeRepos: repos.filter((repo) => {
        const pushedAt = repo.pushed_at || repo.updated_at;
        return pushedAt && Date.now() - new Date(pushedAt).getTime() <= 180 * 24 * 60 * 60 * 1000;
      }).length,
      avgRepositoryQuality: clamp(average(repositoryQuality.map((repo) => repo.qualityScore)))
    },
    deterministicScores: scores,
    weakAreas
  });

  const recruiterInsights = buildRecruiterInsights({
    scores,
    repoCount: repos.length,
    totalStars,
    followers: Number(userData?.followers || 0),
    technologies: techResult.technologies,
    repositoryQuality
  });

  const githubSignals = {
    username,
    analyzedAt: new Date().toISOString(),
    analysisVersion: ANALYSIS_VERSION,
    healthScore: scores.healthScore,
    developerLevel: insights.developerLevel,
    stats: {
      repos: repos.length,
      stars: totalStars,
      forks: totalForks,
      followers: Number(userData?.followers || 0)
    },
    languages: {
      rawBytes: rawLanguageBytes,
      normalized: languageDistribution,
      main: mainLanguageDistribution,
      support: supportLanguageDistribution
    },
    technologies: techResult.technologies,
    technologyCategories: techResult.technologyCategories,
    repositories: repositoryQuality,
    recruiterInsights
  };

  return {
    ...insights,
    scores,
    repoCount: repos.length,
    totalStars,
    totalForks,
    followers: Number(userData?.followers || 0),
    githubHealthScore: scores.healthScore,
    activityScore: scores.healthScore,
    languageDistribution,
    mainLanguageDistribution,
    supportLanguageDistribution,
    rawLanguageBytes,
    languageDistributionSource,
    technologyDistribution: techResult.technologyDistribution,
    technologies: techResult.technologies,
    technologyCategories: techResult.technologyCategories,
    repositoryActivity,
    commitMap,
    repositories: enrichedRepos,
    repositoryQuality,
    recruiterInsights,
    githubSignals
  };
};

const analyzeGitHubProfile = async (username, options = {}) => {
  const trimmedUsername = String(username || '').trim().replace(/^@/, '');
  if (!trimmedUsername) throw new Error('GitHub username is required.');

  const forceRefresh = Boolean(options.forceRefresh);
  const cacheEntry = await getCacheEntry(trimmedUsername);
  const isFresh = cacheEntry?.expiresAt && new Date(cacheEntry.expiresAt).getTime() > Date.now();

  if (!forceRefresh && cacheEntry?.result && isFresh) {
    return withCacheMetadata(cacheEntry.result, cacheEntry, 'cache');
  }

  try {
    const fresh = await buildFreshAnalysis(trimmedUsername);
    return await saveCacheResult(trimmedUsername, fresh, cacheEntry);
  } catch (error) {
    if (cacheEntry?.result && isRateLimitError(error)) {
      return {
        ...withCacheMetadata(cacheEntry.result, cacheEntry, 'stale-cache'),
        rateLimited: true,
        warning: 'GitHub API rate limit reached. Showing the most recent cached analysis.'
      };
    }
    throw error;
  }
};

module.exports = {
  ANALYSIS_VERSION,
  analyzeGitHubProfile,
  fetchGitHubUser,
  fetchGitHubRepos,
  fetchMonthlyCommitActivity,
  isRateLimitError
};
