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
