const BaseIntegrationAdapter = require('./baseAdapter');

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
      helpText:
        'Kaggle profile ingestion is unavailable until a documented profile API and authorized access are configured.'
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
      inferredSkills: [],
      raw: payload
    };
  }

  async fetchProfilePayload() {
    throw new Error(
      'Kaggle profile ingestion is unavailable until a documented profile API and authorized access are configured.'
    );
  }
}

module.exports = KaggleAdapter;
