import { ActivatedRoute } from '@angular/router';
import { Subject, finalize, takeUntil } from 'rxjs';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy,
  Optional,
  Inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  WeeklyReport,
  WeeklyReportDataSourceStatus,
  WeeklyReportService,
} from '../../shared/services/weekly-report.service';
import * as presentation from './weekly-reports-presentation';
import { WeeklyReportActionsComponent } from './components/weekly-report-actions/weekly-report-actions.component';
import { WeeklyReportOverviewComponent } from './components/weekly-report-overview/weekly-report-overview.component';
import { WeeklyReportMomentumTrendComponent } from './components/weekly-report-momentum-trend/weekly-report-momentum-trend.component';
import { WeeklyReportKpiGridComponent } from './components/weekly-report-kpi-grid/weekly-report-kpi-grid.component';
import { WeeklyReportScoreBreakdownComponent } from './components/weekly-report-score-breakdown/weekly-report-score-breakdown.component';
import { WeeklyReportComparisonComponent } from './components/weekly-report-comparison/weekly-report-comparison.component';
import { WeeklyReportHistoryComponent } from './components/weekly-report-history/weekly-report-history.component';
import { WeeklyReportNarrativeComponent } from './components/weekly-report-narrative/weekly-report-narrative.component';
import { WeeklyReportDataSourcesComponent } from './components/weekly-report-data-sources/weekly-report-data-sources.component';

@Component({
  selector: 'app-weekly-reports',
  standalone: true,
  imports: [
    CommonModule,
    WeeklyReportActionsComponent,
    WeeklyReportOverviewComponent,
    WeeklyReportMomentumTrendComponent,
    WeeklyReportKpiGridComponent,
    WeeklyReportScoreBreakdownComponent,
    WeeklyReportComparisonComponent,
    WeeklyReportHistoryComponent,
    WeeklyReportNarrativeComponent,
    WeeklyReportDataSourcesComponent,
  ],
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
    return presentation.buildDataSources(this.latestReport);
  }

  get scoreBreakdown(): presentation.ScoreBreakdownItem[] {
    return presentation.buildScoreBreakdown(this.latestReport);
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
            this.reportService
              .getReport(id, version)
              .pipe(takeUntil(this.destroyed))
              .subscribe({
                next: (saved) => {
                  this.latestReport = saved;
                  this.cdr.markForCheck();
                },
                error: (error) => {
                  this.errorMessage =
                    error?.error?.message || 'Saved report version could not be loaded.';
                  this.cdr.markForCheck();
                },
              });
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

    const request =
      refresh && this.latestReport
        ? this.reportService.refreshReport(this.latestReport)
        : this.reportService.generateReport(false);
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

  get isArchivedVersion(): boolean {
    const selected = this.latestReport;
    const current = this.history.find((item) => item._id === selected?._id);
    return !!current && current.meta.reportHash !== selected?.meta.reportHash;
  }

  get isCurrentWeek(): boolean {
    const report = this.latestReport;
    const now = Date.now();
    return (
      !!report &&
      new Date(report.weekStartDate).getTime() <= now &&
      now <= new Date(report.weekEndDate).getTime()
    );
  }

  get comparisonAvailable(): boolean {
    return this.latestReport?.meta.comparison?.available === true;
  }

  overallLabel(report: WeeklyReport): string {
    return presentation.overallLabel(report);
  }

  metricLabel(key: string, legacyValue: number): string {
    return presentation.metricLabel(key, legacyValue, this.latestReport);
  }

  sprintMetricLabel(report: WeeklyReport): string {
    return presentation.sprintMetricLabel(report);
  }

  interviewActivityLabel(report: WeeklyReport): string {
    return presentation.interviewActivityLabel(report);
  }

  reportDate(value: string, report = this.latestReport): string {
    return presentation.reportDate(value, report);
  }

  downloadPdf(): void {
    const saved = this.latestReport;
    if (!saved || this.isExporting) return;
    this.isExporting = true;
    this.actionMessage = '';
    this.reportService
      .downloadPdf(saved)
      .pipe(
        takeUntil(this.destroyed),
        finalize(() => {
          this.isExporting = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `weekly-report-${saved._id}-v${saved.meta.version || 1}.pdf`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          this.actionMessage = 'PDF downloaded from the saved snapshot.';
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'The saved PDF could not be downloaded. Please retry.';
          this.cdr.markForCheck();
        },
      });
  }

  resendEmail(): void {
    const saved = this.latestReport;
    if (!saved || this.isResending) return;
    this.isResending = true;
    this.actionMessage = '';
    this.reportService
      .resendEmail(saved)
      .pipe(
        takeUntil(this.destroyed),
        finalize(() => {
          this.isResending = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: () => {
          this.actionMessage = 'Email send accepted. Inbox delivery is not guaranteed.';
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage =
            error?.error?.message || 'Email could not be resent. Please retry later.';
          this.cdr.markForCheck();
        },
      });
  }

  getReadinessScore(report: WeeklyReport | null): number {
    return presentation.getReadinessScore(report);
  }

  getReadinessTone(score: number): string {
    return presentation.getReadinessTone(score);
  }

  getReadinessClass(score: number): string {
    return presentation.getReadinessClass(score);
  }

  getRiskArea(report: WeeklyReport | null): string {
    return presentation.getRiskArea(report);
  }

  deltaClass(value: number): string {
    return presentation.deltaClass(value);
  }

  formatDelta(value: number, suffix = 'pts'): string {
    return presentation.formatDelta(value, this.comparisonAvailable, suffix);
  }

  sourceTone(status: WeeklyReportDataSourceStatus): string {
    return presentation.sourceTone(status);
  }

  statusBadgeClass(status: string): string {
    return presentation.statusBadgeClass(status);
  }

  sourceFreshness(status: WeeklyReportDataSourceStatus): string {
    return presentation.sourceFreshness(status, this.latestReport);
  }

  formatDate(value: string | null | undefined): string {
    return presentation.formatDate(value);
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
    return presentation.hasText(values);
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
