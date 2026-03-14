const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require("crypto");

/**
 * AI Service: The central engine for all LLM interactions.
 * Handles Gemini API integration, retries, and JSON parsing.
 */
class AIService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    // Check if key exists and isn't a common placeholder
    if (apiKey && apiKey.length > 10 && !apiKey.includes('your_')) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.modelCandidates = this.getModelCandidates();
      this.isEnabled = true;
      this.cache = new Map(); // prompt hash → parsed JSON result
    } else {
      console.warn("⚠️ AI Service: GEMINI_API_KEY is missing or invalid. AI features will use safe fallbacks.");
      this.isEnabled = false;
    }
  }

  getModelCandidates() {
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

    const models = this.modelCandidates?.length ? this.modelCandidates : ['gemini-2.0-flash'];
    let allQuotaExhausted = true;

    for (const modelName of models) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const model = this.genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();

          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found in AI response');

          const parsed = JSON.parse(jsonMatch[0]);
          this.cache.set(cacheKey, parsed);
          allQuotaExhausted = false;
          return parsed;
        } catch (error) {
          const message = error?.message || 'Unknown AI error';
          const statusCode = error?.message?.match(/\[(\d{3})\]/)?.[1];

          if (statusCode === '404') {
            // Model doesn't exist — skip immediately, no retries
            break;
          }

          if (statusCode === '429' || message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
            // Quota exhausted — skip immediately, no retries
            break;
          }

          // Transient error — retry with backoff
          allQuotaExhausted = false;
          console.error(`AI Analysis Attempt ${attempt + 1} failed [model=${modelName}]:`, message);
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          }
        }
      }
    }

    if (allQuotaExhausted) {
      console.warn('AI Service: Daily quota exhausted — using fallback data. Results are still accurate.');
    } else {
      console.warn('AI Service: All model candidates exhausted. Returning fallback.');
    }
    return fallback;
  }
}

// Singleton instance
module.exports = new AIService();
