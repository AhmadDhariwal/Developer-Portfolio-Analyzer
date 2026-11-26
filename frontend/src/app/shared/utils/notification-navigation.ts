import { AppNotification } from '../services/notification.service';

const targets = new Set([
  '/app/profile',
  '/app/resume-analyzer',
  '/app/github-analyzer',
  '/app/dashboard',
  '/app/career-sprint',
  '/app/notifications',
  '/app/support',
  '/app/skill-gap',
  '/app/recommendations',
  '/app/weekly-reports',
  '/app/integrations',
  '/app/portfolio',
]);

const adminTargets = new Set([
  '/app/admin/dashboard',
  '/app/admin/recruiters',
  '/app/admin/teams',
  '/app/admin/developers',
  '/app/admin/jobs',
  '/app/admin/console',
  '/app/admin/console/performance-statistics',
  '/app/admin/activity-logs',
  '/app/admin-console',
]);

export function notificationTarget(notification: AppNotification, role?: string): string {
  const target = notification.meta?.['target'];
  if (role === 'admin') {
    return typeof target === 'string' &&
      (adminTargets.has(target) ||
        /^\/app\/admin\/console\?tab=(overview|teams|recruiters|invitations|activity|preferences)$/.test(
          target,
        ))
      ? target
      : '/app/admin/activity-logs';
  }
  const fallback = role === 'recruiter' ? '/app/recruiter/notifications' : '/app/notifications';
  if (target === '/app/notifications' || target === '/app/recruiter/notifications') return fallback;
  if (target === '/app/jobs?view=internal')
    return ['developer', 'user', 'guest'].includes(role || '') ? target : fallback;
  if (target === '/app/recruiter/jobs') return role === 'recruiter' ? target : fallback;
  if (typeof target === 'string' && targets.has(target)) return target;
  if (notification.meta?.['ticketId']) return '/app/support';
  if (notification.meta?.['reportId']) return '/app/weekly-reports';
  if (notification.type === 'profile_update') return '/app/profile';
  if (notification.type === 'resume_upload') return '/app/resume-analyzer';
  if (notification.type === 'github_update') return '/app/github-analyzer';
  if (notification.type === 'low_score') return '/app/dashboard';
  return fallback;
}
