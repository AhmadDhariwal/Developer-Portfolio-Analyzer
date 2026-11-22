import { describe, expect, it } from 'vitest';
import { AppNotification } from '../services/notification.service';
import { notificationTarget } from './notification-navigation';

describe('notification navigation', () => {
  const notice = (meta: Record<string, unknown>) => ({ type: 'info', meta }) as AppNotification;
  it('allows known originating modules and legacy ticket references', () => {
    expect(notificationTarget(notice({ target: '/app/recommendations' }))).toBe(
      '/app/recommendations',
    );
    expect(notificationTarget(notice({ ticketId: 'synthetic' }))).toBe('/app/support');
  });
  it('checks the current role before opening application notification destinations', () => {
    expect(notificationTarget(notice({ target: '/app/jobs?view=internal' }), 'developer')).toBe(
      '/app/jobs?view=internal',
    );
    expect(notificationTarget(notice({ target: '/app/jobs?view=internal' }), 'recruiter')).toBe(
      '/app/notifications',
    );
    expect(notificationTarget(notice({ target: '/app/recruiter/jobs' }), 'recruiter')).toBe(
      '/app/recruiter/jobs',
    );
    expect(notificationTarget(notice({ target: '/app/recruiter/jobs' }), 'developer')).toBe(
      '/app/notifications',
    );
  });
  it('rejects external links, script URLs, protocol-relative paths and admin routes', () => {
    for (const target of [
      'javascript:alert(1)',
      '//attacker.test',
      'https://attacker.test',
      '/super-admin/dashboard',
      '/app/profile?token=secret',
    ]) {
      expect(notificationTarget(notice({ target }))).toBe('/app/notifications');
    }
  });
});
