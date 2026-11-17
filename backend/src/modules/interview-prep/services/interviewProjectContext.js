const fs = require('node:fs');
const path = require('node:path');
// Only nonsecret source/package facts. Never read .env, credentials, installed
// service state, arbitrary user paths or user-supplied filenames.
const collectServiceFiles = (dir, relBase) => {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) results.push(...collectServiceFiles(full, rel));
    else if (entry.name.endsWith('.js')) results.push({ name: entry.name, rel, full });
  }
  return results;
};

const projectContext = (topicKey) => {
  const root = path.resolve(__dirname, '../../../../..');
  const packages = {};
  for (const area of ['backend', 'frontend']) {
    const file = path.join(root, area, 'package.json');
    if (fs.existsSync(file)) packages[area] = JSON.parse(fs.readFileSync(file, 'utf8')).dependencies || {};
  }
  const configuration = [];
  const candidates = [
    ...collectServiceFiles(path.join(root, 'backend/src/core'), 'backend/src/core'),
    ...collectServiceFiles(path.join(root, 'backend/src/modules'), 'backend/src/modules'),
  ];
  const tokens = String(topicKey)
    .split('-')
    .filter((token) => token.length > 2);
  for (const item of candidates
    .filter((entry) =>
      tokens.some((token) =>
        entry.name
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .includes(token)
      )
    )
    .slice(0, 3)) {
    const text = fs.readFileSync(item.full, 'utf8');
    configuration.push({
      file: item.rel,
      moduleStyle: /\brequire\(/.test(text) ? 'CommonJS' : /\bimport\s/.test(text) ? 'ES modules' : 'unknown',
      environmentVariableNames: [
        ...new Set([...text.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]))
      ]
    });
  }
  return {
    verifiedSourceFacts: {
      packages,
      configuration,
      existingConfigurationFiles: ['backend/.env', 'frontend/proxy.conf.json'].filter((name) =>
        fs.existsSync(path.join(root, name))
      )
    },
    limitations:
      'Package declarations are not proof of installation, service status or user OS. Client OS/WSL state and environment values are unknown. General instructions must be OS-labelled. Never claim these commands have been executed or a service is running.'
  };
};
module.exports = { projectContext };
