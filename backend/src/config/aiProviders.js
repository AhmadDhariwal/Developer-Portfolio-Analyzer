// Single provider registry. Credentials are read at use time and never exported
// by status/inventory endpoints. Existing environment model choices win over
// built-in defaults; missing credentials always disable a provider.
const PRODUCTION_ORDER = Object.freeze(['gemini', 'openai', 'groq', 'anthropic', 'xai']);
const PROVIDERS = Object.freeze({
  gemini: {
    label: 'Gemini',
    type: 'gemini',
    defaults: ['gemini-2.5-flash'],
    timeout: 6200,
    cooldown: 180000
  },
  openai: {
    label: 'OpenAI',
    type: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaults: ['gpt-6-luna'],
    timeout: 8000,
    cooldown: 1800000
  },
  groq: {
    label: 'Groq',
    type: 'openai-compatible',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaults: ['openai/gpt-oss-120b'],
    timeout: 6000,
    cooldown: 180000
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    type: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaults: ['claude-haiku-5-5'],
    timeout: 8000,
    cooldown: 1800000
  },
  xai: {
    label: 'Grok (xAI)',
    type: 'openai-compatible',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    defaults: ['grok-4.7'],
    timeout: 8000,
    cooldown: 180000
  }
});
const integer = (name, fallback, max = 60000) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(max, value) : fallback;
};
const descriptor = (provider) => {
  const config = PROVIDERS[provider];
  if (!config) return null;
  const prefix = provider.toUpperCase();
  return {
    ...config,
    envKey: `${prefix}_API_KEY`,
    envModel: `${prefix}_MODEL`,
    envModels: `${prefix}_MODELS`,
    cooldownEnv: `${prefix}_COOLDOWN_MS`,
    defaultCooldownMs: config.cooldown,
    timeoutMs: integer(`${prefix}_TIMEOUT_MS`, config.timeout)
  };
};
const priority = () => [...PRODUCTION_ORDER];
const ENV_DEFAULTS = {
  AI_PROVIDER_PRIORITY: PRODUCTION_ORDER.join(','),
  AI_REQUEST_TIMEOUT_MS: '30000',
  AI_GLOBAL_MAX_CONCURRENCY: '8',
  AI_GLOBAL_REQUESTS_PER_MINUTE: '120',
  AI_GLOBAL_REQUESTS_PER_DAY: '5000',
  AI_CIRCUIT_FAILURE_THRESHOLD: '3',
  AI_AUTH_COOLDOWN_MS: '900000',
  ANTHROPIC_VERSION: '2023-06-01',
  AI_RESPONSE_CACHE_TTL_SECONDS: '86400',
  AI_DETERMINISTIC_CACHE_TTL_SECONDS: '600'
};
for (const [provider, entry] of Object.entries(PROVIDERS)) {
  const prefix = provider.toUpperCase();
  Object.assign(ENV_DEFAULTS, {
    [`${prefix}_API_KEY`]: '',
    [`${prefix}_MODEL`]: entry.defaults[0],
    [`${prefix}_MODELS`]: '',
    [`${prefix}_TIMEOUT_MS`]: String(entry.timeout),
    [`${prefix}_COOLDOWN_MS`]: String(entry.cooldown),
    [`${prefix}_MAX_CONCURRENCY`]: '4',
    [`${prefix}_REQUESTS_PER_MINUTE`]: '60',
    [`${prefix}_REQUESTS_PER_DAY`]: '3000'
  });
}
const setting = (name, maximum) => integer(name, Number(ENV_DEFAULTS[name]), maximum);
module.exports = {
  PRODUCTION_ORDER,
  PROVIDERS,
  descriptor,
  integer,
  priority,
  ENV_DEFAULTS,
  setting
};
