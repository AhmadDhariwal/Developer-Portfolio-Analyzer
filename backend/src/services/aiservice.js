const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("node:crypto");
const axios = require('axios');

/**
 * AI Service: The central engine for all LLM interactions.
 * Handles Gemini API integration, retries, and JSON parsing.
 */
class AIService {
  constructor() {
    const envKey = (process.env.GEMINI_API_KEY || '').trim();
    const openAIEnvKey = (process.env.OPENAI_API_KEY || '').trim();
    const geminiFallbackKey = (process.env.GEMINI_FALLBACK_API_KEY || '').trim();

    const envLooksOpenAI = envKey.startsWith('sk-');
    this.openAIKey = openAIEnvKey || (envLooksOpenAI ? envKey : '');
    this.geminiKey = geminiFallbackKey || (envLooksOpenAI ? '' : envKey);
    this.cache = new Map(); // prompt hash -> parsed JSON result

    this.openAIModels = this.getOpenAIModelCandidates();
    this.geminiModels = this.getGeminiModelCandidates();
    this.openAICooldownUntil = 0;
    this.openAICooldownMs = Number.parseInt(process.env.OPENAI_COOLDOWN_MS || '1800000', 10);
    this.geminiCooldownUntil = 0;
    this.geminiCooldownMs = Number.parseInt(process.env.GEMINI_COOLDOWN_MS || '180000', 10);

    if (this.geminiKey && this.geminiKey.length > 10 && !this.geminiKey.includes('your_')) {
      this.genAI = new GoogleGenerativeAI(this.geminiKey);
    }

    this.hasOpenAI = !!(this.openAIKey && this.openAIKey.length > 10 && !this.openAIKey.includes('your_'));
    this.hasGemini = !!this.genAI;
    this.isEnabled = this.hasOpenAI || this.hasGemini;

    if (this.isEnabled) {
      const providers = [];
      if (this.hasOpenAI) providers.push('OpenAI');
      if (this.hasGemini) providers.push('Gemini');
      console.log(`[AIService] Providers ready: ${providers.join(', ')}. Priority: OpenAI -> Gemini.`);
    } else {
      console.warn('[AIService] No valid AI key configured. Returning safe fallbacks.');
    }
  }

  getGeminiModelCandidates() {
    const fromEnv = (process.env.GEMINI_MODEL || process.env.GEMINI_MODELS || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    // Verified available models on v1beta as of 2025
    const defaults = [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
    ];

    return [...new Set([...fromEnv, ...defaults])];
  }

  getOpenAIModelCandidates() {
    const fromEnv = (process.env.OPENAI_MODEL || process.env.OPENAI_MODELS || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    const defaults = ['gpt-4o-mini', 'gpt-4.1-mini'];
    return [...new Set([...fromEnv, ...defaults])];
  }

  extractJson(text = '') {
    const jsonMatch = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(text);
    if (!jsonMatch) throw new Error('No JSON found in AI response');
    return JSON.parse(jsonMatch[0]);
  }

  getStatusCode(error) {
    const byResponse = error?.response?.status;
    if (byResponse) return String(byResponse);
    return String(error?.message?.match(/\[(\d{3})(?:[^\]]*)\]/)?.[1] || '');
  }

  isModelMissing(statusCode, message) {
    const text = String(message || '').toLowerCase();
    return statusCode === '404' || text.includes('model_not_found') || text.includes('not found') || text.includes('is not supported');
  }

  isQuotaError(statusCode, message) {
    return statusCode === '429'
      || message.includes('quota')
      || message.includes('RESOURCE_EXHAUSTED')
      || message.includes('insufficient_quota');
  }

  isOpenAICoolingDown() {
    return Date.now() < this.openAICooldownUntil;
  }

  isGeminiCoolingDown() {
    return Date.now() < this.geminiCooldownUntil;
  }

  startOpenAICooldown(reason = 'quota/rate-limit') {
    this.openAICooldownUntil = Date.now() + this.openAICooldownMs;
    const seconds = Math.ceil(this.openAICooldownMs / 1000);
    console.warn(`[AIService] OpenAI paused for ${seconds}s due to ${reason}. Falling back to Gemini.`);
  }

  startGeminiCooldown(reason = 'quota/rate-limit') {
    this.geminiCooldownUntil = Date.now() + this.geminiCooldownMs;
    const seconds = Math.ceil(this.geminiCooldownMs / 1000);
    console.warn(`[AIService] Gemini paused for ${seconds}s due to ${reason}. Returning fallback unless OpenAI recovers.`);
  }

  async runOpenAI(prompt, modelName) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: modelName,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'Return valid JSON only. No markdown, no commentary.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${this.openAIKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const text = response.data?.choices?.[0]?.message?.content || '';
    return this.extractJson(text);
  }

