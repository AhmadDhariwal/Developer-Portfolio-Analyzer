const BaseIntegrationAdapter = require('./baseAdapter');
const axios = require('axios');

class KaggleAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('kaggle');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText: 'Provide your Kaggle username to fetch public profile, medals, and competition activity.'
    };
  }

  async ingestData(connection = {}) {
    const username = connection.externalUsername;
    if (!username) {
      throw new Error('Kaggle username is required for ingestion.');
    }

    const payload = await this.fetchProfilePayload(username);

    const profile = payload?.userProfile || payload?.profile || {};
    const stats = payload?.userStats || payload?.stats || {};

    const competitions = Number(stats?.competitions || profile?.competitions || 0);
    const notebooks = Number(stats?.notebooks || profile?.scripts || 0);

    return {
      provider: this.provider,
      profile: {
        username,
        tier: profile?.performanceTier || profile?.tier || '',
        competitions,
        notebooks
      },
      activity: {
        medals: {
          gold: Number(stats?.goldMedals || profile?.goldMedals || 0),
          silver: Number(stats?.silverMedals || profile?.silverMedals || 0),
          bronze: Number(stats?.bronzeMedals || profile?.bronzeMedals || 0)
        },
        datasetsPublished: Number(stats?.datasets || profile?.datasets || 0)
      },
      inferredSkills: ['Python', 'Machine Learning', 'Data Analysis'],
      raw: payload
    };
  }

  async fetchProfilePayload(username) {
    try {
      return await this.get(
        `https://www.kaggle.com/api/i/users.UsersService/GetProfile?username=${encodeURIComponent(username)}`,
        null
      );
    } catch {
      const html = await axios.get(`https://www.kaggle.com/${encodeURIComponent(username)}`, {
        timeout: 15000,
        headers: {
          Accept: 'text/html,application/xhtml+xml'
        }
      });

      const body = String(html?.data || '');
      if (!body || body.toLowerCase().includes('not found')) {
        throw new Error('Kaggle user not found or profile unavailable.');
      }

      const extractNumber = (pattern) => {
        const match = pattern.exec(body);
        return match ? Number(match[1] || 0) : 0;
      };

      const gold = extractNumber(/"goldMedals"\s*:\s*(\d+)/i);
      const silver = extractNumber(/"silverMedals"\s*:\s*(\d+)/i);
      const bronze = extractNumber(/"bronzeMedals"\s*:\s*(\d+)/i);
      const competitions = extractNumber(/"competitions"\s*:\s*(\d+)/i);
      const notebooks = extractNumber(/"notebooks"\s*:\s*(\d+)/i);

      return {
        profile: {
          username,
          competitions,
          scripts: notebooks
        },
        stats: {
          competitions,
          notebooks,
          goldMedals: gold,
          silverMedals: silver,
          bronzeMedals: bronze
        },
        source: 'html_fallback'
      };
    }
  }
}

module.exports = KaggleAdapter;
