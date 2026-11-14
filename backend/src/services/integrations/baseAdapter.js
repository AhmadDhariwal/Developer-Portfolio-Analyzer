const axios = require('axios');
const governance = require('../integrationGovernanceService');

class BaseIntegrationAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  getAuthMode() {
    return 'oauth2';
  }

  getRequiredConfigKeys() {
    return [];
  }

  validateConfig() {
    const missing = this.getRequiredConfigKeys().filter((key) => !process.env[key]);
    return { ok: missing.length === 0, missing };
  }

  getAuthorizationUrl() {
    throw new Error('getAuthorizationUrl must be implemented by OAuth adapters');
  }

  async exchangeCodeForToken() {
    throw new Error('exchangeCodeForToken must be implemented by OAuth adapters');
  }

  async refreshAccessToken() {
    return null;
  }

  async ingestData() {
    throw new Error('ingestData must be implemented by each adapter');
  }

  async get(url, token, config = {}) {
    const headers = {
      Accept: 'application/json',
      ...(config.headers || {})
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await governance.request(
      this.provider,
      (controls) => axios.get(url, { ...config, ...controls, headers }),
      true
    );
    if (response.data?.errors?.length || response.data?.error_id)
      throw new Error('Provider returned an invalid response.');
    return response.data;
  }

  async post(url, data, config = {}) {
    const response = await governance.request(this.provider, (controls) =>
      axios.post(url, data, { ...config, ...controls })
    );
    if (response.data?.errors?.length || response.data?.error_id)
      throw new Error('Provider returned an invalid response.');
    return response.data;
  }
}

module.exports = BaseIntegrationAdapter;