  async runGemini(prompt, modelName) {
    const model = this.genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = result.response;
    return this.extractJson(response.text());
  }

  async tryProvider(provider, prompt, retries) {
    const models = provider === 'openai' ? this.openAIModels : this.geminiModels;

    for (const modelName of models) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const parsed = provider === 'openai'
            ? await this.runOpenAI(prompt, modelName)
            : await this.runGemini(prompt, modelName);

          console.log(`[AIService] Using ${provider.toUpperCase()} model: ${modelName}`);
          return { ok: true, parsed, quotaExhausted: false };
        } catch (error) {
          const message = error?.message || 'Unknown AI error';
          const statusCode = this.getStatusCode(error);

          console.error(`[AIService] ${provider.toUpperCase()} error [model=${modelName}, status=${statusCode || 'n/a'}]: ${message}`);

          if (this.isModelMissing(statusCode, message)) {
            break;
          }

          if (this.isQuotaError(statusCode, message)) {
            return { ok: false, quotaExhausted: true };
          }

          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          }
        }
      }
    }

    return { ok: false, quotaExhausted: false };
  }

  /**
   * Run a prompt through the LLM with retry logic.
   * Tries each model candidate in order.
   * 404 = model not found → skip to next model.
   * 429/quota = model quota exhausted → skip to next model.
   * Other errors = retry with exponential backoff, then try next model.
   * @param {string} prompt The full prompt string.
   * @param {object} fallback Safe JSON fallback to return on failure.
   * @param {number} retries Number of per-model retries on transient errors.
   */
  async runAIAnalysis(prompt, fallback, retries = 2) {
    if (!this.isEnabled) return fallback;

    const cacheKey = crypto.createHash('sha256').update(prompt).digest('hex');
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    let openAIQuotaExhausted = false;
    let geminiQuotaExhausted = false;

    if (this.hasOpenAI && !this.isOpenAICoolingDown()) {
      const openAIResult = await this.tryProvider('openai', prompt, retries);
      if (openAIResult.ok) {
        this.cache.set(cacheKey, openAIResult.parsed);
        return openAIResult.parsed;
      }
      openAIQuotaExhausted = openAIResult.quotaExhausted;
      if (openAIQuotaExhausted) {
        this.startOpenAICooldown('429/quota');
      }
    } else if (this.hasOpenAI && this.isOpenAICoolingDown()) {
      const waitSeconds = Math.ceil((this.openAICooldownUntil - Date.now()) / 1000);
      console.warn(`[AIService] OpenAI cooldown active (${waitSeconds}s left). Using Gemini.`);
    }

    if (this.hasGemini && !this.isGeminiCoolingDown()) {
      const geminiResult = await this.tryProvider('gemini', prompt, retries);
      if (geminiResult.ok) {
        this.cache.set(cacheKey, geminiResult.parsed);
        return geminiResult.parsed;
      }
      geminiQuotaExhausted = geminiResult.quotaExhausted;
      if (geminiQuotaExhausted) {
        this.startGeminiCooldown('429/quota');
      }
    } else if (this.hasGemini && this.isGeminiCoolingDown()) {
      const waitSeconds = Math.ceil((this.geminiCooldownUntil - Date.now()) / 1000);
      console.warn(`[AIService] Gemini cooldown active (${waitSeconds}s left).`);
    }

    if (openAIQuotaExhausted || geminiQuotaExhausted) {
      console.warn('[AIService] Quota exhausted. Returning fallback response.');
    } else {
      console.warn('[AIService] Both providers unavailable for this request. Returning fallback response.');
    }

    return fallback;
  }
}

// Singleton instance
module.exports = new AIService();
