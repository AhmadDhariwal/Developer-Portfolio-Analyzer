const axios = require('axios');
const aiService = require('./aiservice');
const { getGitHubPrompt } = require('../prompts/githubPrompt');
const { getIntegrationSecretsSync } = require('./platformSettingsService');

// Build shared GitHub API config with optional auth token
const buildConfig = () => {
  const config = {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
    timeout: 10000
  };
  const integrationSettings = getIntegrationSecretsSync();
  if (integrationSettings?.githubEnabled === false) {
    return config;
  }
  const token = process.env.GITHUB_TOKEN || integrationSettings?.githubApiKey || '';
  if (token && token !== 'your_github_personal_access_token') {
    config.headers.Authorization = `token ${token}`;
  }
  return config;
};

const fetchGitHubUser = async (username) => {
  try {
    const res = await axios.get(`https://api.github.com/users/${username}`, buildConfig());
    return res.data;
  } catch (error) {
    if (error.response?.status === 404) throw new Error(`GitHub user "${username}" not found.`);
    if (error.response?.status === 403) throw new Error('GitHub API rate limit exceeded.');
    throw new Error('Failed to fetch GitHub user data.');
  }
};

const fetchGitHubRepos = async (username) => {
  try {
    const res = await axios.get(
      `https://api.github.com/users/${username}/repos?per_page=100&sort=updated&type=owner`,
      buildConfig()
    );
    return res.data;
  } catch (error) {
    throw new Error('Failed to fetch GitHub repositories.');
  }
};

const fetchRepoCommitCount = async (username, repoName) => {
  try {
    // Use the contributors stats endpoint — much faster than paginating commits
    // It returns an array of contributor objects each with a `total` commit count
    const res = await axios.get(
      `https://api.github.com/repos/${username}/${repoName}/contributors?per_page=100&anon=true`,
      buildConfig()
    );
    if (!Array.isArray(res.data)) return 0;
    return res.data.reduce((sum, c) => sum + (c.contributions || 0), 0);
  } catch {
    return 0;
  }
};

/**
 * Fetch commit counts per month for a single repo over the last 6 months.
 * Uses the /commits endpoint with since/until filters — always returns real data,
 * unlike /stats/commit_activity which is computed lazily and often returns 202/empty.
 *
 * GitHub paginates at 100 per page. We fetch all pages for the 6-month window.
 * Returns a map: { 'YYYY-M': count }
 */
const fetchRepoCommitsByMonth = async (username, repoName, since, until) => {
  const monthMap = {};
  let page = 1;
  const perPage = 100;

  while (true) {
    try {
      const res = await axios.get(
        `https://api.github.com/repos/${username}/${repoName}/commits`,
        {
          ...buildConfig(),
          timeout: 15000,
          params: {
            since: since.toISOString(),
            until: until.toISOString(),
            per_page: perPage,
            page
          }
        }
      );

      const commits = res.data;
      if (!Array.isArray(commits) || commits.length === 0) break;

      commits.forEach(c => {
        const dateStr = c.commit?.author?.date || c.commit?.committer?.date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        const key = `${d.getFullYear()}-${d.getMonth()}`; // 0-indexed month
        monthMap[key] = (monthMap[key] || 0) + 1;
      });

      // If we got fewer than perPage, we've reached the last page
      if (commits.length < perPage) break;
      page++;

      // Safety cap: max 5 pages per repo (500 commits) to avoid rate-limit hammering
      if (page > 5) break;
    } catch {
      break;
    }
  }

  return monthMap;
};

/**
 * Fetch real commit activity for a user across their repos over the last 6 months.
 * Uses /repos/{owner}/{repo}/commits with since/until — reliable, always returns data.
 * Returns: [{ month: 'Jan', count: 42 }, ...]
 */
const fetchMonthlyCommitActivity = async (username, repos) => {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();

  // Build 6-month buckets (oldest → newest), keyed by 'YYYY-M'
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key:   `${d.getFullYear()}-${d.getMonth()}`,
      label: MONTH_NAMES[d.getMonth()],
      count: 0
    });
  }

  // Date range: start of the oldest bucket → now
  const since = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const until = now;

  // Only process repos pushed to within the last 6 months, cap at 20
  const activeRepos = (repos || [])
    .filter(r => {
      const pushed = r.pushed_at || r.pushedAt;
      return pushed && new Date(pushed) >= since;
    })
    .slice(0, 20);

  if (activeRepos.length === 0) {
    return buckets.map(b => ({ month: b.label, count: 0 }));
  }

  // Fetch commit counts per month for each repo in parallel
  const allMonthMaps = await Promise.all(
    activeRepos.map(r => fetchRepoCommitsByMonth(username, r.name || r.repoName, since, until))
  );

  // Aggregate into buckets
  allMonthMaps.forEach(monthMap => {
    Object.entries(monthMap).forEach(([key, count]) => {
      const bucket = buckets.find(b => b.key === key);
      if (bucket) bucket.count += count;
    });
  });

  return buckets.map(b => ({ month: b.label, count: b.count }));
};

