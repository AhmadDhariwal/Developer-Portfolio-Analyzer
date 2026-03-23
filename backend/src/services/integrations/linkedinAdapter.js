const BaseIntegrationAdapter = require('./baseAdapter');

class LinkedInAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('linkedin');
  }

  getRequiredConfigKeys() {
    return ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'];
  }

  getAuthorizationUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'openid profile email'
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeCodeForToken({ code, redirectUri }) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET
    });

    const data = await this.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (!data?.access_token) {
      throw new Error('LinkedIn OAuth token exchange failed.');
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

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET
    });

    const data = await this.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
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
    const profile = await this.get('https://api.linkedin.com/v2/userinfo', token);
    const username = profile?.sub || profile?.email || '';
    return {
      username,
      id: profile?.sub || '',
      displayName: profile?.name || ''
    };
  }

  async ingestData(connection = {}) {
    const token = connection.accessToken;
    const profile = await this.get('https://api.linkedin.com/v2/userinfo', token);

    const inferredSkills = [];
    if (profile?.locale) inferredSkills.push('Global Collaboration');
    if (profile?.name) inferredSkills.push('Professional Branding');

    const completenessSignals = [
      Boolean(profile?.name),
      Boolean(profile?.given_name),
      Boolean(profile?.family_name),
      Boolean(profile?.email),
      Boolean(profile?.email_verified),
      Boolean(profile?.picture),
      Boolean(profile?.locale)
    ];
    const completenessRatio = completenessSignals.filter(Boolean).length / completenessSignals.length;
    const profileCompleteness = Math.round(completenessRatio * 100);

    // LinkedIn OpenID profile does not expose full network analytics by default.
    // Use a conservative activity proxy derived from claim completeness and trust.
    const accountTrust = profile?.email_verified ? 85 : 55;
    const accountActivityProxy = Math.round((profileCompleteness * 0.55) + (accountTrust * 0.45));

    return {
      provider: this.provider,
      profile: {
        username: connection.externalUsername || profile?.email || profile?.sub || '',
        name: profile?.name || '',
        email: profile?.email || ''
      },
      activity: {
        profileCompleteness,
        accountTrust,
        accountActivityProxy
      },
      inferredSkills,
      raw: profile
    };
  }
}

module.exports = LinkedInAdapter;
