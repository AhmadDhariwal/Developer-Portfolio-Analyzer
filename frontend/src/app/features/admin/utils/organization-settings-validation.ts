export function organizationUrlError(value: string): string {
  if (!value) return '';
  if (value.length > 500) return 'Use at most 500 characters.';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      return 'Use an HTTPS URL without credentials, query strings or fragments.';
    return '';
  } catch {
    return 'Enter a valid HTTPS URL.';
  }
}
export function organizationTimezoneError(value: string): string {
  if (!value) return '';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return '';
  } catch {
    return 'Enter a supported IANA timezone, such as Asia/Karachi.';
  }
}
