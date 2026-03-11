const axios = require('axios');

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
    if (error.response?.status === 403) throw new Error('GitHub API rate limit exceeded. Try again later.');
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
    if (error.response?.status === 404) throw new Error(`GitHub user "${username}" not found.`);
    if (error.response?.status === 403) throw new Error('GitHub API rate limit exceeded. Try again later.');
    throw new Error('Failed to fetch GitHub repositories.');
  }
};

// Fetch commit count for a single repo (returns 0 on error to avoid blocking)
const fetchRepoCommitCount = async (username, repoName) => {
  try {
    // Use the contributors stats endpoint — much faster than listing all commits
    const res = await axios.get(
      `https://api.github.com/repos/${username}/${repoName}/contributors?per_page=100`,
      buildConfig()
    );
    if (!Array.isArray(res.data)) return 0;
    return res.data.reduce((sum, c) => sum + (c.contributions || 0), 0);
  } catch {
    return 0;
  }
};

// Fetch language breakdown (bytes) for a single repo
const fetchRepoLanguages = async (username, repoName) => {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${username}/${repoName}/languages`,
      buildConfig()
    );
    return res.data; // { TypeScript: 48292, JavaScript: 12333, ... }
  } catch {
    return {};
  }
};

// Main analysis function — fetches everything and builds the full response object
const analyzeGitHubProfile = async (username) => {
  // 1. Parallel: user info + all repos
  const [userData, repos] = await Promise.all([
    fetchGitHubUser(username),
    fetchGitHubRepos(username)
  ]);

  if (!repos.length) {
    return {
      repoCount: 0, totalStars: 0, totalForks: 0, activityScore: 0,
      languageDistribution: [], repositoryActivity: [], repositories: []
    };
  }

  // 2. Sort repos by stars for top-10 activity fetch
  const sortedByStars = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count);
  const topRepos = sortedByStars.slice(0, 10);

  // 3. Parallel: fetch languages + commits for top repos
  const [languageResults, commitResults] = await Promise.all([
    Promise.all(topRepos.map(r => fetchRepoLanguages(username, r.name))),
    Promise.all(topRepos.map(r => fetchRepoCommitCount(username, r.name)))
  ]);

  // 4. Aggregate language bytes across top repos
  const totalLanguageBytes = {};
  languageResults.forEach(langMap => {
    Object.entries(langMap).forEach(([lang, bytes]) => {
      totalLanguageBytes[lang] = (totalLanguageBytes[lang] || 0) + bytes;
    });
  });

  // Also count language usage across ALL repos (for any repo without language breakdown)
  repos.forEach(repo => {
    if (repo.language && !totalLanguageBytes[repo.language]) {
      totalLanguageBytes[repo.language] = (totalLanguageBytes[repo.language] || 0) + 1000;
    }
  });

  const totalBytes = Object.values(totalLanguageBytes).reduce((s, v) => s + v, 0);
  const languageDistribution = Object.entries(totalLanguageBytes)
    .map(([language, bytes]) => ({
      language,
      percentage: Math.round((bytes / totalBytes) * 100)
    }))
    .filter(l => l.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 8);

  // Normalise percentages to exactly 100
  const pctSum = languageDistribution.reduce((s, l) => s + l.percentage, 0);
  if (pctSum !== 100 && languageDistribution.length > 0) {
    languageDistribution[0].percentage += (100 - pctSum);
  }

  // 5. Repository activity (commits per top repo)
  const repositoryActivity = topRepos.map((repo, i) => ({
    repo: repo.name,
    commits: commitResults[i]
  })).sort((a, b) => b.commits - a.commits);

  // 6. Aggregate totals
  let totalStars = 0;
  let totalForks = 0;
  repos.forEach(r => {
    totalStars += r.stargazers_count || 0;
    totalForks += r.forks_count || 0;
  });

  // 7. Activity score formula (capped at 100)
  // Weighted: repos(×1) + stars(×0.5, cap 30) + forks(×0.3, cap 20) + commits(×0.1, cap 30) + followers(×0.5, cap 20)
  const totalCommits = commitResults.reduce((s, c) => s + c, 0);
  const rawScore =
    Math.min(repos.length * 1, 20) +
    Math.min(totalStars * 0.05, 30) +
    Math.min(totalForks * 0.1, 20) +
    Math.min(totalCommits * 0.01, 30) +
    Math.min((userData.followers || 0) * 0.5, 20);
  const activityScore = Math.min(Math.round(rawScore), 100);

  // 8. Repository table — all repos with per-repo activity score
  const repositories = repos.map((repo, i) => {
    const commitCount = topRepos.indexOf(repo) !== -1
      ? commitResults[topRepos.indexOf(repo)]
      : 0;
    const repoScore = Math.min(
      Math.round(
        Math.min(repo.stargazers_count * 0.05, 30) +
        Math.min(repo.forks_count * 0.1, 20) +
        Math.min(commitCount * 0.01, 30) +
        (repo.language ? 5 : 0) +
        (repo.updated_at && (Date.now() - new Date(repo.updated_at)) < 90 * 86400000 ? 15 : 0)
      ), 100
    );
    return {
      name: repo.name,
      language: repo.language || 'Unknown',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      activityScore: repoScore
    };
  }).sort((a, b) => b.stars - a.stars);

  return {
    repoCount: repos.length,
    totalStars,
    totalForks,
    activityScore,
    languageDistribution,
    repositoryActivity,
    repositories
  };
};

module.exports = { fetchGitHubRepos, fetchGitHubUser, analyzeGitHubProfile };
