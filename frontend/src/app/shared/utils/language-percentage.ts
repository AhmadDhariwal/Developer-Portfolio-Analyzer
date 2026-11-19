export function formatLanguagePercentage(value: number): string {
  if (value > 0 && value < 0.01) return '<0.01%';
  return `${Number(value.toFixed(2))}%`;
}

// Display two decimal places with a 100% rounded total. Chart data keeps the
// original shares, including positive slices smaller than one basis point.
export function languagePercentageLabels(shares: readonly number[]): string[] {
  if (!shares.length) return [];
  const units = shares.map((value, index) => {
    const exact = value * 100;
    return { index, rounded: Math.floor(exact), remainder: exact % 1 };
  });
  const remaining = 10000 - units.reduce((total, entry) => total + entry.rounded, 0);
  const ranked = [...units].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of ranked.slice(0, Math.max(0, remaining))) entry.rounded++;
  return units.map(({ index, rounded }) =>
    rounded === 0 && shares[index] > 0 ? '<0.01%' : formatLanguagePercentage(rounded / 100),
  );
}
