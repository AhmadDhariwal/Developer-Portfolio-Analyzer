const BaseIntegrationAdapter = require('./baseAdapter');
const extractor = require('./kaggleResourceExtractor');
const resources = require('./kaggleResources');

class KaggleAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('kaggle');
  }

  getAuthMode() {
    return 'manual';
  }

  validateConfig() {
    return resources.validateConfig();
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText:
        'Observe one bounded page each of public notebooks and datasets. Ownership is unverified; observations do not affect scoring.'
    };
  }

  async ingestData(connection = {}) {
    return extractor.ingestData(connection);
  }
}

module.exports = KaggleAdapter;
