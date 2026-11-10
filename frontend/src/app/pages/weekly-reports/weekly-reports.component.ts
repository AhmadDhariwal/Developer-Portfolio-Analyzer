import { ActivatedRoute } from '@angular/router';
import { Subject, finalize, takeUntil } from 'rxjs';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy, Optional, Inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  WeeklyReport,
  WeeklyReportDataSourceStatus,
  WeeklyReportService,
} from '../../shared/services/weekly-report.service';

@Component({
  selector: 'app-weekly-reports',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-reports.component.html',
  styleUrl: './weekly-reports.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeeklyReportsComponent implements OnInit, OnDestroy {
  private readonly destroyed = new Subject<void>();

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  get trendReports(): WeeklyReport[] {
    return [...this.history].reverse();
  }

  latestReport: WeeklyReport | null = null;
  history: WeeklyReport[] = [];
  isLoading = false;
  isGenerating = false;
  errorMessage = '';
  loadSource: 'frontend-cache' | 'api' | 'generated' = 'api';
  loadedAt: Date | null = null;
  isHistoryOpen = false;
  isExporting = false;
  isResending = false;
  actionMessage = '';
  private deepLinkLoaded = false;

  constructor(
    private readonly reportService: WeeklyReportService,
    private readonly cdr: ChangeDetectorRef,
    @Optional() @Inject(ActivatedRoute) private readonly route: ActivatedRoute | null = null,
  ) {}

  ngOnInit(): void {
    this.loadReports();
  }

  get skeletonItems(): number[] {
    return Array.from({ length: 6 }, (_, index) => index);
  }

  get latestComparisons() {
    return this.latestReport?.meta.comparisons || null;
  }

  get dataSources(): Array<{ label: string; status: WeeklyReportDataSourceStatus }> {
    const sources = this.latestReport?.meta.dataSourcesUsed;
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

  get scoreBreakdown(): Array<{
    key: string;
    label: string;
    score: number | null;
    weight: number;
    contribution: number | null;
  }> {
    const breakdown = this.latestReport?.meta.scoreBreakdown || {};
    return Object.entries(breakdown).map(([key, item]) => ({
      key,
      label: item.label,
      score: this.latestReport?.meta.evidence?.inputs[key]?.available === false ? null : item.score,
      weight: item.weight,
      contribution: this.latestReport?.meta.evidence?.inputs[key]?.available === false ? null : Math.round((Number(item.score || 0) * Number(item.weight || 0)) / 100),
    }));
  }

  get loadSourceLabel(): string {
    if (this.loadSource === 'frontend-cache') return 'Loaded from cache';
    if (this.loadSource === 'generated') return 'Generated report';
    return 'Loaded from saved report';
  }

  get narrativeSourceLabel(): string {
    const source = this.latestReport?.meta.narrativeSource;
    if (source === 'ai-enhanced') return 'AI-enhanced';
    if (source === 'cached') return 'Cached report';
    return 'Deterministic';
  }

  loadReports(): void {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.reportService
      .getDashboard(6)
      .pipe(
        takeUntil(this.destroyed),
        finalize(() => {
          this.isLoading = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: ({ latest, history, fromFrontendCache, cachedAt }) => {
          this.latestReport = latest;
          const id = this.route?.snapshot.queryParamMap.get('report');
          const version = this.route?.snapshot.queryParamMap.get('version') || undefined;
          if (id && !this.deepLinkLoaded) {
            this.deepLinkLoaded = true;
            this.reportService.getReport(id, version).pipe(takeUntil(this.destroyed)).subscribe({ next: (saved) => { this.latestReport = saved; this.cdr.markForCheck(); }, error: (error) => { this.errorMessage = error?.error?.message || 'Saved report version could not be loaded.'; this.cdr.markForCheck(); } });
          }
          this.history = history;
          this.loadSource = fromFrontendCache ? 'frontend-cache' : 'api';
          this.loadedAt = cachedAt ? new Date(cachedAt) : new Date();
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Unable to load weekly reports right now.';
          this.latestReport = null;
          this.history = [];
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  generateReport(refresh = false): void {
    if (this.isGenerating) return;
    this.isGenerating = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    const request = refresh && this.latestReport ? this.reportService.refreshReport(this.latestReport) : this.reportService.generateReport(false);
    request
      .pipe(
        takeUntil(this.destroyed),
        finalize(() => {
          this.isGenerating = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (report) => {
          this.latestReport = report;
          this.history = this.mergeHistory(report);
          this.loadSource = 'generated';
          this.loadedAt = new Date();
          this.isGenerating = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage =
            error?.error?.message || 'Unable to generate the weekly report right now.';
          this.isGenerating = false;
          this.cdr.markForCheck();
        },
      });
  }

  get isArchivedVersion(): boolean { const selected = this.latestReport; const current = this.history.find((item) => item._id === selected?._id); return !!current && current.meta.reportHash !== selected?.meta.reportHash; }
  get isCurrentWeek(): boolean { const report = this.latestReport; const now = Date.now(); return !!report && new Date(report.weekStartDate).getTime() <= now && now <= new Date(report.weekEndDate).getTime(); }
  get comparisonAvailable(): boolean { return this.latestReport?.meta.comparison?.available === true; }
  overallLabel(report: WeeklyReport): string { return report.meta.evidence?.scoreAvailable === false ? 'Not assessed' : String(report.score); }
  metricLabel(key: string, legacyValue: number): string { const input = this.latestReport?.meta.evidence?.inputs[key]; return input && !input.available ? 'Not assessed' : `${input?.value ?? legacyValue}%`; }
  reportDate(value: string, report = this.latestReport): string { if (!Number.isFinite(new Date(value).getTime())) return 'Not recorded'; return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: report?.meta.provenance?.timezone || 'UTC' }).format(new Date(value)); }
  downloadPdf(): void {
    const saved = this.latestReport; if (!saved || this.isExporting) return;
    this.isExporting = true; this.actionMessage = '';
    this.reportService.downloadPdf(saved).pipe(takeUntil(this.destroyed), finalize(() => { this.isExporting = false; this.cdr.markForCheck(); })).subscribe({ next: (blob) => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `weekly-report-${saved._id}-v${saved.meta.version || 1}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); this.actionMessage = 'PDF downloaded from the saved snapshot.'; this.cdr.markForCheck(); }, error: () => { this.errorMessage = 'The saved PDF could not be downloaded. Please retry.'; this.cdr.markForCheck(); } });
  }
  resendEmail(): void {
    const saved = this.latestReport; if (!saved || this.isResending) return;
    this.isResending = true; this.actionMessage = '';
    this.reportService.resendEmail(saved).pipe(takeUntil(this.destroyed), finalize(() => { this.isResending = false; this.cdr.markForCheck(); })).subscribe({ next: () => { this.actionMessage = 'Email send accepted. Inbox delivery is not guaranteed.'; this.cdr.markForCheck(); }, error: (error) => { this.errorMessage = error?.error?.message || 'Email could not be resent. Please retry later.'; this.cdr.markForCheck(); } });
  }

  getReadinessScore(report: WeeklyReport | null): number {
    return Math.max(0, Math.min(100, Number(report?.predictedHiringReadiness?.score || 0)));
  }

  getReadinessTone(score: number): string {
    if (score >= 80) return 'Strong';
    if (score >= 65) return 'Promising';
    return 'Needs Focus';
  }

  getReadinessClass(score: number): string {
    if (score >= 80) return 'high';
    if (score >= 65) return 'medium';
    return 'low';
  }

  getRiskArea(report: WeeklyReport | null): string {
    return String(report?.biggestRiskArea || '').trim();
  }

  deltaClass(value: number): string {
    if (value > 0) return 'delta delta--up';
    if (value < 0) return 'delta delta--down';
    return 'delta';
  }

  formatDelta(value: number, suffix = 'pts'): string {
    const numeric = Number(value || 0);
    if (!this.comparisonAvailable) return 'No comparable week';
    if (!Number.isFinite(numeric) || numeric === 0) return `0 ${suffix}`;
    return `${numeric > 0 ? '+' : ''}${Math.round(numeric)} ${suffix}`;
  }

  sourceTone(status: WeeklyReportDataSourceStatus): string {
    if (!this.isSourceAvailable(status)) return 'source-card source-card--unavailable';
    if (status?.freshness === 'stale') return 'source-card source-card--warning';
    if (status?.status.toLowerCase().includes('failed')) return 'source-card source-card--warning';
    return 'source-card source-card--live';
  }

  statusBadgeClass(status: string): string {
    if (status === 'sent') return 'status-badge status-badge--sent';
    if (status === 'failed') return 'status-badge status-badge--failed';
    return 'status-badge status-badge--skipped';
  }

  sourceFreshness(status: WeeklyReportDataSourceStatus): string {
    if (!status?.lastAnalyzedAt) return '';
    const parsed = new Date(status.lastAnalyzedAt);
    if (Number.isNaN(parsed.getTime())) return '';
    const reference = this.latestReport?.meta.provenance?.assessedAt || this.latestReport?.updatedAt || this.latestReport?.weekEndDate;
    const ageMs = (reference ? new Date(reference).getTime() : Date.now()) - parsed.getTime();
    const days = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
    if (days === 0) return 'Evidence current at assessment';
    if (days === 1) return '1 day old at assessment';
    return `${days} days old at assessment`;
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  }

  selectReport(report: WeeklyReport): void {
    this.latestReport = report;
    this.isHistoryOpen = false;
    this.cdr.markForCheck();
  }

  toggleHistory(): void {
    this.isHistoryOpen = !this.isHistoryOpen;
  }

  hasText(values: string[] | null | undefined): boolean {
    return Array.isArray(values) && values.some((value) => Boolean(String(value || '').trim()));
  }

  private isSourceAvailable(status: WeeklyReportDataSourceStatus | null | undefined): boolean {
    if (!status || !status.status || status.status.toLowerCase() === 'unavailable') return false;
    return (
      status.connected === true ||
      status.analyzed === true ||
      status.available === true ||
      Boolean(status.lastAnalyzedAt)
    );
  }
  trackByReportId(_: number, report: WeeklyReport): string {
    return report._id;
  }

  trackByLabel(_: number, item: { label: string }): string {
    return item.label;
  }

  private mergeHistory(report: WeeklyReport): WeeklyReport[] {
    const merged = [report, ...this.history.filter((entry) => entry._id !== report._id)];
    return merged
      .sort(
        (left, right) =>
          new Date(right.weekEndDate).getTime() - new Date(left.weekEndDate).getTime(),
      )
      .slice(0, 6);
  }
}
