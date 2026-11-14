'use strict';
const uniqueBy = (values = [], keyFn) => {
  const seen = new Set();
  return values.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueStrings = (values = [], limit = 12) =>
  uniqueBy(values.map((value) => String(value || '').trim()).filter(Boolean), (value) =>
    value.toLowerCase(),
  ).slice(0, limit);

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const normalizeActionList = (values = [], fallback = [], min = 2, max = 6) => {
  const safe = uniqueStrings(values, max);
  if (safe.length >= min) return safe.slice(0, max);
  return uniqueStrings([...safe, ...fallback], max).slice(
    0,
    Math.max(min, Math.min(max, safe.length + fallback.length)),
  );
};

module.exports = { uniqueBy, uniqueStrings, clamp, normalizeActionList };
