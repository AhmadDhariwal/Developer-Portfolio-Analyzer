'use strict';
const crypto = require('node:crypto');
const { acquireCacheLock, releaseCacheLock } = require('./redisCacheService');

const enrich = async ({ aiService, prompt, signalHash, identity, enabled }) => {
  if (!enabled) return { ok: false };
  const key = `recommendations:enrichment-lock:${identity}:${signalHash}`;
  const token = crypto.randomUUID();
  const acquired = await acquireCacheLock(key, token, 60);
  // A different instance already owns the optional enrichment. The caller can
  // still return a useful deterministic result without another paid AI call.
  if (acquired === false) return { ok: false };
  try {
    const result = await aiService.runAIAnalysis(prompt, { __fallback: true }, 0, {
      timeoutMs: 7000,
      returnMeta: true,
    });
    return { ...(result && typeof result === 'object' ? result : { ok: false }), aiCalled: true };
  } catch {
    return { ok: false, aiCalled: true };
  } finally {
    if (acquired) await releaseCacheLock(key, token);
  }
};

module.exports = { enrich };
