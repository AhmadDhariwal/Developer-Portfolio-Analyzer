'use strict';

// Unavailable is null. A measured zero remains a valid signal.
const numeric = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value, digits = 0) => {
  const parsed = numeric(value);
  if (parsed === null) return null;
  if (!Number.isInteger(digits) || digits < 0 || digits > 6) throw new RangeError('Invalid rounding precision');
  const factor = 10 ** digits;
  // Do not overflow a finite input while scaling for rounding.
  const rounded = Math.abs(parsed) > Number.MAX_VALUE / factor ? parsed : Math.round(parsed * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const clamp = (value, min = 0, max = 100, fallback = min) => {
  const lower = numeric(min);
  const upper = numeric(max);
  if (lower === null || upper === null || lower > upper) throw new RangeError('Invalid score bounds');
  const parsed = numeric(value) ?? numeric(fallback) ?? lower;
  return Math.max(lower, Math.min(upper, parsed));
};
const clampScore = (value, min = 0, max = 100) => clamp(round(value), min, max);
const safeDivide = (numerator, denominator, fallback = null) => {
  const top = numeric(numerator);
  const bottom = numeric(denominator);
  if (top === null || bottom === null || bottom === 0) return fallback;
  const result = top / bottom;
  return Number.isFinite(result) ? result : fallback;
};
const safeAverage = (values = [], { fallback = null, predicate = () => true } = {}) => {
  const valid = (Array.isArray(values) ? values : []).map(numeric).filter(value => value !== null && predicate(value));
  if (!valid.length) return fallback;
  const total = valid.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(total)) return total / valid.length;
  // Scale first so a mean of large finite inputs cannot overflow during summation.
  const scale = valid.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (scale === 0) return 0;
  const mean = valid.reduce((sum, value) => sum + value / scale / valid.length, 0) * scale;
  return Number.isFinite(mean) ? mean : fallback;
};

const deduplicateSignals = (signals = []) => {
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    if (!signal || typeof signal.id !== 'string' || !signal.id.trim()) throw new TypeError('Signal id is required');
    if (seen.has(signal.id)) { duplicates.push(signal.id); continue; }
    seen.add(signal.id);
    unique.push(signal);
  }
  return { signals: unique, duplicates: [...new Set(duplicates)] };
};

const normalizeWeights = (weights = {}) => {
  const entries = Object.entries(weights || {}).map(([key, value]) => [key, numeric(value)]);
  const valid = entries.filter(([, value]) => value !== null && value > 0);
  if (!valid.length) return Object.fromEntries(entries.map(([key]) => [key, 0]));
  const scale = valid.reduce((max, [, value]) => Math.max(max, value), 0);
  const total = valid.reduce((sum, [, value]) => sum + value / scale, 0);
  return Object.fromEntries(entries.map(([key, value]) => [key, value !== null && value > 0 ? (value / scale) / total : 0]));
};

// Explicit weights only. Optional unavailable signals do not enter the denominator.
const weightedCalculation = (signals = [], { normalize = true } = {}) => {
  const unique = deduplicateSignals(signals);
  const warnings = unique.duplicates.map(id => `duplicate_signal:${id}`);
  const available = unique.signals.filter(signal => {
    if (signal.available === false || numeric(signal.value) === null) {
      warnings.push(`unavailable_signal:${signal.id}`); return false;
    }
    if (numeric(signal.weight) === null || numeric(signal.weight) <= 0) {
      warnings.push(`invalid_weight:${signal.id}`); return false;
    }
    return true;
  });
  const weights = normalize
    ? normalizeWeights(Object.fromEntries(available.map(signal => [signal.id, signal.weight])))
    : Object.fromEntries(available.map(signal => [signal.id, numeric(signal.weight)]));
  const breakdown = Object.fromEntries(unique.signals.map(signal => {
    const weight = Object.hasOwn(weights, signal.id) ? weights[signal.id] : 0;
    const value = signal.available === false ? null : numeric(signal.value);
    return [signal.id, { value, weight, available: value !== null && weight > 0, contribution: value === null ? null : numeric(value * weight) }];
  }));
  if (!available.length) return { value: null, breakdown, warnings: [...warnings, 'no_available_signals'] };
  const value = available.reduce((sum, signal) => sum + numeric(signal.value) * weights[signal.id], 0);
  return { value: Number.isFinite(value) ? value : null, breakdown, warnings: Number.isFinite(value) ? warnings : [...warnings, 'non_finite_result'] };
};

module.exports = { numeric, round, clamp, clampScore, safeDivide, safeAverage, normalizeWeights, deduplicateSignals, weightedCalculation };
