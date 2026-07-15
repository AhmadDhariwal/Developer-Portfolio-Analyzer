const crypto = require('node:crypto');
const aiProviderManager = require('./aiProviderManager');
const {
  getCacheJson,
  setCacheJson,
  deleteCacheKey,
  deleteByPrefix,
  isRedisCacheEnabled
} = require('./redisCacheService');

const AI_RESPONSE_CACHE_TTL_SECONDS = Number.parseInt(process.env.AI_RESPONSE_CACHE_TTL_SECONDS || '86400', 10);
const AI_DETERMINISTIC_CACHE_TTL_SECONDS = Number.parseInt(process.env.AI_DETERMINISTIC_CACHE_TTL_SECONDS || '600', 10);

class AIService {
  constructor() {
    this.memoryCache = new Map();
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      redisHits: 0,
      redisMisses: 0,
      redisErrors: 0,
      aiCalls: 0,
      fallbacks: 0,
      deterministicSkips: 0,
      totalLatencyMs: 0,
      aiLatencyMs: [],
      redisLatencyMs: [],
      promptTokens: []
    };
  }

  log(event, data = {}, level = 'log') {
    const line = `[AIService] ${JSON.stringify({ scope: 'AIService', event, ...data })}`;
    if (level === 'warn') console.warn(line);
    else if (level === 'error') console.error(line);
    else console.log(line);
  }

  estimatePrompt(prompt = '') {
    const chars = Buffer.byteLength(String(prompt || ''), 'utf8');
    return {
      chars,
      estimatedTokens: Math.ceil(chars / 4)
    };
  }

  hash(value = '') {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
  }

  recordRedisTiming(event, startedAt, extra = {}) {
    const redisTimeMs = Date.now() - startedAt;
    this.metrics.redisLatencyMs.push(redisTimeMs);
    this.log(event, { redisTimeMs, ...extra });
    return redisTimeMs;
  }

  memoryGet(key) {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  memorySet(key, value, ttlSeconds) {
    this.memoryCache.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : 0
    });
  }

  async getSharedCache(key, namespace = 'ai:response') {
    const cacheKey = `${namespace}:${key}`;
    if (!isRedisCacheEnabled()) {
      const localValue = this.memoryGet(cacheKey);
      if (localValue !== null) return localValue;
      return null;
    }

    const redisStartedAt = Date.now();
    try {
      const redisValue = await getCacheJson(cacheKey);
      this.recordRedisTiming(redisValue ? 'redis_cache_hit' : 'redis_cache_miss', redisStartedAt, { cacheKey: key.slice(0, 12), namespace });
      if (redisValue !== null) {
        this.metrics.redisHits += 1;
        return redisValue;
      }
      this.metrics.redisMisses += 1;
    } catch (error) {
      this.metrics.redisErrors += 1;
      this.log('redis_cache_error', { namespace, message: error.message }, 'warn');
    }
    return null;
  }

  async setSharedCache(key, value, ttlSeconds = AI_RESPONSE_CACHE_TTL_SECONDS, namespace = 'ai:response') {
    const cacheKey = `${namespace}:${key}`;
    if (isRedisCacheEnabled()) {
      const redisStartedAt = Date.now();
      await setCacheJson(cacheKey, value, ttlSeconds);
      this.recordRedisTiming('redis_cache_set', redisStartedAt, { cacheKey: key.slice(0, 12), namespace, ttlSeconds });
      return;
    }
    this.memorySet(cacheKey, value, ttlSeconds);
  }

  async invalidateCacheKey(key, namespace = 'ai:response') {
    const cacheKey = `${namespace}:${key}`;
    if (isRedisCacheEnabled()) {
      await deleteCacheKey(cacheKey);
    }
    this.memoryCache.delete(cacheKey);
  }

  async invalidateCachePrefix(prefix) {
    if (isRedisCacheEnabled()) {
      await deleteByPrefix(prefix);
    }
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) this.memoryCache.delete(key);
    }
  }

  deterministicCacheKey(feature, identity = {}) {
    return this.hash(JSON.stringify({ feature, identity }));
  }

  async getDeterministicSummary(feature, identity = {}) {
    return this.getSharedCache(this.deterministicCacheKey(feature, identity), 'ai:deterministic');
  }

  async setDeterministicSummary(feature, identity = {}, value, ttlSeconds = AI_DETERMINISTIC_CACHE_TTL_SECONDS) {
    return this.setSharedCache(this.deterministicCacheKey(feature, identity), value, ttlSeconds, 'ai:deterministic');
  }

  extractJson(text = '') {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    try {
      return JSON.parse(stripped);
    } catch (_) {}

    const jsonMatch = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(stripped);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const candidate = jsonMatch[0];
    try {
      return JSON.parse(candidate);
    } catch (_) {}

    try {
      return JSON.parse(this.repairJson(candidate));
    } catch (_) {}

    throw new Error('Failed to parse JSON from AI response');
  }

  repairJson(text) {
    const stack = [];
    let inString = false;
    let escape = false;

    for (const ch of text) {
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }

    let repaired = text.trimEnd().replace(/,\s*$/, '');
    while (stack.length) repaired += stack.pop();
    return repaired;
  }

  recordDeterministicSkip(feature = 'unknown') {
    this.metrics.deterministicSkips += 1;
    this.log('ai_skipped_deterministic', { feature });
  }

  getBenchmarkSnapshot() {
    const totalCacheLookups = this.metrics.cacheHits + this.metrics.cacheMisses;
    const averagePromptTokens = this.metrics.promptTokens.length
      ? Math.round(this.metrics.promptTokens.reduce((sum, value) => sum + value, 0) / this.metrics.promptTokens.length)
      : 0;
    return {
      requests: this.metrics.requests,
      aiCalls: this.metrics.aiCalls,
      fallbacks: this.metrics.fallbacks,
      deterministicSkips: this.metrics.deterministicSkips,
      averageLatencyMs: this.metrics.requests ? Math.round(this.metrics.totalLatencyMs / this.metrics.requests) : 0,
      averageAiLatencyMs: this.metrics.aiLatencyMs.length
        ? Math.round(this.metrics.aiLatencyMs.reduce((sum, value) => sum + value, 0) / this.metrics.aiLatencyMs.length)
        : 0,
      averageRedisLatencyMs: this.metrics.redisLatencyMs.length
        ? Math.round(this.metrics.redisLatencyMs.reduce((sum, value) => sum + value, 0) / this.metrics.redisLatencyMs.length)
        : 0,
      averagePromptTokens,
      cache: {
        localFallbackSize: this.memoryCache.size,
        redisEnabled: isRedisCacheEnabled(),
        hits: this.metrics.cacheHits,
        misses: this.metrics.cacheMisses,
        redisHits: this.metrics.redisHits,
        redisMisses: this.metrics.redisMisses,
        redisErrors: this.metrics.redisErrors,
        hitRatio: totalCacheLookups ? Number((this.metrics.cacheHits / totalCacheLookups).toFixed(3)) : 0
      },
      deterministicSkipRatio: this.metrics.requests + this.metrics.deterministicSkips
        ? Number((this.metrics.deterministicSkips / (this.metrics.requests + this.metrics.deterministicSkips)).toFixed(3))
        : 0,
      providers: aiProviderManager.getStatus()
    };
  }

  getProviderStatus() {
    return aiProviderManager.getStatus();
  }

  async runAIAnalysis(prompt, fallback, retries = 2, { timeoutMs } = {}) {
    const startedAt = Date.now();
    this.metrics.requests += 1;

    const promptStats = this.estimatePrompt(prompt);
    this.metrics.promptTokens.push(promptStats.estimatedTokens);
    this.log('prompt_size', {
      chars: promptStats.chars,
      estimatedTokens: promptStats.estimatedTokens,
      overTarget: promptStats.estimatedTokens > 5000
    }, promptStats.estimatedTokens > 5000 ? 'warn' : 'log');

    const cacheKey = this.hash(prompt);
    const cachedValue = await this.getSharedCache(cacheKey);
    if (cachedValue !== null) {
      this.metrics.cacheHits += 1;
      this.metrics.totalLatencyMs += Date.now() - startedAt;
      this.log('prompt_cache_hit', { cacheKey: cacheKey.slice(0, 12), durationMs: Date.now() - startedAt });
      return cachedValue;
    }

    this.metrics.cacheMisses += 1;
    this.log('prompt_cache_miss', { cacheKey: cacheKey.slice(0, 12) });

    const status = aiProviderManager.getStatus();
    if (!status.enabledProviders.length) {
      this.metrics.fallbacks += 1;
      this.log('fallback_no_provider', {
        disabledProviders: status.disabledProviders
      }, 'warn');
      return fallback;
    }

    const result = await aiProviderManager.execute(prompt, {
      retries,
      timeoutMs,
      parseJson: (text) => this.extractJson(text)
    });

    if (result.ok) {
      this.metrics.aiCalls += 1;
      this.metrics.aiLatencyMs.push(result.latencyMs || 0);
      await this.setSharedCache(cacheKey, result.parsed);
      this.metrics.totalLatencyMs += Date.now() - startedAt;
      this.log('ai_request_complete', {
        provider: result.provider,
        model: result.model,
        aiLatencyMs: result.latencyMs,
        durationMs: Date.now() - startedAt
      });
      return result.parsed;
    }

    this.metrics.fallbacks += 1;
    this.metrics.totalLatencyMs += Date.now() - startedAt;
    this.log('fallback_all_providers_failed', {
      durationMs: Date.now() - startedAt,
      reason: result.reason
    }, 'warn');
    return fallback;
  }
}

module.exports = new AIService();
