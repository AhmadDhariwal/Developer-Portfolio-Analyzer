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

  // Calculate repository activity for the frontend Bar Chart
  // We'll use stars/forks as a proxy for 'activity' since commit history fetching is expensive
  const repositoryActivity = repos
    .sort((a, b) => (b.stargazers_count + b.forks_count) - (a.stargazers_count + a.forks_count))
    .slice(0, 10)
    .map(r => ({
      repo: r.name,
      commits: (r.stargazers_count || 0) + (r.forks_count || 0) + 1 // +1 to ensure it shows up
    }));

  // Return combined raw stats + AI insights + Chart data
  return {
    ...aiResult,
    repoCount: repos.length,
    totalStars: repos.reduce((s, r) => s + (r.stargazers_count || 0), 0),
    totalForks: repos.reduce((s, r) => s + (r.forks_count || 0), 0),
    activityScore: aiResult.scores?.codeQuality || 70,
    languageDistribution,
    repositoryActivity,
    repositories: repos.map(r => ({
        name: r.name,
        language: r.language || 'Unknown',
        stars: r.stargazers_count,
        forks: r.forks_count,
        updatedAt: r.updated_at || null,
        pushedAt: r.pushed_at || null,
        createdAt: r.created_at || null
    }))
  };
};

module.exports = { analyzeGitHubProfile, fetchGitHubUser };

