import { HttpErrorResponse } from '@angular/common/http';
import { Job } from '../models/job.model';

export function safeJobUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      return '';
    const host = url.hostname.toLowerCase();
    if (
      !host.includes('.') ||
      host.includes(':') ||
      /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      /\.(local|internal|localhost)$/.test(host)
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}

export function jobDate(value: unknown): string {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        date,
      )
    : 'Not provided';
}

export function jobExpired(job: Job): boolean {
  return [job.validThrough, job.cacheExpiresAt].some(
    (value) =>
      Boolean(value) &&
      Number.isFinite(Date.parse(String(value))) &&
      Date.parse(String(value)) <= Date.now(),
  );
}

export function jobSalary(job: Job): string {
  const data = job.salaryMetadata;
  const min = typeof data?.min === 'number' && Number.isFinite(data.min) ? data.min : null;
  const max = typeof data?.max === 'number' && Number.isFinite(data.max) ? data.max : null;
  if (min !== null || max !== null) {
    const range = [min, max]
      .filter((value) => value !== null)
      .map((value) => new Intl.NumberFormat('en').format(value!))
      .join(' – ');
    return `${range}${data?.currency ? ' ' + data.currency : ''}${data?.period ? ' / ' + data.period.toLowerCase() : ''}`;
  }
  return job.salary || 'Salary not provided';
}

export function jobRequestError(error: HttpErrorResponse): { message: string; retryAt: number } {
  const retry = error.headers?.get('Retry-After');
  const delay =
    retry && Number.isFinite(Number(retry))
      ? Number(retry) * 1000
      : retry
        ? Date.parse(retry) - Date.now()
        : 0;
  const retryAt = delay > 0 ? Date.now() + delay : error.status === 429 ? Date.now() + 60000 : 0;
  const messages: Record<number, string> = {
    0: 'You appear to be offline. Your last results are still here; reconnect to sync changes.',
    401: 'Your session has expired. Sign in again to continue.',
    403: 'Your account cannot access this job right now.',
    404: 'This listing is hidden or no longer available. Your saved activity is retained.',
    429: 'You have reached a temporary request limit. Wait before trying again.',
    503: 'Job services are temporarily unavailable. Your activity has not been changed.',
  };
  return {
    message: messages[error.status] || 'We could not load this update. Please try again.',
    retryAt,
  };
}
