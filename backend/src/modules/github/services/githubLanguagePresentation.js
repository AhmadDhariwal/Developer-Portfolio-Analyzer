// Use raw saved weights to keep both code charts on the same denominator.
const SUPPORT_LANGUAGES = new Set([
  'HTML',
  'CSS',
  'SCSS',
  'Sass',
  'Less',
  'JSON',
  'Markdown',
  'MDX',
  'YAML',
  'XML',
  'Dockerfile',
  'Shell',
  'Makefile',
  'Procfile',
  'Jupyter Notebook'
]);

function entriesFor(source) {
  const rows = Array.isArray(source)
    ? source.map((row) => [row?.language, row?.bytes ?? row?.percentage])
    : Object.entries(source instanceof Map ? Object.fromEntries(source) : source || {});
  const weights = new Map();
  for (const [name, value] of rows) {
    const language = String(name ?? '').trim();
    const weight = Number(value);
    if (!language || /^(null|undefined)$/i.test(language) || !Number.isFinite(weight) || weight <= 0)
      continue;
    weights.set(language, (weights.get(language) || 0) + weight);
  }
  return [...weights].sort(([a, aw], [b, bw]) => bw - aw || a.localeCompare(b));
}

function proportions(rows) {
  const total = rows.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) return [];
  // Preserve the full numeric shares for chart geometry. The largest bucket absorbs
  // floating-point residue rather than hiding real usage in a small bucket.
  const values = rows.map(([language, weight]) => ({ language, percentage: (weight / total) * 100 }));
  const sum = values.reduce((acc, row) => acc + row.percentage, 0);
  values[0].percentage += 100 - sum;
  return values;
}

function languagePresentation(rawBytes, fallback) {
  const measured = entriesFor(rawBytes);
  const rows = measured.length ? measured : entriesFor(fallback);
  return {
    mainLanguageDistribution: proportions(rows.filter(([name]) => !SUPPORT_LANGUAGES.has(name))),
    supportLanguageDistribution: proportions(rows).filter(({ language }) => SUPPORT_LANGUAGES.has(language))
  };
}

module.exports = { SUPPORT_LANGUAGES, languagePresentation };
