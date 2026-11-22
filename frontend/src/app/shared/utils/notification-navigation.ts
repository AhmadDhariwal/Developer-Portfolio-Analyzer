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

export function notificationTarget(notification: AppNotification, role?: string): string {
  const target = notification.meta?.['target'];
  if (target === '/app/jobs?view=internal')
    return ['developer', 'user', 'guest'].includes(role || '') ? target : '/app/notifications';
  if (target === '/app/recruiter/jobs') return role === 'recruiter' ? target : '/app/notifications';
  if (typeof target === 'string' && targets.has(target)) return target;
  if (notification.meta?.['ticketId']) return '/app/support';
  if (notification.meta?.['reportId']) return '/app/weekly-reports';
  if (notification.type === 'profile_update') return '/app/profile';
  if (notification.type === 'resume_upload') return '/app/resume-analyzer';
  if (notification.type === 'github_update') return '/app/github-analyzer';
  if (notification.type === 'low_score') return '/app/dashboard';
  return '/app/notifications';
}
