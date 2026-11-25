// Helper resolvers for GitHub Auth (Login/Signup) and Integration configurations.

const getGithubAuthOAuthConfig = () => {
  // Prefer GITHUB_AUTH_* first, fall back to legacy GITHUB_* names for login only
  const clientId = process.env.GITHUB_AUTH_CLIENT_ID || process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_AUTH_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_AUTH_CALLBACK_URL || process.env.GITHUB_CALLBACK_URL;

  // TODO: Remove legacy GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_CALLBACK_URL fallbacks once migration is complete.

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error('GitHub Auth OAuth is not fully configured. Missing GITHUB_AUTH_CLIENT_ID, GITHUB_AUTH_CLIENT_SECRET, or GITHUB_AUTH_CALLBACK_URL.');
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[GitHub Auth Config] Resolved callbackUrl: ${callbackUrl} (IDs/Secrets Present: ${Boolean(clientId && clientSecret)})`);
  }

  return {
    clientId,
    clientSecret,
    callbackUrl
  };
};

const getGithubIntegrationOAuthConfig = () => {
  // Integration OAuth must strictly use GITHUB_INTEGRATION_*, no legacy fallback allowed.
  const clientId = process.env.GITHUB_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.GITHUB_INTEGRATION_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_INTEGRATION_CALLBACK_URL;

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error('GitHub Integration OAuth is not fully configured. Missing GITHUB_INTEGRATION_CLIENT_ID, GITHUB_INTEGRATION_CLIENT_SECRET, or GITHUB_INTEGRATION_CALLBACK_URL.');
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[GitHub Integration Config] Resolved callbackUrl: ${callbackUrl} (IDs/Secrets Present: ${Boolean(clientId && clientSecret)})`);
  }

  return {
    clientId,
    clientSecret,
    callbackUrl
  };
};

module.exports = {
  getGithubAuthOAuthConfig,
  getGithubIntegrationOAuthConfig
};
