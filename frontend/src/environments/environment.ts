const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const browserOrigin = typeof window !== 'undefined' && window.location?.origin
  ? window.location.origin
  : '';

const configuredApiOrigin = (globalThis as any).__DEVINSIGHT_API_ORIGIN__
  || (globalThis as any).__API_ORIGIN__
  || browserOrigin;

export const environment = {
  production: false,
  apiOrigin: trimTrailingSlash(String(configuredApiOrigin)),
  apiBaseUrl: `${trimTrailingSlash(String(configuredApiOrigin))}/api`
};
