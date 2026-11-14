import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Job } from '../models/job.model';
import { jobDate, jobSalary, safeJobUrl, jobRequestError, jobSourceUrl } from './job-presentation';

describe('job presentation accuracy and safety', () => {
  it('links provider attribution only to known official sources', () => {
    for (const source of ['Remotive', 'Arbeitnow', 'RemoteOK', 'Adzuna', 'Jooble', 'JSearch']) {
      const url = jobSourceUrl({ source, platform: 'Other' });
      expect(safeJobUrl(url)).toBe(url);
      expect(url).not.toBe('');
    }
    expect(jobSourceUrl({ source: 'Adzuna', platform: 'Other' })).toBe('https://www.adzuna.com/');
    expect(jobSourceUrl({ source: 'javascript:alert(1)', platform: 'Other' })).toBe('');
    for (const source of ['__proto__', 'constructor', 'toString'])
      expect(jobSourceUrl({ source, platform: 'Other' })).toBe('');
  });
  it('rejects unsafe external links', () => {
    for (const value of [
      'javascript:alert(1)',
      'http://127.1/',
      'http://2130706433',
      'http://10.0.0.1',
      'https://user:password@example.com',
      'https://a.local',
      'http://[::1]',
    ])
      expect(safeJobUrl(value)).toBe('');
    expect(safeJobUrl('https://example.com/job')).toBe('https://example.com/job');
  });
  it('does not invent dates, currency or salary', () => {
    expect(jobDate('not-a-date')).toBe('Not provided');
    expect(jobDate('')).toBe('Not provided');
    expect(jobSalary({ salary: '' } as Job)).toBe('Salary not provided');
    expect(
      jobSalary({ salaryMetadata: { min: 0, max: 100, currency: null, period: null } } as Job),
    ).toBe('0 – 100');
  });
  it('handles retry dates, offline and temporary service failures', () => {
    const date = new Date(Date.now() + 120000).toUTCString();
    const failure = jobRequestError(
      new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': date }) }),
    );
    expect(failure.retryAt).toBeGreaterThan(Date.now() + 110000);
    expect(jobRequestError(new HttpErrorResponse({ status: 0 })).message).toContain('offline');
    expect(jobRequestError(new HttpErrorResponse({ status: 503 })).message).toContain(
      'not been changed',
    );
  });
});
