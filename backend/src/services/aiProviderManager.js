const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { getAiSnapshotSync } = require('./platformSettingsService');
const aiConfig = require('../config/aiProviders');
const admission = require('./aiProviderAdmissionService');
const { withAiBudget: bounded } = require('../utils/aiRequestBudget');
const PROVIDER_ORDER = Object.keys(aiConfig.PROVIDERS);
const PROVIDERS = Object.fromEntries(PROVIDER_ORDER.map((provider) => [provider, aiConfig.descriptor(provider)]));

const PERMANENT_STATUS = new Set(['400', '401', '403', '404', '413']);
const TRANSIENT_STATUS = new Set(['408', '429', '500', '502', '503', '504']);
const providerError = (reason) => Object.assign(new Error('AI request did not complete.'), { aiReason: reason });
const parseResponse = (text, parseJson) => {
  if (
    /^\s*(?:(?:i(?:'m| am) sorry)[,.]?\s*)?i (?:cannot|can't|won't|am unable to) (?:help|assist|provide|comply)/i.test(
      text
    )
  )
    throw providerError('safety_refusal');
  const value = parseJson(text);
  if (value?.refusal) throw providerError('safety_refusal');
  return value;
};

class AIProviderManager {
  constructor() {
    this.cooldownMs = Object.fromEntries(
      Object.entries(PROVIDERS).map(([provider, config]) => [
        provider,
        aiConfig.integer(config.cooldownEnv, config.defaultCooldownMs, 86400000)
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
      consecutiveFailures: 0,
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
    if (provider === 'anthropic' || provider === 'xai') return true;
    return false;
  }

  normalizeProvider(provider = '') {
    const value = String(provider || '')
      .toLowerCase()
      .trim();
    if (value === 'google') return 'gemini';
    if (value === 'claude') return 'anthropic';
    if (value === 'grok') return 'xai';
    return PROVIDERS[value] ? value : '';
  }

  modelFamily(model = '') {
    const value = String(model || '').toLowerCase();
    if (!value) return '';
    if (value.startsWith('gemini-')) return 'gemini';
    if (value.startsWith('claude-')) return 'anthropic';
    if (value.startsWith('grok-')) return 'xai';
    if (value.startsWith('openai/gpt-oss-')) return 'groq';
    if (value.startsWith('llama-') || value.includes('mixtral') || value.includes('gemma') || value.includes('qwen'))
      return 'groq';
    if (value.startsWith('gpt-') || value.startsWith('o1') || value.startsWith('o3') || value.startsWith('o4'))
      return 'openai';
    return '';
  }

  isCompatibleModel(provider, model) {
    const family = this.modelFamily(model);
    if (!family) return true;
    return family === provider;
  }

  providerModels(provider) {
    const config = PROVIDERS[provider];
    const configured = this.rawProviderModels(provider);
    const models = configured.length ? configured : config.defaults;
    return [...new Set(models)].filter((model) => this.isCompatibleModel(provider, model));
  }

  rawProviderModels(provider) {
    const config = PROVIDERS[provider];
    return [...this.splitModels(process.env[config.envModel]), ...this.splitModels(process.env[config.envModels])];
  }

  settingsProviderConfig() {
    const settings = getAiSnapshotSync();
    const provider = settings?.configured === false ? '' : this.normalizeProvider(settings?.provider);
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
      const settingsModel =
        settings.provider === provider && this.isCompatibleModel(provider, settings.model) ? settings.model : '';
      const models =
        settingsModel && !this.rawProviderModels(provider).length
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
    // Neither a legacy environment ordering nor admin preference may silently
    // bypass the approved production order.
    return aiConfig.priority();
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
      disabledProviders: providers
        .filter((provider) => !provider.enabled)
        .map((provider) => ({
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
        console.log(`[AIProviderManager] READY ${state.label}`);
      } else {
        console.warn(`[AIProviderManager] DISABLED ${state.label} (${state.disabledReason})`);
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
    this.log(
      enabled.length ? 'providers_ready' : 'no_providers_ready',
      {
        providers: enabled.map((state) => state.provider),
        priority: this.providerPriority()
          .filter((provider) => states[provider]?.enabled)
          .join(' -> ')
      },
      enabled.length ? 'log' : 'warn'
    );
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
    health.consecutiveFailures = 0;
    this.health[provider] = health;
  }

  recordFailure(provider, latencyMs, reason = 'provider_error') {
    const health = this.health[provider] || this.createHealthState(provider);
    health.requests += 1;
    health.failures += 1;
    health.consecutiveFailures = (health.consecutiveFailures || 0) + 1;
    health.totalLatencyMs += latencyMs;
    health.lastFailureAt = new Date().toISOString();
    if (reason === '429' || health.consecutiveFailures >= aiConfig.integer('AI_CIRCUIT_FAILURE_THRESHOLD', 3, 20)) {
      this.startCooldown(provider, reason);
    }
    this.health[provider] = health;
  }

  startCooldown(provider, reason = 'provider_unhealthy') {
    const health = this.health[provider] || this.createHealthState(provider);
    health.cooldownUntil = Date.now() + (this.cooldownMs[provider] || 0);
    health.disabledReason = reason;
    this.health[provider] = health;
    this.log(
      'provider_disabled',
      {
        provider,
        reason,
        cooldownMs: this.cooldownMs[provider] || 0
      },
      'warn'
    );
  }

  getStatusCode(error) {
    const byResponse = error?.response?.status || error?.status || error?.statusCode;
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
    if (message.includes('quota') || message.includes('resource_exhausted') || message.includes('rate'))
      return 'transient';
    return 'unknown';
  }

  shouldRetry(error) {
    return this.errorClass(error) === 'transient';
  }

  shouldFailover(error) {
    return ['transient', 'configuration', 'invalid_json', 'incomplete_output'].includes(this.classify(error));
  }

  classify(error) {
    if (error.aiReason) return error.aiReason;
    const status = this.getStatusCode(error);
    const code = String(
      error?.response?.data?.error?.code || error?.response?.data?.error?.type || error?.errorDetails?.[0]?.reason || ''
    ).toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    if (
      /safety|content.?filter|content.?policy|content.?block|policy.?violation|restricted.?content|prohibited|blocklist|recitation|refusal|spii/.test(
        `${code} ${message}`
      )
    )
      return 'safety_refusal';
    if (
      /api.?key.{0,30}(?:not valid|invalid|expired)|invalid.{0,15}api.?key|api_key_invalid|authentication_error/.test(
        `${code} ${message}`
      )
    )
      return 'configuration';
    if (
      status === '401' ||
      status === '404' ||
      (status === '403' && /invalid_api_key|authentication_error|permission_denied/.test(code))
    )
      return 'configuration';
    if (PERMANENT_STATUS.has(status) || ['405', '415', '422'].includes(status)) return 'invalid_request';
    if (
      status === 'timeout' ||
      TRANSIENT_STATUS.has(status) ||
      ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ERR_NETWORK'].includes(error?.code)
    )
      return 'transient';
    if (
      /no json found|failed to parse json|unexpected token|unexpected end.*json/.test(message) ||
      error instanceof SyntaxError
    )
      return 'invalid_json';
    return 'provider_error';
  }

  isReasoningModel(modelName) {
    return /^(o[134]|gpt-[56]|openai\/gpt-oss-)|reasoning/i.test(modelName);
  }

  async runOpenAICompatible({
    provider,
    prompt,
    modelName,
    apiKey,
    endpoint,
    parseJson,
    timeoutMs,
    signal,
    maxOutputTokens
  }) {
    const body = {
      model: modelName,
      max_tokens: maxOutputTokens || 8000,
      messages: [
        { role: 'system', content: 'Return valid JSON only. No markdown, no commentary.' },
        { role: 'user', content: prompt }
      ]
    };

    if (!this.isReasoningModel(modelName)) {
      body.temperature = provider === 'xai' ? 0.7 : 0.2;
    }
    if (provider === 'openai' || provider === 'groq') {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    if (provider === 'groq' && modelName.startsWith('openai/gpt-oss-')) body.reasoning_effort = 'low';

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const response = await axios.post(endpoint, body, {
      headers,
      timeout: timeoutMs,
      signal
    });

    const choice = response.data?.choices?.[0];
    if (
      choice?.message?.refusal ||
      ['content_filter', 'refusal', 'safety'].includes(choice?.finish_reason) ||
      choice?.message?.content?.some?.((part) => part.type === 'refusal')
    )
      throw providerError('safety_refusal');
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw providerError('incomplete_output');
    const content = choice?.message?.content;
    const text = Array.isArray(content)
      ? content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      : content || '';
    if (!text) throw providerError('invalid_json');
    this.log('provider_response', { provider, model: modelName, responseChars: text.length });
    return parseResponse(text, parseJson);
  }

  async runGemini({ prompt, modelName, apiKey, parseJson, timeoutMs, signal, maxOutputTokens }) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const generationConfig = {
      temperature: 0.15,
      maxOutputTokens: maxOutputTokens || 1400,
      responseMimeType: 'application/json'
    };
    if (/gemini-2\.5/i.test(modelName)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Gemini request timed out after ${timeoutMs}ms`);
        error.code = 'ECONNABORTED';
        controller.abort();
        reject(error);
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([model.generateContent(prompt, { signal: controller.signal }), timeout]);
      const finish = result.response.candidates?.[0]?.finishReason;
      if (
        result.response.promptFeedback?.blockReason ||
        /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII|MODEL_ARMOR/.test(finish || '')
      )
        throw providerError('safety_refusal');
      if (finish === 'LANGUAGE') throw providerError('invalid_request');
      if (finish && !['STOP', 'MAX_TOKENS', 'MALFORMED_FUNCTION_CALL'].includes(finish))
        throw providerError('provider_error');
      if (finish && finish !== 'STOP') throw providerError('incomplete_output');
      const text = result.response.text();
      this.log('provider_response', {
        provider: 'gemini',
        model: modelName,
        responseChars: text.length
      });
      return parseResponse(text, parseJson);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  async runAnthropic({ prompt, modelName, apiKey, parseJson, timeoutMs, signal, maxOutputTokens }) {
    const response = await axios.post(
      PROVIDERS.anthropic.endpoint,
      {
        model: modelName,
        max_tokens: maxOutputTokens || 8000,
        system: 'Return valid JSON only. No markdown, no commentary.',
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs,
        signal
      }
    );

    if (response.data?.stop_reason === 'refusal') throw providerError('safety_refusal');
    if (response.data?.stop_reason && !['end_turn', 'stop_sequence'].includes(response.data.stop_reason))
      throw providerError('incomplete_output');
    const text = (response.data?.content || [])
      .map((block) => block?.text || '')
      .join('')
      .trim();
    if (!text) throw providerError('invalid_json');
    this.log('provider_response', {
      provider: 'anthropic',
      model: modelName,
      responseChars: text.length
    });
    return parseResponse(text, parseJson);
  }

  async runProviderRequest({ provider, prompt, modelName, apiKey, parseJson, timeoutMs, signal, maxOutputTokens }) {
    const config = PROVIDERS[provider];
    if (config.type === 'gemini')
      return this.runGemini({
        prompt,
        modelName,
        apiKey,
        parseJson,
        timeoutMs,
        signal,
        maxOutputTokens
      });
    if (config.type === 'anthropic')
      return this.runAnthropic({
        prompt,
        modelName,
        apiKey,
        parseJson,
        timeoutMs,
        signal,
        maxOutputTokens
      });
    return this.runOpenAICompatible({
      provider,
      prompt,
      modelName,
      apiKey,
      endpoint: config.endpoint,
      parseJson,
      timeoutMs,
      signal,
      maxOutputTokens
    });
  }

  async tryProvider(provider, prompt, retries, parseJson, timeoutMs, preferredModel = '', signal, budget = {}) {
    const { states } = this.getProviderState();
    const state = states[provider];
    if (!state?.enabled) return { ok: false, failover: true, reason: state?.disabledReason || 'disabled' };
    const modelName =
      preferredModel && this.isCompatibleModel(provider, preferredModel) ? preferredModel : state.models[0];
    const identity = admission.fingerprint(provider, state.apiKey, modelName);
    const deadline = budget.deadline || Date.now() + timeoutMs;
    if (!(await admission.circuit(identity, deadline))) return { ok: false, failover: true, reason: 'circuit_open' };
    const attempts = budget.allowRetry ? Math.min(1, Math.max(0, retries)) + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (signal?.aborted) return { ok: false, failover: false, reason: 'cancelled' };
      if (budget.remaining <= 0) return { ok: false, failover: false, reason: 'attempt_budget' };
      budget.remaining--;
      let lease;
      const started = Date.now();
      try {
        lease = await admission.enter(provider, deadline, Math.max(1000, deadline - Date.now() + 2000));
        const remaining = deadline - Date.now();
        if (remaining < 1) throw providerError('timeout');
        this.log('provider_selected', { provider, model: modelName, attempt });
        const parsed = await bounded(
          (attemptSignal) =>
            this.runProviderRequest({
              provider,
              prompt,
              modelName,
              apiKey: state.apiKey,
              parseJson,
              timeoutMs: Math.min(aiConfig.descriptor(provider).timeoutMs, remaining),
              signal: attemptSignal,
              maxOutputTokens: budget.maxOutputTokens
            }),
          Math.min(aiConfig.descriptor(provider).timeoutMs, remaining),
          signal
        );
        if (signal?.aborted) throw providerError('cancelled');
        if (!parsed || typeof parsed !== 'object') throw providerError('invalid_json');
        const latencyMs = Date.now() - started;
        this.recordSuccess(provider, latencyMs);
        this.log('provider_success', { provider, model: modelName, attempt, latencyMs });
        await admission.record(identity, true, {}, deadline);
        return { ok: true, provider, model: modelName, parsed, latencyMs };
      } catch (error) {
        const reason = signal?.aborted ? 'cancelled' : this.classify(error);
        const status = this.getStatusCode(error);
        if (!['safety_refusal', 'invalid_request', 'cancelled'].includes(reason)) {
          this.recordFailure(provider, Date.now() - started, status || reason);
          const retryAfter = error?.response?.headers?.['retry-after'];
          const retryMs = Number.isFinite(Number(retryAfter))
            ? Number(retryAfter) * 1000
            : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
          await admission.record(
            identity,
            false,
            {
              configuration: reason === 'configuration',
              rateLimited: status === '429',
              cooldownMs: Math.min(86400000, Math.max(this.cooldownMs[provider], retryMs))
            },
            deadline
          );
        }
        const failover = [
          'transient',
          'configuration',
          'invalid_json',
          'incomplete_output',
          'local_quota',
          'concurrency_limit',
          'timeout'
        ].includes(reason);
        this.log('provider_error', { provider, model: modelName, attempt, reason, failover }, 'warn');
        const retryable = reason === 'transient' && status !== '429';
        if (!retryable || attempt + 1 >= attempts || budget.remaining < 1) return { ok: false, failover, reason };
        const delay = Math.min(100 + Math.floor(Math.random() * 100), deadline - Date.now());
        this.log('retry_scheduled', { provider, attempt: attempt + 1, delayMs: delay, reason }, 'warn');
        if (delay < 1) return { ok: false, failover: false, reason: 'timeout' };
        await bounded(() => new Promise((resolve) => setTimeout(resolve, delay)), deadline - Date.now(), signal);
      } finally {
        await admission.release(lease);
      }
    }
    return { ok: false, failover: true, reason: 'provider_error' };
  }

  async execute(
    prompt,
    { retries = 2, parseJson = JSON.parse, timeoutMs, preferredModel = '', signal, requestPolicy } = {}
  ) {
    const totalMs = Math.min(
      aiConfig.setting('AI_REQUEST_TIMEOUT_MS'),
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : Infinity
    );
    const deadline = Date.now() + totalMs;
    try {
      return await bounded(
        async (requestSignal) => {
          const { settings, states } = this.getProviderState();
          if (!settings.enabled) return { ok: false, reason: 'ai_disabled' };
          const allowed = requestPolicy?.allowedProviders;
          const priority = this.providerPriority().filter(
            (provider) => states[provider]?.enabled && (!Array.isArray(allowed) || allowed.includes(provider))
          );
          if (!priority.length) return { ok: false, reason: 'no_provider' };
          const budget = {
            remaining: Number.isInteger(requestPolicy?.maxAttempts)
              ? Math.max(1, Math.min(5, requestPolicy.maxAttempts))
              : aiConfig.PRODUCTION_ORDER.length,
            maxOutputTokens: Number.isInteger(requestPolicy?.maxOutputTokens)
              ? Math.max(128, Math.min(8000, requestPolicy.maxOutputTokens))
              : undefined,
            deadline,
            allowRetry: priority.length === 1
          };
          let lease;
          try {
            lease = await admission.enter('global', deadline, totalMs + 2000);
            let lastReason = 'no_provider';
            for (const provider of priority) {
              if (requestSignal.aborted) return { ok: false, reason: 'cancelled' };
              if (budget.remaining < 1) return { ok: false, reason: 'attempt_budget' };
              if (lastReason !== 'no_provider') this.log('provider_switched', { provider, reason: lastReason }, 'warn');
              const result = await this.tryProvider(
                provider,
                prompt,
                retries,
                parseJson,
                totalMs,
                preferredModel,
                requestSignal,
                budget
              );
              if (result.ok || !result.failover) return result;
              lastReason = result.reason;
            }
            return { ok: false, reason: lastReason };
          } finally {
            await admission.release(lease);
          }
        },
        totalMs,
        signal
      );
    } catch (error) {
      return { ok: false, reason: signal?.aborted ? 'cancelled' : error.aiReason || 'provider_error' };
    }
  }
}

module.exports = new AIProviderManager();
