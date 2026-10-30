const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const assert = require('node:assert/strict');
const { entries, renderNewsEnv } = require('../config/newsEnvCatalog');

// Explicit backend paths only. Preserve raw assignments (including quoted secrets)
// and verify every existing parsed value before writing either configuration.
function organize(filename) {
  const before = fs.readFileSync(filename, 'utf8');
  const parsed = dotenv.parse(before);
  const known = new Set(entries.map((entry) => entry.key));
  const values = {};
  const lines = before.split(/\r?\n/);
  const remaining = [];
  let section = false;
  for (const line of lines) {
    if (
      /^# TECH NEWS CONFIGURATION .* START/.test(line) ||
      /^# Tech News (worker:|ingestion)/.test(line) ||
      /^# Free-text discovery:/.test(line)
    ) {
      section = true;
      continue;
    }
    if (/^# TECH NEWS CONFIGURATION .* END/.test(line)) {
      section = false;
      continue;
    }
    if (/^# Existing AI \/ course integrations/.test(line)) section = false;
    const assignment = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    if (assignment && (assignment[1].startsWith('NEWS_') || assignment[1] === 'GNEWS_API_KEY')) {
      assert.ok(
        known.has(assignment[1]),
        'Unknown news key; add runtime documentation before consolidation: ' + assignment[1]
      );
      values[assignment[1]] = assignment[2];
    } else if (!section || assignment) remaining.push(line);
  }
  const after = remaining.join('\n').trimEnd() + '\n\n' + renderNewsEnv(values);
  const reparsed = dotenv.parse(after);
  for (const [key, value] of Object.entries(parsed))
    assert.equal(reparsed[key], value, 'Existing value changed: ' + key);
  fs.writeFileSync(filename, after);
  return {
    file: path.basename(filename),
    existingValuesPreserved: Object.keys(parsed).length,
    newsKeys: entries.length
  };
}
if (require.main === module) {
  for (const file of ['.env', '.env.example'])
    console.log(JSON.stringify(organize(path.resolve(__dirname, '../..', file))));
}
module.exports = { organize };
