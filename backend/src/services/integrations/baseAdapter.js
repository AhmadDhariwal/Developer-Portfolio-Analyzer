const axios = require('axios');

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
    const response = await axios.get(url, { ...config, headers, timeout: 15000 });
    return response.data;
  }

  async post(url, data, config = {}) {
    const response = await axios.post(url, data, { timeout: 15000, ...config });
    return response.data;
  }
}

module.exports = BaseIntegrationAdapter;
