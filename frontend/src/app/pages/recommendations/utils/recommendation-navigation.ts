export function recommendationRoute(value?: string): string | null {
  return value?.startsWith('/app/') && !/[\\?#]/.test(value) ? value : null;
}

export function recommendationExternalUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
