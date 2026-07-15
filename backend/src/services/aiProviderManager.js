const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { getAiSnapshotSync } = require('./platformSettingsService');

const PROVIDER_ORDER = ['groq', 'openai', 'gemini', 'anthropic', 'openrouter'];

const PROVIDERS = {
  groq: {
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    envModel: 'GROQ_MODEL',
    envModels: 'GROQ_MODELS',
    cooldownEnv: 'GROQ_COOLDOWN_MS',
    defaultCooldownMs: 1800000,
    defaults: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    type: 'openai-compatible',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions'
  },
  openai: {
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    envModel: 'OPENAI_MODEL',
    envModels: 'OPENAI_MODELS',
    cooldownEnv: 'OPENAI_COOLDOWN_MS',
    defaultCooldownMs: 1800000,
    defaults: ['gpt-4.1-mini', 'gpt-4o-mini'],
    type: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  gemini: {
    label: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    envModel: 'GEMINI_MODEL',
    envModels: 'GEMINI_MODELS',
    cooldownEnv: 'GEMINI_COOLDOWN_MS',
    defaultCooldownMs: 180000,
    defaults: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    type: 'gemini'
  },
  anthropic: {
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    envModel: 'ANTHROPIC_MODEL',
    envModels: 'ANTHROPIC_MODELS',
    cooldownEnv: 'ANTHROPIC_COOLDOWN_MS',
    defaultCooldownMs: 1800000,
    defaults: ['claude-3-7-sonnet-latest'],
    type: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  openrouter: {
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    envModel: 'OPENROUTER_MODEL',
    envModels: 'OPENROUTER_MODELS',
    cooldownEnv: 'OPENROUTER_COOLDOWN_MS',
    defaultCooldownMs: 1800000,
    defaults: [],
    type: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions'
  }
};

const PERMANENT_STATUS = new Set(['400', '401', '403', '404', '413']);
const TRANSIENT_STATUS = new Set(['408', '429', '500', '502', '503', '504']);

class AIProviderManager {
  constructor() {
    this.cooldownMs = Object.fromEntries(
      Object.entries(PROVIDERS).map(([provider, config]) => [
        provider,
        Number.parseInt(process.env[config.cooldownEnv] || String(config.defaultCooldownMs), 10)
      ])
    );
    this.health = Object.fromEntries(PROVIDER_ORDER.map((provider) => [provider, this.createHealthState(provider)]));
    this.logStartupStatus();
  }

  createHealthState(provider) {
    return {
      provider,
      requests: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      averageLatencyMs: 0,
      lastSuccessfulAt: null,
      lastFailureAt: null,
      cooldownUntil: 0,
      disabledReason: ''
    };
  }

  log(event, data = {}, level = 'log') {
    const line = `[AIProviderManager] ${JSON.stringify({ scope: 'AIProviderManager', event, ...data })}`;
    if (level === 'warn') console.warn(line);
    else if (level === 'error') console.error(line);
    else console.log(line);
  }

  clean(value = '') {
    return String(value || '').trim();
  }

  splitModels(value = '') {
    return String(value || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
  }

  isUsableKey(value = '') {
    const key = this.clean(value);
    return Boolean(key && key.length > 10 && !key.includes('your_') && !key.includes('replace_me'));
  }

  keyLooksCompatible(provider, value = '') {
    const key = this.clean(value);
    if (!key) return false;
    if (provider === 'groq') return key.startsWith('gsk_');
    if (provider === 'openai') return key.startsWith('sk-') && !key.startsWith('gsk_');
    if (provider === 'gemini') return !key.startsWith('sk-') && !key.startsWith('gsk_');
    if (provider === 'anthropic') return true;
    if (provider === 'openrouter') return true;
    return false;
  }

  normalizeProvider(provider = '') {
    const value = String(provider || '').toLowerCase().trim();
    if (value === 'google') return 'gemini';
    if (value === 'claude') return 'anthropic';
    if (value === 'openai-compatible') return 'openrouter';
    return PROVIDERS[value] ? value : '';
  }

  modelFamily(model = '') {
    const value = String(model || '').toLowerCase();
    if (!value) return '';
    if (value.startsWith('gemini-')) return 'gemini';
    if (value.startsWith('claude-')) return 'anthropic';
    if (value.startsWith('llama-') || value.includes('mixtral') || value.includes('gemma') || value.includes('qwen')) return 'groq';
    if (value.startsWith('gpt-') || value.startsWith('o1') || value.startsWith('o3') || value.startsWith('o4')) return 'openai';
    if (value.includes('/')) return 'openrouter';
    return '';
  }

  isCompatibleModel(provider, model) {
    if (provider === 'openrouter') return Boolean(this.clean(model));
    const family = this.modelFamily(model);
    if (!family) return true;
    return family === provider;
  }

  providerModels(provider) {
    const config = PROVIDERS[provider];
    const models = [...this.rawProviderModels(provider), ...config.defaults];
    return [...new Set(models)].filter((model) => this.isCompatibleModel(provider, model));
  }

  rawProviderModels(provider) {
    const config = PROVIDERS[provider];
    return [
      ...this.splitModels(process.env[config.envModel]),
      ...this.splitModels(process.env[config.envModels])
    ];
  }

  settingsProviderConfig() {
    const settings = getAiSnapshotSync();
    const provider = this.normalizeProvider(settings?.provider);
    return {
      enabled: settings?.enabled !== false,
      provider,
      model: this.clean(settings?.model),
      apiKey: this.clean(settings?.apiKey)
    };
  }

  getProviderState() {
    const settings = this.settingsProviderConfig();
    const states = {};

    for (const provider of PROVIDER_ORDER) {
      const config = PROVIDERS[provider];
      const settingsKey = settings.provider === provider ? settings.apiKey : '';
      const apiKey = settingsKey || this.clean(process.env[config.envKey] || '');
      const settingsModel = settings.provider === provider && this.isCompatibleModel(provider, settings.model)
        ? settings.model
        : '';
      const models = settingsModel
        ? [...new Set([settingsModel, ...this.providerModels(provider)])]
        : this.providerModels(provider);
      const hasRawKey = this.isUsableKey(apiKey);
      const hasCompatibleKey = hasRawKey && this.keyLooksCompatible(provider, apiKey);
      const hasModels = models.length > 0;
      const health = this.health[provider] || this.createHealthState(provider);
      const cooldownRemainingMs = Math.max(0, (health.cooldownUntil || 0) - Date.now());

      states[provider] = {
        provider,
        label: config.label,
        config,
        apiKey,
        hasRawKey,
        hasKey: hasCompatibleKey,
        hasModels,
        enabled: hasCompatibleKey && hasModels && cooldownRemainingMs === 0,
        disabledReason: !hasRawKey
          ? 'missing_key'
          : !hasCompatibleKey
            ? 'key_mismatch'
            : !hasModels
              ? 'missing_model'
              : cooldownRemainingMs > 0
                ? 'cooldown'
                : '',
        models,
        preferred: settings.provider === provider,
        cooldownRemainingMs,
        health: this.getProviderHealth(provider)
      };
    }

    return { settings, states };
  }

  providerPriority() {
    const fromEnv = this.splitModels(process.env.AI_PROVIDER_PRIORITY)
      .map((provider) => this.normalizeProvider(provider))
      .filter(Boolean);
    const { settings, states } = this.getProviderState();
    const preferred = settings.provider && states[settings.provider]?.hasKey ? settings.provider : '';
    const priority = fromEnv.length ? fromEnv : [
      ...(preferred ? [preferred] : []),
      ...PROVIDER_ORDER
    ];
    return priority.filter((provider, index, values) => provider && values.indexOf(provider) === index);
  }

  getEnabledProviders() {
    const { states } = this.getProviderState();
    return this.providerPriority().filter((provider) => states[provider]?.enabled);
  }

  getStatus() {
    const { states } = this.getProviderState();
    const providers = PROVIDER_ORDER.map((provider) => {
      const state = states[provider];
      return {
        provider,
        label: state.label,
        enabled: state.enabled,
        disabledReason: state.disabledReason,
        models: state.models,
        preferred: state.preferred,
        health: state.health
      };
    });

    return {
      priority: this.providerPriority(),
      enabledProviders: providers.filter((provider) => provider.enabled).map((provider) => provider.provider),
      disabledProviders: providers.filter((provider) => !provider.enabled).map((provider) => ({
        provider: provider.provider,
        reason: provider.disabledReason
      })),
      providers
    };
  }

  logStartupStatus() {
    const { states, settings } = this.getProviderState();
    for (const provider of PROVIDER_ORDER) {
      const state = states[provider];
      if (state.enabled) {
        console.log(`[AIProviderManager] ✓ ${state.label} Ready`);
      } else {
        console.warn(`[AIProviderManager] ✗ ${state.label} Disabled (${state.disabledReason})`);
      }

      if (!state.hasRawKey) {
        this.log('provider_missing_key', { provider, envKey: PROVIDERS[provider].envKey }, 'warn');
      } else if (!state.hasKey) {
        this.log('provider_key_mismatch', { provider, envKey: PROVIDERS[provider].envKey }, 'error');
      } else if (!state.hasModels) {
        this.log('provider_missing_model', { provider }, 'error');
      }

      this.rawProviderModels(provider)
        .filter((model) => !this.isCompatibleModel(provider, model))
        .forEach((model) => {
          this.log('provider_model_mismatch', { provider, model }, 'error');
        });
    }

    if (settings.model && settings.provider && !this.isCompatibleModel(settings.provider, settings.model)) {
      this.log('settings_model_ignored', { provider: settings.provider, model: settings.model }, 'error');
    }

    const enabled = Object.values(states).filter((state) => state.enabled);
    this.log(enabled.length ? 'providers_ready' : 'no_providers_ready', {
      providers: enabled.map((state) => state.provider),
      priority: this.providerPriority().filter((provider) => states[provider]?.enabled).join(' -> ')
    }, enabled.length ? 'log' : 'warn');
  }

  getProviderHealth(provider) {
    const health = this.health[provider] || this.createHealthState(provider);
    const successRate = health.requests ? Number(((health.successes / health.requests) * 100).toFixed(1)) : 0;
    return {
      requests: health.requests,
      successes: health.successes,
      failures: health.failures,
      successRate,
      averageLatencyMs: Math.round(health.averageLatencyMs || 0),
      lastSuccessfulAt: health.lastSuccessfulAt,
      lastFailureAt: health.lastFailureAt,
      cooldownRemainingMs: Math.max(0, (health.cooldownUntil || 0) - Date.now())
    };
  }

  recordSuccess(provider, latencyMs) {
    const health = this.health[provider] || this.createHealthState(provider);
    health.requests += 1;
    health.successes += 1;
    health.totalLatencyMs += latencyMs;
    health.averageLatencyMs = health.totalLatencyMs / health.successes;
    health.lastSuccessfulAt = new Date().toISOString();
    health.disabledReason = '';
    this.health[provider] = health;
  }

  recordFailure(provider, latencyMs, reason = 'provider_error') {
    const health = this.health[provider] || this.createHealthState(provider);
    health.requests += 1;
    health.failures += 1;
    health.totalLatencyMs += latencyMs;
    health.lastFailureAt = new Date().toISOString();
    const failureRate = health.requests ? health.failures / health.requests : 0;
    if (reason === '429' || (health.failures >= 3 && failureRate >= 0.5)) {
      this.startCooldown(provider, reason);
    }
    this.health[provider] = health;
  }

  startCooldown(provider, reason = 'provider_unhealthy') {
    const health = this.health[provider] || this.createHealthState(provider);
    health.cooldownUntil = Date.now() + (this.cooldownMs[provider] || 0);
    health.disabledReason = reason;
    this.health[provider] = health;
    this.log('provider_disabled', {
      provider,
      reason,
      cooldownMs: this.cooldownMs[provider] || 0
    }, 'warn');
  }

  getStatusCode(error) {
    const byResponse = error?.response?.status;
    if (byResponse) return String(byResponse);
    if (error?.code === 'ECONNABORTED' || error?.name === 'AbortError') return 'timeout';
    return String(error?.message?.match(/\[(\d{3})(?:[^\]]*)\]/)?.[1] || '');
  }

  errorClass(error) {
    const statusCode = this.getStatusCode(error);
    const message = String(error?.message || '').toLowerCase();
    if (statusCode === 'timeout' || message.includes('timeout') || message.includes('network')) return 'transient';
    if (PERMANENT_STATUS.has(statusCode)) return 'permanent';
    if (TRANSIENT_STATUS.has(statusCode)) return 'transient';
    if (message.includes('quota') || message.includes('resource_exhausted') || message.includes('rate')) return 'transient';
    return 'unknown';
  }

  shouldRetry(error) {
    return this.errorClass(error) === 'transient';
  }

  shouldFailover(error) {
    const statusCode = this.getStatusCode(error);
    const category = this.errorClass(error);
    return category === 'permanent' || statusCode === '429' || statusCode === 'timeout';
  }

  isReasoningModel(modelName) {
    return /mini|o1|o3|o4|reasoning/i.test(modelName);
  }

  async runOpenAICompatible({ provider, prompt, modelName, apiKey, endpoint, parseJson, timeoutMs }) {
    const body = {
      model: modelName,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: 'Return valid JSON only. No markdown, no commentary.' },
        { role: 'user', content: prompt }
      ]
    };

    if (!this.isReasoningModel(modelName)) {
      body.temperature = 0.2;
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'http://localhost:5000';
      headers['X-Title'] = process.env.OPENROUTER_APP_NAME || 'Developer Portfolio Analyzer';
    }

    const response = await axios.post(endpoint, body, {
      headers,
      timeout: timeoutMs
    });

    const text = response.data?.choices?.[0]?.message?.content || '';
    this.log('provider_response', { provider, model: modelName, responseChars: text.length });
    return parseJson(text);
  }

  async runGemini({ prompt, modelName, apiKey, parseJson, timeoutMs }) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Gemini request timed out after ${timeoutMs}ms`);
        error.code = 'ECONNABORTED';
        reject(error);
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([model.generateContent(prompt), timeout]);
      const text = result.response.text();
      this.log('provider_response', { provider: 'gemini', model: modelName, responseChars: text.length });
      return parseJson(text);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async runAnthropic({ prompt, modelName, apiKey, parseJson, timeoutMs }) {
    const response = await axios.post(PROVIDERS.anthropic.endpoint, {
      model: modelName,
      max_tokens: 8000,
      system: 'Return valid JSON only. No markdown, no commentary.',
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
        'Content-Type': 'application/json'
      },
      timeout: timeoutMs
    });

    const text = (response.data?.content || [])
      .map((block) => block?.text || '')
      .join('')
      .trim();
    this.log('provider_response', { provider: 'anthropic', model: modelName, responseChars: text.length });
    return parseJson(text);
  }

  async runProviderRequest({ provider, prompt, modelName, apiKey, parseJson, timeoutMs }) {
    const config = PROVIDERS[provider];
    if (config.type === 'gemini') return this.runGemini({ prompt, modelName, apiKey, parseJson, timeoutMs });
    if (config.type === 'anthropic') return this.runAnthropic({ prompt, modelName, apiKey, parseJson, timeoutMs });
    return this.runOpenAICompatible({
      provider,
      prompt,
      modelName,
      apiKey,
      endpoint: config.endpoint,
      parseJson,
      timeoutMs
    });
  }

  async tryProvider(provider, prompt, retries, parseJson, timeoutMs) {
    const { states } = this.getProviderState();
    const state = states[provider];
    if (!state?.hasKey) return { ok: false, failover: true, reason: state?.disabledReason || 'missing_key' };
    if (!state.enabled) return { ok: false, failover: true, reason: state?.disabledReason || 'disabled' };

    for (const modelName of state.models) {
      if (!this.isCompatibleModel(provider, modelName)) {
        this.log('model_skipped_incompatible', { provider, model: modelName }, 'error');
        continue;
      }

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const startedAt = Date.now();
        try {
          this.log('provider_selected', { provider, model: modelName, attempt });
          const parsed = await this.runProviderRequest({
            provider,
            prompt,
            modelName,
            apiKey: state.apiKey,
            parseJson,
            timeoutMs
          });
          const latencyMs = Date.now() - startedAt;
          this.recordSuccess(provider, latencyMs);
          this.log('provider_success', { provider, model: modelName, attempt, latencyMs });
          return { ok: true, provider, model: modelName, parsed, latencyMs };
        } catch (error) {
          const latencyMs = Date.now() - startedAt;
          const statusCode = this.getStatusCode(error);
          const retryable = this.shouldRetry(error);
          const failover = this.shouldFailover(error);
          const reason = statusCode || this.errorClass(error);
          const responseBody = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 800) : '';
          this.recordFailure(provider, latencyMs, reason);

          this.log('provider_error', {
            provider,
            model: modelName,
            attempt,
            statusCode: statusCode || 'n/a',
            category: this.errorClass(error),
            retryable,
            failover,
            latencyMs,
            message: error?.message || 'Unknown AI error',
            responseBody
          }, retryable ? 'warn' : 'error');

          if (!retryable || failover) return { ok: false, failover: true, reason };
          if (attempt < retries) {
            const delayMs = Math.min(4000, 500 * Math.pow(2, attempt));
            this.log('retry_scheduled', { provider, model: modelName, attempt: attempt + 1, delayMs, reason }, 'warn');
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
    }

    return { ok: false, failover: true, reason: 'models_exhausted' };
  }

  async execute(prompt, { retries = 2, parseJson, timeoutMs = Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '30000', 10) }) {
    const { settings, states } = this.getProviderState();
    if (!settings.enabled) {
      this.log('ai_disabled');
      return { ok: false, reason: 'ai_disabled' };
    }

    const priority = this.providerPriority().filter((provider) => states[provider]?.hasKey);
    if (!priority.length) return { ok: false, reason: 'no_provider' };

    let lastReason = '';
    for (const provider of priority) {
      if (lastReason) this.log('provider_switched', { provider, reason: lastReason }, 'warn');
      const result = await this.tryProvider(provider, prompt, retries, parseJson, timeoutMs);
      if (result.ok) return result;
      lastReason = result.reason || 'provider_failed';
    }

    return { ok: false, reason: lastReason || 'all_providers_failed' };
  }
}

module.exports = new AIProviderManager();
