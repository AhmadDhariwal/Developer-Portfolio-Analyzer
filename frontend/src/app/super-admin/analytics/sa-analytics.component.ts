import { AfterViewInit, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Chart, registerables } from 'chart.js';
import { SuperAdminService } from '../shared/super-admin.service';
import { ChartContainerComponent } from '../../shared/components/chart-container/chart-container.component';

Chart.register(...registerables);

type AnalyticsFilters = {
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  stack: string;
  role: string;
};

@Component({
  selector: 'app-sa-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, ChartContainerComponent],
  templateUrl: './sa-analytics.component.html',
  styleUrls: ['./sa-analytics.component.scss']
})
export class SaAnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('platformChart') platformChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('aiUsageChart') aiUsageChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('recruiterChart') recruiterChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('orgChart') orgChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('developerChart') developerChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('systemChart') systemChartRef!: ElementRef<HTMLCanvasElement>;

  loading = true;
  error = '';
  organizations: any[] = [];
  data: any = {};

  filters: AnalyticsFilters = this.createDefaultFilters();

  readonly stacks = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
  readonly roles = [
    { value: '', label: 'All roles' },
    { value: 'admin', label: 'Admin' },
    { value: 'recruiter', label: 'Recruiter' },
    { value: 'developer', label: 'Developer' }
  ];

  private charts: Chart[] = [];
  private viewReady = false;
  private dataReady = false;

  constructor(
    private readonly sa: SuperAdminService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.loadOrganizations();
    this.loadAnalytics();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.dataReady) {
      queueMicrotask(() => this.renderCharts());
    }
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  loadAnalytics(): void {
    this.loading = true;
    this.error = '';

    this.sa.getAnalytics(this.requestParams()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.data = res || {};
        this.loading = false;
        this.dataReady = true;
        queueMicrotask(() => {
          try { this.cdr.detectChanges(); } catch {}
          if (this.viewReady) this.renderCharts();
        });
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load analytics right now.';
        queueMicrotask(() => {
          try { this.cdr.detectChanges(); } catch {}
        });
      }
    });
  }

  applyFilters(): void {
    this.loadAnalytics();
  }

  resetFilters(): void {
    this.filters = this.createDefaultFilters();
    this.loadAnalytics();
  }

  get platformCards() {
    const summary = this.data?.summary?.platformOverview || {};
    return [
      { label: 'Total organizations', value: summary.totalOrganizations ?? 0, trend: summary.platformGrowthPct ?? 0, tone: 'blue' },
      { label: 'Total admins', value: summary.totalAdmins ?? 0, trend: 0, tone: 'purple' },
      { label: 'Total recruiters', value: summary.totalRecruiters ?? 0, trend: 0, tone: 'green' },
      { label: 'Total developers', value: summary.totalDevelopers ?? 0, trend: 0, tone: 'orange' },
      { label: 'Active users', value: summary.activeUsers ?? 0, trend: 0, tone: 'teal' },
      { label: 'Platform growth %', value: `${summary.platformGrowthPct ?? 0}%`, trend: summary.platformGrowthPct ?? 0, tone: (summary.platformGrowthPct ?? 0) >= 0 ? 'indigo' : 'red' }
    ];
  }

  get aiCards() {
    const summary = this.data?.summary?.aiUsage || {};
    return [
      { label: 'GitHub analyses', value: summary.githubAnalyses ?? 0, trend: summary.githubTrendPct ?? 0, tone: 'blue' },
      { label: 'Resume analyses', value: summary.resumeAnalyses ?? 0, trend: summary.resumeTrendPct ?? 0, tone: 'green' },
      { label: 'AI recommendations', value: summary.recommendationsGenerated ?? 0, trend: summary.recommendationTrendPct ?? 0, tone: 'purple' }
    ];
  }

  get recruiterCards() {
    const summary = this.data?.summary?.recruiterPerformance || {};
    return [
      { label: 'Active recruiters', value: summary.activeRecruiters ?? 0, trend: summary.trendPct ?? 0, tone: 'green' },
      { label: 'Candidates analyzed', value: summary.candidatesAnalyzed ?? 0, trend: summary.trendPct ?? 0, tone: 'blue' },
      { label: 'Matches generated', value: summary.matchesGenerated ?? 0, trend: summary.trendPct ?? 0, tone: 'purple' },
      { label: 'Hiring success %', value: `${summary.hiringSuccessPct ?? 0}%`, trend: summary.hiringSuccessPct ?? 0, tone: 'orange' }
    ];
  }

  get organizationCards() {
    const summary = this.data?.summary?.organizationPerformance || {};
    return [
      { label: 'Top organizations', value: summary.topOrganizations?.length ?? 0, trend: summary.organizationGrowthPct ?? 0, tone: 'indigo' },
      { label: 'Recruiter productivity', value: summary.recruiterProductivity?.length ?? 0, trend: summary.organizationGrowthPct ?? 0, tone: 'cyan' },
      { label: 'Team activity', value: summary.teamActivity ?? 0, trend: summary.organizationGrowthPct ?? 0, tone: 'green' },
      { label: 'Organization growth %', value: `${summary.organizationGrowthPct ?? 0}%`, trend: summary.organizationGrowthPct ?? 0, tone: 'blue' }
    ];
  }

  get developerCards() {
    const summary = this.data?.summary?.developerInsights || {};
    return [
      { label: 'Top stacks', value: summary.topStacks?.length ?? 0, trend: summary.githubActivityTrendPct ?? 0, tone: 'orange' },
      { label: 'Most active developers', value: summary.mostActiveDevelopers?.length ?? 0, trend: summary.githubActivityTrendPct ?? 0, tone: 'purple' },
      { label: 'GitHub activity trend', value: `${summary.githubActivityTrendPct ?? 0}%`, trend: summary.githubActivityTrendPct ?? 0, tone: 'teal' },
      { label: 'Profile completion %', value: `${summary.profileCompletionPct ?? 0}%`, trend: summary.profileCompletionPct ?? 0, tone: 'green' }
    ];
  }

  get systemCards() {
    const summary = this.data?.summary?.systemHealth || {};
    return [
      { label: 'Avg response time', value: `${summary.avgResponseTimeMs ?? 0} ms`, trend: 0, tone: 'blue' },
      { label: 'P95 response time', value: `${summary.p95ResponseTimeMs ?? 0} ms`, trend: 0, tone: 'purple' },
      { label: 'Failed requests', value: summary.failedRequests ?? 0, trend: 0, tone: 'red' },
      { label: 'Error rate', value: `${summary.errorRatePct ?? 0}%`, trend: 0, tone: 'orange' },
      { label: 'Server uptime', value: `${summary.serverUptimeHours ?? 0} hrs`, trend: 0, tone: 'teal' },
      { label: 'Total requests', value: summary.totalRequests ?? 0, trend: 0, tone: 'indigo' }
    ];
  }

  get topOrganizations() {
    return this.data?.summary?.organizationPerformance?.topOrganizations || [];
  }

  get topStacks() {
    return this.data?.summary?.developerInsights?.topStacks || [];
  }

  get mostActiveDevelopers() {
    return this.data?.summary?.developerInsights?.mostActiveDevelopers || [];
  }

  get chartSummary() {
    return this.data?.charts || {};
  }

  get trendDirection(): Record<string, 'up' | 'down' | 'flat'> {
    return {
      platform: this.trendState(this.data?.summary?.platformOverview?.platformGrowthPct),
      ai: this.trendState(this.data?.summary?.aiUsage?.githubTrendPct),
      recruiter: this.trendState(this.data?.summary?.recruiterPerformance?.trendPct),
      org: this.trendState(this.data?.summary?.organizationPerformance?.organizationGrowthPct),
      dev: this.trendState(this.data?.summary?.developerInsights?.githubActivityTrendPct)
    };
  }

  private requestParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.filters.organizationId) params['organizationId'] = this.filters.organizationId;
    if (this.filters.dateFrom) params['dateFrom'] = this.filters.dateFrom;
    if (this.filters.dateTo) params['dateTo'] = this.filters.dateTo;
    if (this.filters.stack) params['stack'] = this.filters.stack;
    if (this.filters.role) params['role'] = this.filters.role;
    return params;
  }

  private loadOrganizations(): void {
    this.sa.getOrganizations({ page: '1', limit: '100' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.organizations = res?.organizations || [];
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  private renderCharts(): void {
    this.destroyCharts();
    const charts = this.chartSummary;

    if (this.platformChartRef?.nativeElement && charts.aiUsageMonthly) {
      this.charts.push(new Chart(this.platformChartRef.nativeElement, {
        type: 'line',
        data: {
          labels: charts.aiUsageMonthly.labels || [],
          datasets: [
            this.lineDataset('GitHub analyses', charts.aiUsageMonthly.githubAnalyses || [], '#38bdf8'),
            this.lineDataset('Resume analyses', charts.aiUsageMonthly.resumeAnalyses || [], '#22c55e'),
            this.lineDataset('Recommendations', charts.aiUsageMonthly.recommendations || [], '#a855f7')
          ]
        },
        options: this.lineOptions()
      }));
    }

    if (this.aiUsageChartRef?.nativeElement && charts.aiUsageDaily) {
      this.charts.push(new Chart(this.aiUsageChartRef.nativeElement, {
        type: 'bar',
        data: {
          labels: charts.aiUsageDaily.labels || [],
          datasets: [
            this.barDataset('GitHub analyses', charts.aiUsageDaily.githubAnalyses || [], '#38bdf8'),
            this.barDataset('Resume analyses', charts.aiUsageDaily.resumeAnalyses || [], '#22c55e'),
            this.barDataset('Recommendations', charts.aiUsageDaily.recommendations || [], '#a855f7')
          ]
        },
        options: this.barOptions(true)
      }));
    }

    if (this.recruiterChartRef?.nativeElement && this.data?.summary?.recruiterPerformance) {
      const recruiter = this.data.summary.recruiterPerformance;
      this.charts.push(new Chart(this.recruiterChartRef.nativeElement, {
        type: 'bar',
        data: {
          labels: ['Active recruiters', 'Candidates analyzed', 'Matches generated'],
          datasets: [{
            label: 'Recruiter pipeline',
            data: [
              recruiter.activeRecruiters || 0,
              recruiter.candidatesAnalyzed || 0,
              recruiter.matchesGenerated || 0
            ],
            backgroundColor: ['#22c55e', '#38bdf8', '#a855f7'],
            borderRadius: 10
          }]
        },
        options: this.barOptions(false)
      }));
    }

    if (this.orgChartRef?.nativeElement && this.topOrganizations.length) {
      this.charts.push(new Chart(this.orgChartRef.nativeElement, {
        type: 'doughnut',
        data: {
          labels: this.topOrganizations.map((org: any) => org.name),
          datasets: [{
            data: this.topOrganizations.map((org: any) => org.memberCount || 0),
            backgroundColor: ['#38bdf8', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899'],
            borderWidth: 0,
            hoverOffset: 8
          }]
        },
        options: this.doughnutOptions()
      }));
    }

    if (this.developerChartRef?.nativeElement && this.topStacks.length) {
      this.charts.push(new Chart(this.developerChartRef.nativeElement, {
        type: 'line',
        data: {
          labels: this.topStacks.map((stack: any) => stack.stack),
          datasets: [{
            label: 'Stack distribution',
            data: this.topStacks.map((stack: any) => stack.count || 0),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            tension: 0.35,
            fill: true,
            pointRadius: 4
          }]
        },
        options: this.lineOptions()
      }));
    }

    if (this.systemChartRef?.nativeElement && this.data?.summary?.systemHealth) {
      const health = this.data.summary.systemHealth;
      this.charts.push(new Chart(this.systemChartRef.nativeElement, {
        type: 'line',
        data: {
          labels: ['Response', 'P95', 'Errors'],
          datasets: [
            {
              label: 'Latency / errors',
              data: [health.avgResponseTimeMs || 0, health.p95ResponseTimeMs || 0, health.errorRatePct || 0],
              borderColor: '#38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              tension: 0.35,
              fill: true
            }
          ]
        },
        options: this.lineOptions()
      }));
    }
  }

  private destroyCharts(): void {
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
  }

  private lineDataset(label: string, data: number[], color: string) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: `${color}22`,
      tension: 0.35,
      fill: true,
      pointRadius: 2
    };
  }

  private barDataset(label: string, data: number[], color: string) {
    return {
      label,
      data,
      backgroundColor: `${color}cc`,
      borderRadius: 10
    };
  }

  private lineOptions(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#cbd5e1' } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    };
  }

  private barOptions(stacked = false): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#cbd5e1' } } },
      scales: {
        x: { stacked, ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } },
        y: { stacked, beginAtZero: true, ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    };
  }

  private doughnutOptions(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#cbd5e1' } }
      }
    };
  }

  private createDefaultFilters(): AnalyticsFilters {
    const end = new Date();
    const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
    return {
      organizationId: '',
      dateFrom: start.toISOString().slice(0, 10),
      dateTo: end.toISOString().slice(0, 10),
      stack: '',
      role: ''
    };
  }

  private trendState(value: number | undefined): 'up' | 'down' | 'flat' {
    if (!Number.isFinite(Number(value))) return 'flat';
    const n = Number(value);
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return 'flat';
  }
}
