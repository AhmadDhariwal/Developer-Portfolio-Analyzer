'use strict';
const crypto = require('node:crypto');
const { acquireCacheLock, releaseCacheLock } = require('./redisCacheService');

const enrich = async ({ aiService, prompt, signalHash, identity, enabled, governance }) => {
  if (!enabled || governance?.signal.aborted) return { ok: false };
  const key = `recommendations:enrichment-lock:${identity}:${signalHash}`;
  const token = crypto.randomUUID();
  let acquired = null;
  try {
    acquired = await acquireCacheLock(key, token, 60);
  } catch {
    // Optional Redis failure cannot disable the Mongo-governed deterministic path.
  }
  // A different instance already owns the optional enrichment. The caller can
  // still return a useful deterministic result without another paid AI call.
  if (acquired === false) return { ok: false };
  let aiCalled = false;
  try {
    if (governance) {
      const controls = require('./recommendationGovernanceService');
      await controls.transaction((session) =>
        controls.fence(governance.reservation, session, governance.signal)
      );
      await controls.consume(governance.owner, governance.ip, ['ai']);
      if (governance.signal.aborted) return { ok: false };
    }
    aiCalled = true;
    const result = await aiService.runAIAnalysis(prompt, { __fallback: true }, 0, {
      timeoutMs: 7000,
      returnMeta: true,
      signal: governance?.signal,
    });
    return { ...(result && typeof result === 'object' ? result : { ok: false }), aiCalled: true };
  } catch {
    return { ok: false, aiCalled };
  } finally {
    if (acquired) await releaseCacheLock(key, token).catch(() => {});
  }
};

module.exports = { enrich };
