import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeeklyReport, WeeklyReportDataSourceStatus, WeeklyReportService } from '../../shared/services/weekly-report.service';

@Component({
  selector: 'app-weekly-reports',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weekly-reports.component.html',
  styleUrl: './weekly-reports.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WeeklyReportsComponent implements OnInit {
  latestReport: WeeklyReport | null = null;
  history: WeeklyReport[] = [];
  isLoading = false;
  isGenerating = false;
  errorMessage = '';

  constructor(
    private readonly reportService: WeeklyReportService,
    private readonly cdr: ChangeDetectorRef
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
      { label: 'GitHub', status: sources.github },
      { label: 'Resume', status: sources.resume },
      { label: 'Skill Gap', status: sources.skillGap },
      { label: 'Recommendations', status: sources.recommendations },
      { label: 'Career Sprint', status: sources.careerSprint },
      { label: 'Interview Prep', status: sources.interviewPrep },
      { label: 'Portfolio', status: sources.portfolio },
      { label: 'Integrations', status: sources.integrations }
    ];
  }

  loadReports(): void {
    if (this.isLoading) return;
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.reportService.getDashboard(6).subscribe({
      next: ({ latest, history }) => {
        this.latestReport = latest;
        this.history = history;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Unable to load weekly reports right now.';
        this.latestReport = null;
        this.history = [];
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  generateReport(): void {
    if (this.isGenerating) return;
    this.isGenerating = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.reportService.generateReport(true).subscribe({
      next: (report) => {
        this.latestReport = report;
        this.history = this.mergeHistory(report);
        this.isGenerating = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Unable to generate the weekly report right now.';
        this.isGenerating = false;
        this.cdr.markForCheck();
      }
    });
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
    return report?.biggestRiskArea || 'No major risk identified for this period.';
  }

  deltaClass(value: number): string {
    if (value > 0) return 'delta delta--up';
    if (value < 0) return 'delta delta--down';
    return 'delta';
  }

  formatDelta(value: number, suffix = 'pts'): string {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric === 0) return `0 ${suffix}`;
    return `${numeric > 0 ? '+' : ''}${Math.round(numeric)} ${suffix}`;
  }

  sourceTone(status: WeeklyReportDataSourceStatus): string {
    if (status?.status === 'Unavailable') return 'source-card source-card--muted';
    if (status?.status.toLowerCase().includes('failed')) return 'source-card source-card--warning';
    return 'source-card source-card--live';
  }

  statusBadgeClass(status: string): string {
    if (status === 'sent') return 'status-badge status-badge--sent';
    if (status === 'failed') return 'status-badge status-badge--failed';
    return 'status-badge status-badge--skipped';
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return 'Not available';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Not available';
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(parsed);
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
      .sort((left, right) => new Date(right.weekEndDate).getTime() - new Date(left.weekEndDate).getTime())
      .slice(0, 6);
  }
}
