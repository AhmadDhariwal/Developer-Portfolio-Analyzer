import { describe, expect, it } from 'vitest';
import { AppNotification } from '../services/notification.service';
import { notificationTarget } from './notification-navigation';

describe('notification navigation', () => {
  const notice = (meta: Record<string, unknown>) => ({ type: 'info', meta }) as AppNotification;
  it('keeps every Admin fallback inside Activity Logs, including legacy and private-workspace hints', () => {
    for (const meta of [
      {},
      { target: '/app/notifications' },
      { target: '/app/recruiter/notifications' },
      { target: '/app/profile' },
      { target: '/app/recruiter/jobs' },
      { target: '/app/jobs?view=internal' },
      { target: '/app/super-admin/dashboard' },
      { target: '/app/admin-unknown' },
      { ticketId: 'synthetic' },
      { reportId: 'synthetic' },
      { target: '//attacker.test' },
      { target: '/app/admin/teams?token=unsafe' },
    ])
      expect(notificationTarget(notice(meta), 'admin')).toBe('/app/admin/activity-logs');
    for (const type of ['profile_update', 'resume_upload', 'github_update', 'low_score']) {
      expect(notificationTarget({ type } as AppNotification, 'admin')).toBe(
        '/app/admin/activity-logs',
      );
    }
  });
  it('preserves explicit authorized Admin targets without allowing them for other roles', () => {
    for (const target of [
      '/app/admin/dashboard',
      '/app/admin/jobs',
      '/app/admin/teams',
      '/app/admin/console?tab=teams',
      '/app/admin/console/performance-statistics',
      '/app/admin/activity-logs',
    ]) {
      expect(notificationTarget(notice({ target }), 'admin')).toBe(target);
      expect(notificationTarget(notice({ target }), 'developer')).toBe('/app/notifications');
      expect(notificationTarget(notice({ target }), 'recruiter')).toBe(
        '/app/recruiter/notifications',
      );
    }
  });
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
      '/app/recruiter/notifications',
    );
    expect(notificationTarget(notice({ target: '/app/recruiter/jobs' }), 'recruiter')).toBe(
      '/app/recruiter/jobs',
    );
    expect(notificationTarget(notice({ target: '/app/recruiter/jobs' }), 'developer')).toBe(
      '/app/notifications',
    );
  });
  it('keeps Recruiter fallback destinations inside its notification workspace', () => {
    for (const meta of [
      {},
      { target: '/app/notifications' },
      { target: 'https://attacker.test' },
    ]) {
      expect(notificationTarget(notice(meta), 'recruiter')).toBe('/app/recruiter/notifications');
    }
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
