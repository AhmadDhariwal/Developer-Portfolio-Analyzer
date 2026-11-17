const axios = require('axios');
const governance = require('./jobGovernanceService');

// Dedicated transport; global Axios and unrelated integrations remain untouched.
async function request(source, method, url, data, config = {}) {
  const reservation = await governance.reserve(source);
  if (!reservation.allowed) {
    const error = new Error(reservation.reason);
    error.code = reservation.reason;
    throw error;
  }
  try {
    const response = await axios.request({
      ...config,
      method,
      url,
      data,
      timeout: Math.min(6000, Math.max(1000, Number(config.timeout) || 6000)),
      signal: AbortSignal.timeout(7000),
      maxRedirects: 0,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 65536
    });
    const rows =
      source === 'remoteok'
        ? response.data
        : source === 'jsearch' || source === 'arbeitnow'
          ? response.data?.data
          : source === 'adzuna'
            ? response.data?.results
            : response.data?.jobs;
    if (!Array.isArray(rows)) {
      const error = new Error('Malformed provider response.');
      error.response = response;
      throw error;
    }
    await governance.finish(reservation, response);
    return response;
  } catch (error) {
    await governance.finish(reservation, {
      status: error.response?.status || 0,
      headers: error.response?.headers || {},
      failed: true
    });
    // Provider errors can contain keys in request URLs, headers and response bodies.
    const safe = new Error('Job source request failed.');
    safe.code = error.code;
    safe.response = {
      status: error.response?.status,
      headers: error.response?.headers || {},
      data: null
    };
    throw safe;
  }
}

module.exports = {
  get: (source, url, config) => request(source, 'GET', url, undefined, config),
  post: (source, url, data, config) => request(source, 'POST', url, data, config)
};
