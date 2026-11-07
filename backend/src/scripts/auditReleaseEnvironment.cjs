// Names/presence only: never emit environment values, endpoints or credential hashes.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { ENV_DEFAULTS, PRODUCTION_ORDER, PROVIDERS } = require('../config/aiProviders');

function audit() {
  const backend = path.resolve(__dirname, '../..');
  const files = ['.env', '.env.example'].map((name) => {
    const text = fs.readFileSync(path.join(backend, name), 'utf8');
    const values = dotenv.parse(text);
    const names = [...text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
    return { name, values, duplicateNames: [...new Set(names.filter((key, i) => names.indexOf(key) !== i))] };
  });
  const references = new Map();
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['tests', 'scripts', 'node_modules'].includes(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(filename, 'utf8');
        for (const match of source.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)) {
          const key = match[1] || match[2];
          if (!references.has(key)) references.set(key, new Set());
          references.get(key).add(path.relative(backend, filename).replaceAll('\\', '/'));
        }
      }
    }
  }
  walk(path.join(backend, 'src'));
  const names = [
    ...new Set([...references.keys(), ...Object.keys(ENV_DEFAULTS), ...files.flatMap((f) => Object.keys(f.values))])
  ].sort();
  return {
    scope:
      'Static literal runtime references plus declared keys and computed shared AI registry. Dynamic storage/News keys are also covered by their configuration suites; presence does not prove validity or live access.',
    files: files.map((f) => ({ file: `backend/${f.name}`, duplicateNames: f.duplicateNames })),
    keys: names.map((key) => ({
      name: key,
      runtimeFiles: [...(references.get(key) || [])],
      sharedDefaultDefined: key in ENV_DEFAULTS,
      localDeclared: key in files[0].values,
      exampleDeclared: key in files[1].values,
      localConfigured: !!files[0].values[key]
    })),
    providers: PRODUCTION_ORDER.map((provider) => ({
      provider,
      model: files[0].values[`${provider.toUpperCase()}_MODEL`] || PROVIDERS[provider].defaults[0],
      credentialConfigured: !!files[0].values[`${provider.toUpperCase()}_API_KEY`],
      status: files[0].values[`${provider.toUpperCase()}_API_KEY`]
        ? 'LIVE_CHECK_REQUIRED'
        : 'BLOCKED_MISSING_CREDENTIAL'
    })),
    sharedKeysMissing: files.map((f) => ({
      file: f.name,
      names: Object.keys(ENV_DEFAULTS).filter((key) => !(key in f.values))
    })),
    keySetMismatch: {
      localOnly: Object.keys(files[0].values).filter((k) => !(k in files[1].values)),
      exampleOnly: Object.keys(files[1].values).filter((k) => !(k in files[0].values))
    }
  };
}
if (require.main === module) {
  const output = path.resolve(
    __dirname,
    '../../verification/interview-prep/release-finalization/environment-inventory.json'
  );
  const result = audit();
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      keys: result.keys.length,
      files: result.files,
      providers: result.providers,
      keySetMismatch: result.keySetMismatch
    })
  );
}
module.exports = { audit };
