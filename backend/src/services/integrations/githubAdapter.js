const BaseIntegrationAdapter = require('./baseAdapter');

class GitHubAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('github');
  }

  getRequiredConfigKeys() {
    return ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];
  }

  getAuthorizationUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'read:user user:email repo'
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken({ code, redirectUri }) {
    const data = await this.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri
      },
      { headers: { Accept: 'application/json' } }
    );

    if (!data?.access_token) {
      throw new Error('GitHub OAuth token exchange failed.');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      tokenType: data.token_type || 'Bearer',
      scope: data.scope || '',
      expiresIn: data.expires_in || null
    };
  }

  async refreshAccessToken({ refreshToken }) {
    if (!refreshToken) return null;

    const data = await this.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      },
      { headers: { Accept: 'application/json' } }
    );

    if (!data?.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope || '',
      expiresIn: data.expires_in || null
    };
  }

  async getExternalIdentity(token) {
    const user = await this.get('https://api.github.com/user', token, {
      headers: { 'User-Agent': 'Developer-Portfolio-Analyzer' }
    });
    return {
      username: user?.login || '',
      id: user?.id || '',
      displayName: user?.name || ''
    };
  }

  async ingestData(connection = {}) {
    const token = connection.accessToken;
    const profile = await this.get('https://api.github.com/user', token, {
      headers: { 'User-Agent': 'Developer-Portfolio-Analyzer' }
    });
    const repos = await this.get('https://api.github.com/user/repos?per_page=100&sort=updated', token, {
      headers: { 'User-Agent': 'Developer-Portfolio-Analyzer' }
    });

    const username = profile?.login || connection.externalUsername || '';
    const totalStars = Array.isArray(repos)
      ? repos.reduce((sum, repo) => sum + Number(repo?.stargazers_count || 0), 0)
      : 0;
    const totalForks = Array.isArray(repos)
      ? repos.reduce((sum, repo) => sum + Number(repo?.forks_count || 0), 0)
      : 0;

    const languageMap = {};
    if (Array.isArray(repos)) {
      repos.forEach((repo) => {
        if (!repo?.language) return;
        languageMap[repo.language] = (languageMap[repo.language] || 0) + 1;
      });
    }

    const inferredSkills = Object.keys(languageMap).slice(0, 6);

    return {
      provider: this.provider,
      profile: {
        username,
        followers: Number(profile?.followers || 0),
        following: Number(profile?.following || 0),
        publicRepos: Number(profile?.public_repos || 0)
      },
      activity: {
        starsReceived: totalStars,
        forksReceived: totalForks,
        recentRepos: Array.isArray(repos) ? repos.slice(0, 12).length : 0
      },
      inferredSkills,
      raw: {
        languageMap,
        topRepos: Array.isArray(repos)
          ? repos.slice(0, 8).map((repo) => ({
              name: repo.name,
              language: repo.language,
              stars: repo.stargazers_count,
              forks: repo.forks_count,
              updatedAt: repo.updated_at
            }))
          : []
      }
    };
  }
}

module.exports = GitHubAdapter;
