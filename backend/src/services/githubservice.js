const axios = require('axios');
const aiService = require('./aiservice');
const { getGitHubPrompt } = require('../prompts/githubPrompt');

// Build shared GitHub API config with optional auth token
const buildConfig = () => {
  const config = {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
    timeout: 10000
  };
  const token = process.env.GITHUB_TOKEN;
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

  // Calculate language distribution for the frontend Donut Chart
  const langCounts = {};
  let totalLangs = 0;
  repos.forEach(r => {
    if (r.language) {
      langCounts[r.language] = (langCounts[r.language] || 0) + 1;
      totalLangs++;
    }
  });
  const languageDistribution = Object.keys(langCounts).map(lang => ({
    language: lang,
    percentage: Math.round((langCounts[lang] / totalLangs) * 100)
  })).sort((a, b) => b.percentage - a.percentage);

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

  // Return combined raw stats + AI insights + Chart data
  return {
    ...aiResult,
    repoCount: repos.length,
    totalStars: repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
    totalForks: repos.reduce((s, r) => s + (r.forks_count || 0), 0),
    activityScore: aiResult.scores?.codeQuality || 70,
    languageDistribution,
    repositoryActivity,
    commitMap,
    repositories: repos.map(r => ({
        name: r.name,
        language: r.language || 'Unknown',
        stars: r.stargazers_count,
        forks: r.forks_count,
        commits: commitMap[r.name] || 0,
        updatedAt: r.updated_at || null,
        pushedAt: r.pushed_at || null,
        createdAt: r.created_at || null
    }))
  };
};

module.exports = { analyzeGitHubProfile, fetchGitHubUser, fetchGitHubRepos, fetchMonthlyCommitActivity };

