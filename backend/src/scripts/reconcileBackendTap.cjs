const fs = require('node:fs');
const path = require('node:path');

// Preserve every non-passing TAP result and its original diagnostics. Parent
// subtestsFailed records remain visible instead of being counted as root causes.
function field(raw, key) {
  const lines = raw.split('\n');
  const index = lines.findIndex((line) => new RegExp(`^\\s*${key}: `).test(line));
  if (index < 0) return null;
  const match = /^(\s*)[^:]+: (.*)$/.exec(lines[index]);
  if (/^[|>]/.test(match[2])) {
    const content = [];
    for (let i = index + 1; i < lines.length; i++) {
      if (lines[i].trim() && lines[i].search(/\S/) <= match[1].length) break;
      content.push(lines[i].slice(match[1].length + 2));
    }
    return content.join('\n');
  }
  return match[2].replace(/^(['"])(.*)\1$/, '$2');
}

function inventory(tap) {
  const lines = tap.split(/\r?\n/);
  const names = new Map();
  const records = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = /^(\s*)# Subtest: (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      for (const key of names.keys()) if (key >= level) names.delete(key);
      names.set(level, heading[2]);
    }
    const result = /^(\s*)(not ok|ok) (\d+) - (.*)$/.exec(line);
    if (!result || (result[2] === 'ok' && !/ # (?:SKIP|TODO)\b/i.test(result[4]))) continue;
    const indent = result[1].length;
    const diagnostic = [];
    let next = index + 1;
    if (lines[next]?.trim() === '---') {
      while (next < lines.length) {
        diagnostic.push(lines[next]);
        if (lines[next++].trim() === '...') break;
      }
    }
    const raw = diagnostic.join('\n');
    const location = /^\s*location: ['"]?(.*?)['"]?\s*$/m.exec(raw)?.[1];
    const error = field(raw, 'error');
    const failureType = /^\s*failureType: ['"]?(.*?)['"]?\s*$/m.exec(raw)?.[1];
    const skip = / # SKIP(?: (.*))?$/i.exec(result[4]);
    const file = location
      ?.replace(/\\\\/g, '/')
      .replace(/\\/g, '/')
      .match(/backend\/src\/tests\/.*?(?=:\d+:\d+$)/)?.[0];
    const record = {
      id: `TAP-${records.length + 1}`,
      line: index + 1,
      indent,
      name: result[4].replace(/ # (SKIP|TODO).*$/i, ''),
      parents: [...names]
        .filter(([key]) => key < indent)
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value),
      status: skip ? 'BLOCKED' : 'FAIL',
      kind: skip
        ? 'skip'
        : failureType === 'cancelledByParent'
          ? 'cancellation'
          : failureType === 'subtestsFailed'
            ? 'parent-summary'
            : 'failure',
      location: location || null,
      file: file || null,
      error: error || null,
      stack: field(raw, 'stack'),
      failureType: failureType || null,
      skipReason: skip?.[1] || null,
      rawResult: line,
      rawDiagnostics: raw,
      attribution: 'UNCLASSIFIED — individual reproduction and base comparison required'
    };
    records.push(record);
  }
  const files = fs.readdirSync(path.resolve(__dirname, '../tests')).filter((name) => name.endsWith('.test.js'));
  const sources = files.map((name) => ({
    name,
    text: fs.readFileSync(path.resolve(__dirname, '../tests', name), 'utf8')
  }));
  for (const record of records) {
    if (!record.file) {
      const matches = sources.filter((source) => source.text.includes(record.name));
      if (matches.length === 1) record.file = `backend/src/tests/${matches[0].name}`;
    }
    const source = sources.find((item) => item.name === path.basename(record.file || ''));
    record.prerequisiteVariablesToVerify = source
      ? [...new Set([...source.text.matchAll(/process.env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))]
      : [];
  }
  return {
    counts: Object.fromEntries(
      [...tap.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.+)$/gm)].map((m) => [
        m[1],
        Number(m[2])
      ])
    ),
    records
  };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node reconcileBackendTap.cjs input.tap output.json');
  if (path.resolve(input) === path.resolve(output)) throw new Error('Cannot overwrite raw TAP');
  const result = inventory(fs.readFileSync(input, 'utf8'));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ counts: result.counts, nonPassingRecords: result.records.length }));
}

module.exports = { inventory, field };
