const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const { getGithubAuthOAuthConfig } = require('../config/githubOauth');

const STATE_TTL_SECONDS = 10 * 60;
const consumedStates = new Map();

const providerConfig = (provider) => {
  if (provider === 'google') {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
    };
  }
  const config = getGithubAuthOAuthConfig();
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    callbackUrl: config.callbackUrl,
    authorizeUrl: 'https://github.com/login/oauth/authorize'
  };
};

const requireConfig = (provider) => {
  const config = providerConfig(provider);
  if (!config.clientId || !config.clientSecret || !config.callbackUrl || !process.env.JWT_SECRET) {
    const error = new Error(`${provider} OAuth is not configured.`);
    error.statusCode = 503;
    throw error;
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[OAuth Debug] Resolved login redirect_uri for ${provider}: ${config.callbackUrl}`);
  }
  return config;
};

const cookieOptions = () => ({
  httpOnly: true,
  secure: String(process.env.AUTH_COOKIE_SECURE || '').toLowerCase() === 'true' || process.env.NODE_ENV === 'production',
  sameSite: ['strict', 'lax', 'none'].includes(String(process.env.AUTH_COOKIE_SAMESITE || '').toLowerCase())
    ? String(process.env.AUTH_COOKIE_SAMESITE).toLowerCase()
    : 'lax',
  maxAge: STATE_TTL_SECONDS * 1000,
  path: '/api/auth'
});

const stateCookieName = (provider) => `devinsight_${provider}_oauth_state`;
const parseCookies = (header = '') => String(header).split(';').reduce((cookies, part) => {
  const separator = part.indexOf('=');
  if (separator < 0) return cookies;
  const key = part.slice(0, separator).trim();
  const value = part.slice(separator + 1).trim();
  if (key) cookies[key] = decodeURIComponent(value);
  return cookies;
}, {});

const createAuthorization = (provider) => {
  const config = requireConfig(provider);
  const nonce = crypto.randomBytes(24).toString('base64url');
  const state = jwt.sign({ purpose: 'oauth-state', provider, nonce }, process.env.JWT_SECRET, {
    expiresIn: STATE_TTL_SECONDS,
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    state,
    response_type: 'code'
  });
  if (provider === 'google') {
    params.set('scope', 'openid email profile');
    params.set('prompt', 'select_account');
  } else {
    params.set('scope', 'read:user user:email');
  }
  return { state, authorizationUrl: `${config.authorizeUrl}?${params.toString()}`, cookieName: stateCookieName(provider), cookieOptions: cookieOptions() };
};

const validateState = (provider, state, cookieHeader) => {
  const cookieState = parseCookies(cookieHeader)[stateCookieName(provider)] || '';
  if (!state || !cookieState || state.length !== cookieState.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
    throw Object.assign(new Error('Invalid OAuth state.'), { statusCode: 400 });
  }
  const decoded = jwt.verify(state, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  if (decoded.purpose !== 'oauth-state' || decoded.provider !== provider || !decoded.nonce || consumedStates.has(decoded.nonce)) {
    throw Object.assign(new Error('Invalid or reused OAuth state.'), { statusCode: 400 });
  }
  const now = Date.now();
  consumedStates.set(decoded.nonce, now + STATE_TTL_SECONDS * 1000);
  for (const [nonce, expiresAt] of consumedStates) if (expiresAt <= now) consumedStates.delete(nonce);
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('OAuth provider request failed.'), { statusCode: 502 });
  return payload;
};

const exchangeGoogleIdentity = async (code) => {
  const config = requireConfig('google');
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.callbackUrl, grant_type: 'authorization_code' })
  });
  const profile = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!profile.sub || !profile.email || profile.email_verified !== true) throw Object.assign(new Error('Google email is not verified.'), { statusCode: 403 });
  return { provider: 'google', providerId: String(profile.sub), email: String(profile.email).trim().toLowerCase(), name: String(profile.name || '').trim(), avatarUrl: String(profile.picture || '').trim(), username: '' };
};

const exchangeGitHubIdentity = async (code) => {
  const config = requireConfig('github');
  const token = await fetchJson('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.callbackUrl })
  });
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'DevInsight-AI' };
  const [profile, emails] = await Promise.all([
    fetchJson('https://api.github.com/user', { headers }),
    fetchJson('https://api.github.com/user/emails', { headers })
  ]);
  const verified = Array.isArray(emails) ? emails.find((item) => item?.verified && item?.primary) || emails.find((item) => item?.verified) : null;
  if (!profile.id || !verified?.email) throw Object.assign(new Error('GitHub verified email is required.'), { statusCode: 403 });
  return { provider: 'github', providerId: String(profile.id), email: String(verified.email).trim().toLowerCase(), name: String(profile.name || profile.login || '').trim(), avatarUrl: String(profile.avatar_url || '').trim(), username: String(profile.login || '').trim() };
};

module.exports = { createAuthorization, validateState, exchangeGoogleIdentity, exchangeGitHubIdentity, stateCookieName, cookieOptions };
