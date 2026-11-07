const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { ENV_DEFAULTS } = require('../config/aiProviders');

const updateText = (text) => {
  const before = dotenv.parse(text);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const added = Object.keys(ENV_DEFAULTS).filter((name) => !(name in before));
  let next = text.replace(
    /^AI_PROVIDER_PRIORITY[^\r\n]*(?:\r?\n|$)/gm,
    `AI_PROVIDER_PRIORITY=${ENV_DEFAULTS.AI_PROVIDER_PRIORITY}${newline}`
  );
  if (added.length)
    next += `${newline}# Shared AI providers: production order is fixed; Groq requires development opt-in.${newline}${added.map((name) => `${name}=${ENV_DEFAULTS[name]}`).join(newline)}${newline}`;
  const after = dotenv.parse(next);
  for (const [name, value] of Object.entries(before)) {
    if (name !== 'AI_PROVIDER_PRIORITY' && after[name] !== value)
      throw new Error(`Refusing to overwrite existing variable: ${name}`);
  }
  return { next, added, preservedExistingValues: true };
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
        preservedExistingValues: result.preservedExistingValues
      })
    );
  }
}
module.exports = { updateText };
