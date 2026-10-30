'use strict';

const LIMITS = Object.freeze({ sources: 12, metrics: 32, keyLength: 64, referenceLength: 160, warnings: 24, warningLength: 160, breakdown: 32 });
const reference = (value) => typeof value === 'string' && value.trim() ? value.trim().slice(0, LIMITS.referenceLength) : null;
const scalar = value => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const metrics = (input = {}) => Object.fromEntries(Object.entries(input || {})
  .filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(key) && key.length <= LIMITS.keyLength && scalar(value))
  .slice(0, LIMITS.metrics));

// Allow-listed flat projection: no nested payload, free text, or AI response survives.
const buildEvidence = ({ sources = [], inputs = {}, facts = {} } = {}) => {
  const seen = new Set();
  const refs = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const type = reference(source?.type);
    const id = reference(source?.id);
    if (!type || !id) continue;
    const key = JSON.stringify([type, id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = { type, id };
    // Only carry a source's version if it was actually recorded on that source.
    const ruleVersion = reference(source.ruleVersion);
    if (ruleVersion) ref.ruleVersion = ruleVersion;
    refs.push(ref);
    if (refs.length === LIMITS.sources) break;
  }
  return { sources: refs, inputs: metrics(inputs), facts: metrics(facts) };
};
const leanWarnings = (warnings = []) => [...new Set((Array.isArray(warnings) ? warnings : [])
  .filter(value => typeof value === 'string').map(value => value.slice(0, LIMITS.warningLength)))].slice(0, LIMITS.warnings);

module.exports = { LIMITS, buildEvidence, leanWarnings };