const fetchRepoLanguages = async (username, repoName) => {
  try {
    const res = await axios.get(`https://api.github.com/repos/${username}/${repoName}/languages`, buildConfig());
    return res.data;
  } catch {
    return {};
  }
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value || 0))));

const buildFallbackLanguageDistribution = (repos = []) => {
  const langCounts = {};
  let total = 0;

  repos.forEach((repo) => {
    if (!repo.language) return;
    langCounts[repo.language] = (langCounts[repo.language] || 0) + 1;
    total += 1;
  });

  return Object.keys(langCounts).map((language) => ({
    language,
    percentage: total > 0 ? Math.round((langCounts[language] / total) * 100) : 0
  })).sort((a, b) => b.percentage - a.percentage);
};

const buildLanguageDistribution = async (username, repos = []) => {
  const candidateRepos = repos
    .filter((repo) => !repo.fork)
    .sort((a, b) => new Date(b.pushed_at || b.updated_at || 0).getTime() - new Date(a.pushed_at || a.updated_at || 0).getTime())
    .slice(0, 30);

  if (!candidateRepos.length) {
    return {
      distribution: buildFallbackLanguageDistribution(repos),
      source: 'primary_language'
    };
  }

  const languagePayloads = await Promise.all(
    candidateRepos.map((repo) => fetchRepoLanguages(username, repo.name))
  );

  const byteMap = {};
  languagePayloads.forEach((payload) => {
    Object.entries(payload || {}).forEach(([language, bytes]) => {
      byteMap[language] = (byteMap[language] || 0) + Number(bytes || 0);
    });
  });

  const totalBytes = Object.values(byteMap).reduce((sum, value) => sum + Number(value || 0), 0);
  if (!totalBytes) {
    return {
      distribution: buildFallbackLanguageDistribution(repos),
      source: 'primary_language'
    };
  }

  const distribution = Object.entries(byteMap).map(([language, bytes]) => ({
    language,
    percentage: Math.round((Number(bytes || 0) / totalBytes) * 100)
  })).sort((a, b) => b.percentage - a.percentage);

  return {
    distribution,
    source: 'language_bytes'
  };
};

const buildGitHubCompositeScores = ({ aiScores = {}, repos = [], userData = {}, languageDistribution = [], repositoryActivity = [] }) => {
  const repoCount = Number(repos.length || 0);
  const totalStars = repos.reduce((sum, repo) => sum + Number(repo.stargazers_count || 0), 0);
  const totalForks = repos.reduce((sum, repo) => sum + Number(repo.forks_count || 0), 0);
  const followers = Number(userData?.followers || 0);
  const uniqueLanguages = languageDistribution.length;
  const totalCommits = repositoryActivity.reduce((sum, item) => sum + Number(item.commits || 0), 0);
  const activeRepos = repos.filter((repo) => {
    const pushedAt = repo.pushed_at || repo.updated_at;
    return pushedAt && ((Date.now() - new Date(pushedAt).getTime()) <= (180 * 24 * 60 * 60 * 1000));
  }).length;

  const repoSignal = clamp((repoCount / 18) * 100);
  const starSignal = clamp((Math.log10(totalStars + 1) / 2.2) * 100);
  const forkSignal = clamp((Math.log10(totalForks + 1) / 1.8) * 100);
  const followerSignal = clamp((Math.log10(followers + 1) / 1.8) * 100);
  const diversitySignal = clamp((uniqueLanguages / 8) * 100);
  const contributionSignal = clamp((Math.log10(totalCommits + 1) / 2.4) * 100);
  const activitySignal = clamp((activeRepos / Math.max(Math.min(repoCount, 12), 1)) * 100);

  const codeQuality = clamp(aiScores.codeQuality || 0);
  const projectDiversity = clamp(aiScores.projectDiversity || diversitySignal);
  const originality = clamp(aiScores.originality || average([starSignal, forkSignal]));

  return {
    codeQuality,
    projectDiversity,
    originality,
    contribution: clamp((contributionSignal * 0.7) + (activitySignal * 0.3)),
    consistency: activitySignal,
    projectImpact: clamp((starSignal * 0.35) + (forkSignal * 0.2) + (repoSignal * 0.2) + (originality * 0.25)),
    skillCoverage: clamp((diversitySignal * 0.55) + (projectDiversity * 0.45)),
    profileStrength: clamp((repoSignal * 0.35) + (followerSignal * 0.2) + (starSignal * 0.25) + (activitySignal * 0.2)),
    overall: clamp(
      (codeQuality * 0.28) +
      (projectDiversity * 0.18) +
      (originality * 0.14) +
      (contributionSignal * 0.18) +
      (activitySignal * 0.12) +
      (repoSignal * 0.1)
    )
  };
};

