import {
  WeeklyReport,
  WeeklyReportDataSourceStatus,
} from '../../shared/services/weekly-report.service';

export interface ScoreBreakdownItem {
  key: string;
  label: string;
  score: number | null;
  weight: number;
  contribution: number | null;
  reason: string;
}

export function overallLabel(report: WeeklyReport | null | undefined): string {
  if (!report) return 'Not assessed';
  return report.meta?.evidence?.scoreAvailable === false ? 'Not assessed' : String(report.score);
}

export function metricLabel(
  key: string,
  legacyValue: number,
  report?: WeeklyReport | null,
): string {
  const input = report?.meta?.evidence?.inputs?.[key];
  return input && !input.available ? 'Not assessed' : `${input?.value ?? legacyValue}%`;
}

export function sprintMetricLabel(report: WeeklyReport | null | undefined): string {
  if (!report) return 'Unavailable';
  const input = report.meta?.evidence?.inputs?.['sprint'];
  if (input && !input.available) {
    return input.reason === 'No tasks to assess' ? 'No tasks to assess' : 'Unavailable';
  }
  return report.meta?.sprint?.tasksTotal
    ? metricLabel('sprint', report.meta.sprint.completionRate, report)
    : 'No tasks to assess';
}

export function interviewActivityLabel(report: WeeklyReport | null | undefined): string {
  if (!report) return 'Unavailable';
  const input = report.meta?.evidence?.inputs?.['interview'];
  return input && !input.available
    ? 'Unavailable'
    : String(report.meta?.interview?.questionsGenerated ?? 0);
}

export function reportDate(value: string, report?: WeeklyReport | null): string {
  if (!Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: report?.meta?.provenance?.timezone || 'UTC',
  }).format(new Date(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

export function deltaClass(value: number): string {
  if (value > 0) return 'delta delta--up';
  if (value < 0) return 'delta delta--down';
  return 'delta';
}

export function formatDelta(value: number, comparisonAvailable: boolean, suffix = 'pts'): string {
  const numeric = Number(value || 0);
  if (!comparisonAvailable) return 'No comparable week';
  if (!Number.isFinite(numeric) || numeric === 0) return `0 ${suffix}`;
  return `${numeric > 0 ? '+' : ''}${Math.round(numeric)} ${suffix}`;
}

export function getReadinessScore(report: WeeklyReport | null | undefined): number {
  return Math.max(0, Math.min(100, Number(report?.predictedHiringReadiness?.score || 0)));
}

export function getReadinessTone(score: number): string {
  if (score >= 80) return 'Strong';
  if (score >= 65) return 'Promising';
  return 'Needs Focus';
}

export function getReadinessClass(score: number): string {
  if (score >= 80) return 'high';
  if (score >= 65) return 'medium';
  return 'low';
}

export function getRiskArea(report: WeeklyReport | null | undefined): string {
  return String(report?.biggestRiskArea || '').trim();
}

export function isSourceAvailable(
  status: WeeklyReportDataSourceStatus | null | undefined,
): boolean {
  if (!status || !status.status || status.status.toLowerCase() === 'unavailable') return false;
  return (
    status.connected === true ||
    status.analyzed === true ||
    status.available === true ||
    Boolean(status.lastAnalyzedAt)
  );
}

export function sourceTone(status: WeeklyReportDataSourceStatus): string {
  if (!isSourceAvailable(status)) return 'source-card source-card--unavailable';
  if (status?.freshness === 'stale') return 'source-card source-card--warning';
  if (status?.status?.toLowerCase().includes('failed')) return 'source-card source-card--warning';
  return 'source-card source-card--live';
}

export function statusBadgeClass(status: string): string {
  if (status === 'sent') return 'status-badge status-badge--sent';
  if (status === 'failed') return 'status-badge status-badge--failed';
  return 'status-badge status-badge--skipped';
}

export function sourceFreshness(
  status: WeeklyReportDataSourceStatus,
  report?: WeeklyReport | null,
): string {
  if (!status?.lastAnalyzedAt) return '';
  const parsed = new Date(status.lastAnalyzedAt);
  if (Number.isNaN(parsed.getTime())) return '';
  const reference =
    report?.meta?.provenance?.assessedAt || report?.updatedAt || report?.weekEndDate;
  const ageMs = (reference ? new Date(reference).getTime() : Date.now()) - parsed.getTime();
  const days = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  if (days === 0) return 'Evidence current at assessment';
  if (days === 1) return '1 day old at assessment';
  return `${days} days old at assessment`;
}

export function hasText(values: string[] | null | undefined): boolean {
  return Array.isArray(values) && values.some((value) => Boolean(String(value || '').trim()));
}

export function buildScoreBreakdown(report: WeeklyReport | null | undefined): ScoreBreakdownItem[] {
  if (!report) return [];
  const breakdown = report.meta?.scoreBreakdown || {};
  return Object.entries(breakdown).map(([key, item]) => ({
    key,
    label: item.label,
    score: report.meta?.evidence?.inputs?.[key]?.available === false ? null : item.score,
    weight: item.weight,
    contribution:
      report.meta?.evidence?.inputs?.[key]?.available === false
        ? null
        : Math.round((Number(item.score || 0) * Number(item.weight || 0)) / 100),
    reason: report.meta?.evidence?.inputs?.[key]?.reason || 'Missing evidence',
  }));
}

export function buildDataSources(
  report: WeeklyReport | null | undefined,
): Array<{ label: string; status: WeeklyReportDataSourceStatus }> {
  const sources = report?.meta?.dataSourcesUsed;
  if (!sources) return [];

  return [
    {
      label: 'Learning Hub',
      status: sources.learning || { status: 'Unavailable', lastAnalyzedAt: null },
    },
    { label: 'GitHub', status: sources.github },
    { label: 'Resume', status: sources.resume },
    { label: 'Skill Gap', status: sources.skillGap },
    { label: 'Recommendations', status: sources.recommendations },
    { label: 'Career Sprint', status: sources.careerSprint },
    { label: 'Interview Prep', status: sources.interviewPrep },
    { label: 'Portfolio', status: sources.portfolio },
    { label: 'Integrations', status: sources.integrations },
  ];
}
