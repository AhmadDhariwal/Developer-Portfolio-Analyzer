export function formatResumeDate(dateVal?: string | Date | null): string {
  if (!dateVal) return 'Unknown date';
  try {
    const d = new Date(dateVal);
    return isNaN(d.getTime())
      ? 'Unknown date'
      : d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
  } catch {
    return 'Unknown date';
  }
}

export function formatResumeFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// Do not coerce absent, blank or boolean values into measured zero scores.
export function finiteResumeNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resumeScoreValue(value: unknown): number | null {
  const parsed = finiteResumeNumber(value);
  return parsed === null ? null : Math.max(0, Math.min(100, Math.round(parsed)));
}
