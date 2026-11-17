const crypto = require('node:crypto');

const canonical = (value) => {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toJSON();
  if (value instanceof Map) return canonical(Object.fromEntries(value));
  if (value.toHexString) return value.toHexString();
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
};
const fingerprint = (value) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

// Read the same projected facts, not just max(updatedAt): this also detects
// deletions, same-millisecond changes and legacy writers without revision counters.
// This is bounded optimistic validation, not a transaction isolation guarantee.
async function readStableDashboard(load) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const first = await load();
    const second = await load();
    if (fingerprint(first) === fingerprint(second))
      return { ...second, revision: fingerprint(second) };
  }
  const error = new Error('Dashboard evidence changed during refresh. Please retry.');
  error.status = 409;
  error.code = 'DASHBOARD_EVIDENCE_CHANGED';
  throw error;
}

module.exports = { fingerprint, readStableDashboard };
