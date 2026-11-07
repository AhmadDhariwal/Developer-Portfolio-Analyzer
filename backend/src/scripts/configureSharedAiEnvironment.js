const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { ENV_DEFAULTS, PRODUCTION_ORDER } = require('../config/aiProviders');

const updateText = (text) => {
  const before = dotenv.parse(text);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const added = Object.keys(ENV_DEFAULTS).filter((name) => !(name in before));
  const obsolete = (name) => /^OPENROUTER_/.test(name) || name === 'AI_ENABLE_GROQ_DEV';
  const shared = (name) => Object.hasOwn(ENV_DEFAULTS, name);
  const removed = Object.keys(before).filter(obsolete);
  const values = { ...ENV_DEFAULTS, ...before, AI_PROVIDER_PRIORITY: ENV_DEFAULTS.AI_PROVIDER_PRIORITY };
  for (const provider of PRODUCTION_ORDER) {
    const prefix = provider.toUpperCase();
    if (!values[`${prefix}_MODEL`] && !values[`${prefix}_MODELS`])
      values[`${prefix}_MODEL`] = ENV_DEFAULTS[`${prefix}_MODEL`];
  }
  const entries = new Map();
  const retained = text.split(/\r?\n/).filter((line) => {
    const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match && shared(match[1])) {
      const existing = entries.get(match[1]);
      const value = dotenv.parse(line)[match[1]];
      if (existing !== undefined && existing !== value)
        throw new Error(`Conflicting duplicate AI variable: ${match[1]}`);
      entries.set(match[1], value);
      return false;
    }
    if (match && obsolete(match[1])) return false;
    return !/^# (?:SHARED AI CONFIGURATION|Shared AI providers:|Existing AI \/ course integrations|Use a separate OpenAI credential|Gemini -> OpenAI ->)/.test(
      line
    );
  });
  while (retained.at(-1) === '') retained.pop();
  const keys = PRODUCTION_ORDER.flatMap((provider) =>
    Object.keys(ENV_DEFAULTS).filter((key) => key.startsWith(`${provider.toUpperCase()}_`))
  );
  keys.push(...Object.keys(ENV_DEFAULTS).filter((key) => !keys.includes(key)));
  const rendered = keys.map(
    (name) =>
      `${name}=${/^[A-Za-z0-9_.,:/+=-]*$/.test(String(values[name])) ? values[name] : JSON.stringify(String(values[name]))}`
  );
  const next = [
    ...retained,
    '',
    '# SHARED AI CONFIGURATION — START',
    '# Gemini -> OpenAI -> Groq -> Anthropic (Claude) -> Grok (xAI). Missing credentials stay empty.',
    ...rendered,
    '# SHARED AI CONFIGURATION — END',
    ''
  ].join(newline);
  const after = dotenv.parse(next);
  for (const [name, value] of Object.entries(before)) {
    if (
      !obsolete(name) &&
      name !== 'AI_PROVIDER_PRIORITY' &&
      !(/_MODEL$/.test(name) && shared(name) && !value) &&
      after[name] !== value
    )
      throw new Error(`Refusing to overwrite existing variable: ${name}`);
  }
  return {
    next,
    added,
    removed,
    corrected: Object.keys(ENV_DEFAULTS).filter((key) => key in before && before[key] !== after[key]),
    preservedExistingValues: true
  };
};
if (require.main === module) {
  for (const name of ['.env', '.env.example']) {
    const filename = path.resolve(__dirname, '../..', name);
    const result = updateText(fs.readFileSync(filename, 'utf8'));
    if (process.argv.includes('--apply')) fs.writeFileSync(filename, result.next);
    // No values, key fragments, fingerprints or secrets are printed.
    console.log(
      JSON.stringify({
        file: `backend/${name}`,
        applied: process.argv.includes('--apply'),
        added: result.added,
        removed: result.removed,
        corrected: result.corrected,
        preservedExistingValues: result.preservedExistingValues
      })
    );
  }
}
module.exports = { updateText };
