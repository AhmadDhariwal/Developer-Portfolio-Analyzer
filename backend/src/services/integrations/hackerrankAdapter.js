const BaseIntegrationAdapter = require('./baseAdapter');

class HackerRankAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('hackerrank');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText: 'Enter your HackerRank username to fetch public badges, certifications, and coding scores.'
    };
  }

  async ingestData(connection = {}) {
    const username = String(connection.externalUsername || '').trim();
    if (!username) {
      throw new Error('HackerRank username is required.');
    }

    const profile = await this.fetchProfile(username);
    if (!profile) {
      throw new Error(`HackerRank profile for "${username}" not found or unavailable.`);
    }

    const model = profile?.model || profile || {};
    const badges = Array.isArray(model?.badges) ? model.badges : [];
    const certifications = Array.isArray(model?.certifications) ? model.certifications : [];

    const badgeNames = badges
      .map((b) => String(b?.name || b?.badge_name || '').trim())
      .filter(Boolean);

    const certNames = certifications
      .map((c) => String(c?.name || c?.certificate_name || '').trim())
      .filter(Boolean);

    // Derive skills from badge/cert names
    const inferredSkills = [...new Set([...badgeNames, ...certNames])].slice(0, 10);

    const totalBadges = badges.length;
    const totalCerts = certifications.length;

    // HackerRank doesn't expose a single numeric score publicly;
    // derive a proxy from badge count and certification count
    const codingScore = Math.min(100, (totalBadges * 8) + (totalCerts * 15));

    return {
      provider: this.provider,
      profile: {
        username,
        totalBadges,
        totalCertifications: totalCerts,
        codingScore
      },
      activity: {
        badges: badgeNames.slice(0, 10),
        certifications: certNames.slice(0, 10)
      },
      inferredSkills,
      raw: { badges: badges.slice(0, 10), certifications: certifications.slice(0, 10) }
    };
  }

  async fetchProfile(username) {
    // HackerRank public profile API
    try {
      const data = await this.get(
        `https://www.hackerrank.com/rest/hackers/${encodeURIComponent(username)}/profile`,
        null,
        { headers: { Accept: 'application/json', 'User-Agent': 'Developer-Portfolio-Analyzer' } }
      );
      return data;
    } catch {
      // Fallback: try the community profile endpoint
      try {
        const data = await this.get(
          `https://www.hackerrank.com/community/v1/hackers/${encodeURIComponent(username)}/profile`,
          null,
          { headers: { Accept: 'application/json', 'User-Agent': 'Developer-Portfolio-Analyzer' } }
        );
        return data;
      } catch {
        return null;
      }
    }
  }
}

module.exports = HackerRankAdapter;
