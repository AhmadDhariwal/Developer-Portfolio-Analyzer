import { CareerSprint, SprintTask } from '../../../shared/services/career-sprint.service';

export function taskDescription(task: SprintTask): { body: string; sourceDetails: string } {
  const description = task.description || '';
  // Existing backend edits may normalize newlines to spaces. Keep both forms readable.
  const marker = /[\n ](?:Course|Recommendation):/.exec(description);
  return marker
    ? { body: description.slice(0, marker.index), sourceDetails: description.slice(marker.index) }
    : { body: description, sourceDetails: '' };
}

export function sprintZone(sprint: CareerSprint): string | null {
  if (sprint.legacyAccess?.calendarStatus === 'provenance-unresolved') return null;
  return (
    sprint.legacyAccess?.timeZone || sprint.timeZone || sprint.migrationCalendarTimeZone || null
  );
}

export function sprintReadOnly(sprint: CareerSprint): boolean {
  return sprint.legacyAccess?.readOnly ?? !sprintZone(sprint);
}

export function calendarKey(value: string | Date | null | undefined, zone: string | null): string {
  if (!value || !zone) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (key: string) => parts.find((entry) => entry.type === key)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return '';
  }
}

export function formatSprintDate(value: string | null | undefined, sprint: CareerSprint): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (!Number.isFinite(+date)) return 'Date unavailable';
  const zone = sprintZone(sprint);
  if (!zone) return `${date.toISOString().replace('T', ' ').replace('Z', '')} UTC`;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function sprintError(error: unknown, fallback: string): string {
  const response = error as { status?: number; error?: { message?: string } };
  const message = response?.error?.message || fallback;
  if (response?.status === 409)
    return `${message} Your saved data is preserved. Refresh to review the latest Sprint or draft context before retrying.`;
  if (response?.status === 0)
    return 'Connection unavailable. Your saved data is preserved. Reconnect and retry.';
  return message;
}

export function restoreEligible(sprint: CareerSprint, now: number): boolean {
  const meta = sprint.restoreMeta;
  if (sprintReadOnly(sprint) || !meta?.canRestore) return false;
  if (meta.policy === 'sprint-calendar-48h-v1')
    return Boolean(meta.expiresAt && now < +new Date(meta.expiresAt));
  return meta.canRestore;
}
