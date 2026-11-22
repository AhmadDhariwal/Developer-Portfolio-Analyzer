/** Build a 2-letter uppercase monogram badge from a name or organization label. */
export function formatInitials(value?: string | null): string {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'DA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

/** Return a short display fingerprint for a full SHA-256 digest string. */
export function truncateSha256(digest?: string | null): string {
  const value = String(digest || '').trim();
  if (!value) return '—';
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