const average = (values = []) => {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
};

const buildPerRepositoryActivityScore = (repo, commits = 0) => {
  const stars = Number(repo?.stargazers_count || 0);
  const forks = Number(repo?.forks_count || 0);
  const pushedAt = repo?.pushed_at || repo?.updated_at;
  const recencyDays = pushedAt ? Math.max(0, (Date.now() - new Date(pushedAt).getTime()) / (24 * 60 * 60 * 1000)) : 365;

  const commitSignal = clamp((Math.log10(Number(commits || 0) + 1) / 2.2) * 100);
  const starSignal = clamp((Math.log10(stars + 1) / 1.6) * 100);
  const forkSignal = clamp((Math.log10(forks + 1) / 1.5) * 100);
  const recencySignal = clamp(100 - Math.min(100, (recencyDays / 180) * 100));

  return clamp(
    (commitSignal * 0.45) +
    (starSignal * 0.2) +
    (forkSignal * 0.15) +
    (recencySignal * 0.2)
  );
};

/**
 * AI-Driven GitHub Analysis
 */
const analyzeGitHubProfile = async (username) => {
  const [userData, repos] = await Promise.all([
    fetchGitHubUser(username),
    fetchGitHubRepos(username)
  ]);

  if (!repos.length) {
    return { 
        repoCount: 0, 
        developerLevel: "Beginner", 
        strengths: [], 
        weakAreas: [], 
        scores: { codeQuality: 0, projectDiversity: 0, originality: 0 },
        repositories: [],
        languageDistribution: [],
        repositoryActivity: [],
        activityScore: 0
    };
  }

  // Aggregate metadata for AI
  const topRepos = repos.sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 5);
  
  const repoDetails = topRepos.map(r => ({
    name: r.name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    size: r.size
  }));

  const prompt = getGitHubPrompt({
    username,
    bio: userData.bio,
    public_repos: userData.public_repos,
    followers: userData.followers,
    repos: repoDetails
  });

  const fallback = {
    developerLevel: "Intermediate",
    strengths: ["Regular contributions"],
    weakAreas: ["Project documentation"],
    scores: { codeQuality: 60, projectDiversity: 50, originality: 55 },
    explanation: "AI analysis was unavailable, using rule-based estimates."
  };

  const aiResult = await aiService.runAIAnalysis(prompt, fallback);

  // Calculate repository activity — fetch real commit counts for top 10 repos
  const top10Repos = repos
    .sort((a, b) => (b.stargazers_count + b.forks_count) - (a.stargazers_count + a.forks_count))
    .slice(0, 10);

  const commitCounts = await Promise.all(
    top10Repos.map(r => fetchRepoCommitCount(username, r.name))
  );

  const repositoryActivity = top10Repos.map((r, i) => ({
    repo: r.name,
    commits: commitCounts[i] || 0
  }));

  // Also build a commit map for the full repo list (used when saving to DB)
  const commitMap = {};
  top10Repos.forEach((r, i) => { commitMap[r.name] = commitCounts[i] || 0; });
  const { distribution: languageDistribution, source: languageDistributionSource } = await buildLanguageDistribution(username, repos);
  const compositeScores = buildGitHubCompositeScores({
    aiScores: aiResult.scores || {},
    repos,
    userData,
    languageDistribution,
    repositoryActivity
  });

  // Return combined raw stats + AI insights + Chart data
  return {
    ...aiResult,
    scores: {
      ...(aiResult.scores || {}),
      projectImpact: compositeScores.projectImpact,
      consistency: compositeScores.consistency,
      contribution: compositeScores.contribution,
      skillCoverage: compositeScores.skillCoverage,
      profileStrength: compositeScores.profileStrength
    },
    repoCount: repos.length,
    totalStars: repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
    totalForks: repos.reduce((s, r) => s + (r.forks_count || 0), 0),
    followers: Number(userData?.followers || 0),
    activityScore: compositeScores.overall,
    languageDistribution,
    languageDistributionSource,
    repositoryActivity,
    commitMap,
    repositories: repos.map(r => ({
        name: r.name,
        description: r.description || '',
        topics: Array.isArray(r.topics) ? r.topics : [],
        language: r.language || 'Unknown',
        stars: r.stargazers_count,
        forks: r.forks_count,
        commits: commitMap[r.name] || 0,
        activityScore: buildPerRepositoryActivityScore(r, commitMap[r.name] || 0),
        updatedAt: r.updated_at || null,
        pushedAt: r.pushed_at || null,
        createdAt: r.created_at || null
    }))
  };
};

module.exports = { analyzeGitHubProfile, fetchGitHubUser, fetchGitHubRepos, fetchMonthlyCommitActivity };

