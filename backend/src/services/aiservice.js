const { GoogleGenerativeAI } = require("@google/generative-ai");

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

    const defaults = [
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro-latest'
    ];

    return [...new Set([...fromEnv, ...defaults])];
  }

  /**
   * Run a prompt through the LLM with retry logic.
   * @param {string} prompt The full prompt string.
   * @param {object} fallback Safe JSON fallback to return on failure.
   * @param {number} retries Number of times to retry on invalid JSON/API error.
   */
  async runAIAnalysis(prompt, fallback, retries = 3) {
    if (!this.isEnabled) return fallback;

    const totalAttempts = Math.max(1, retries);
    const models = this.modelCandidates?.length ? this.modelCandidates : ['gemini-2.0-flash'];
    let unrecoverableError = false;

    for (let i = 0; i < totalAttempts; i++) {
      const modelName = models[i % models.length];

      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Extract JSON if it's wrapped in markdown code blocks
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in AI response');

        const cleanJson = jsonMatch[0];
        return JSON.parse(cleanJson);
      } catch (error) {
        const message = error?.message || 'Unknown AI error';
        const statusCode = error?.message?.match(/\[(\d{3})\]/)?.[1];

        // Short-circuit on quota exhausted (429) or unsupported model (404)
        if (statusCode === '429' || statusCode === '404' || message.includes('quota')) {
          console.warn(`AI Service: ${statusCode || 'Quota/Model'} error detected. Stopping retries early.`);
          unrecoverableError = true;
          break;
        }

        console.error(`AI Analysis Attempt ${i + 1} failed [model=${modelName}]:`, message);

        // Wait before retry (exponential backoff) — but don't retry if unrecoverable
        if (!unrecoverableError) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
      }
    }

    console.warn("AI Service: All retries exhausted or unrecoverable error. Returning fallback.");
    return fallback;
  }
}

// Singleton instance
module.exports = new AIService();
