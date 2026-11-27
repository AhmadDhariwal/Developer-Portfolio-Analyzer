import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Observable, Subscription, forkJoin, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

import { ThemeService } from '../../../../shared/services/theme.service';

import {
  AdminDeveloper,
  AdminHiringService,
  AdminOverview,
  AdminRecruiter,
} from '../../services/admin-hiring.service';
import { AdminConsoleService, ConsolePreferences } from '../admin-console/admin-console.service';
import {
  AdminPerformanceService,
  PerformanceData,
  RecruiterMetric,
  TeamMetric,
} from '../admin-performance/admin-performance.service';

type DetailView = 'team' | 'recruiter' | 'developer' | '';

@Component({
  selector: 'app-admin-dashboard-page',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss'],
})
export class AdminDashboardPageComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('teamActivityChart') private teamActivityChartRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('recruiterPerformanceChart')
  private recruiterPerformanceChartRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('hiringFunnelChart') private hiringFunnelChartRef?: ElementRef<HTMLCanvasElement>;

  loading = false;
  refreshing = false;
  initialized = false;
  analyticsLoadFailed = false;
  error = '';

  overview: AdminOverview = {
    organizationId: '',
    recruitersCount: 0,
    jobsCount: 0,
    globalDevelopersCount: 0,
    pendingInvitationsCount: 0,
    activeTeamsCount: 0,
    recentActivityCount: 0,
    recentActivity: [],
  };

  preferences: ConsolePreferences | null = null;
  performance: PerformanceData | null = null;
  recruiters: AdminRecruiter[] = [];
  developers: AdminDeveloper[] = [];

  selectedDays = 30;
  selectedTeamId = '';
  selectedRecruiterId = '';
  selectedStack = '';
  selectedJobStatus = '';
  readonly dayOptions = [7, 14, 30, 60, 90];

  detailView: DetailView = '';
  selectedTeam: TeamMetric | null = null;
  selectedRecruiterMetric: RecruiterMetric | null = null;
  selectedDeveloper: AdminDeveloper | null = null;

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private configApplied = false;
  private dashboardLoading = false;
  private performanceRequest?: Subscription;
  private chartsNeedRender = false;
  private teamChart: Chart | null = null;
  private recruiterChart: Chart | null = null;
  private funnelChart: Chart | null = null;

  constructor(
    private readonly adminService: AdminHiringService,
    private readonly consoleService: AdminConsoleService,
    private readonly performanceService: AdminPerformanceService,
    private readonly router: Router,
  ) {
    Chart.register(...registerables);
    const theme = inject(ThemeService);
    effect(() => {
      theme.activeTheme();
      this.chartsNeedRender = true;
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.loadDashboard();
  }

  ngAfterViewChecked(): void {
    if (this.chartsNeedRender) {
      this.chartsNeedRender = false;
      this.renderCharts();
    }
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  get dashboardConfig(): Required<
    NonNullable<ConsolePreferences['organization']['dashboardConfig']>
  > {
    const config = this.preferences?.organization?.dashboardConfig;
    return {
      preferredDateRangeDays: config?.preferredDateRangeDays || 30,
      defaultTeamId: config?.defaultTeamId || '',
      showKpiCards: config?.showKpiCards !== false,
      showTeamAnalytics: config?.showTeamAnalytics !== false,
      showRecruiterPerformance: config?.showRecruiterPerformance !== false,
      showJobTrends: config?.showJobTrends !== false,
      showActivityFeed: config?.showActivityFeed !== false,
    };
  }

  get orgName(): string {
    return this.preferences?.organization?.name || 'Organization';
  }

  get organizationPerformanceScore(): number {
    return Number(this.performance?.summary?.organizationPerformanceScore || 0);
  }

  get showInitialSkeleton(): boolean {
    return this.loading && !this.initialized;
  }

  get showRefreshState(): boolean {
    return this.refreshing;
  }

  get hasPerformanceData(): boolean {
    return Boolean(
      this.performance &&
      (this.performance.teamMetrics.length ||
        this.performance.recruiterMetrics.length ||
        this.performance.hiringAnalytics.total ||
        this.hasHiringFunnelData ||
        this.performance.candidateAnalytics?.candidatesAnalyzed ||
        this.recentActivityFeed.length),
    );
  }

  get recentActivityFeed(): Array<{
    _id: string;
    action: string;
    method?: string;
    route?: string;
    statusCode: number;
    timestamp: string;
    actorName: string;
  }> {
    return this.performance?.recentActivity ?? this.overview.recentActivity;
  }

  get hasHiringFunnelData(): boolean {
    return this.hiringFunnelValues.some((value) => value > 0);
  }

  private get hiringFunnelValues(): number[] {
    const hiring = this.performance?.hiringAnalytics;
    return [hiring?.open, hiring?.draft, hiring?.closed, hiring?.invitationFunnel?.accepted].map(
      (value) => this.chartValue(value),
    );
  }

  get topTeams(): TeamMetric[] {
    return [...(this.performance?.teamMetrics || [])]
      .sort(
        (a, b) =>
          Number(b.performanceScore || b.engagementScore || 0) -
          Number(a.performanceScore || a.engagementScore || 0),
      )
      .slice(0, 4);
  }

  get lowActivityTeams(): TeamMetric[] {
    return [...(this.performance?.teamMetrics || [])]
      .sort((a, b) => Number(a.engagementScore || 0) - Number(b.engagementScore || 0))
      .slice(0, 4);
  }

  get recruiterHighlights(): RecruiterMetric[] {
    return (this.performance?.recruiterMetrics || []).slice(0, 6);
  }

  get recentPublicDevelopers(): AdminDeveloper[] {
    return this.developers.slice(0, 4);
  }

  get focusTeam(): TeamMetric | null {
    if (!this.performance?.teamMetrics?.length) {
      return null;
    }
    return (
      this.performance.teamMetrics.find((team) => team._id === this.selectedTeamId) ||
      this.performance.teamMetrics[0]
    );
  }

  get focusRecruiterMetric(): RecruiterMetric | null {
    if (!this.performance?.recruiterMetrics?.length) {
      return null;
    }
    return (
      this.performance.recruiterMetrics.find(
        (recruiter) => recruiter._id === this.selectedRecruiterId,
      ) || this.performance.recruiterMetrics[0]
    );
  }

  get monthlyTrendChartItems(): Array<{ label: string; value: number }> {
    return (this.performance?.hiringAnalytics?.monthlyTrend || []).map((item) => ({
      label: item.label,
      value: Number(item.count || 0),
    }));
  }

  get hiringFunnelTotal(): number {
    return this.hiringFunnelValues.reduce((sum, value) => sum + Number(value || 0), 0);
  }

  get hiringFunnelLegend(): Array<{ label: string; value: number; color: string }> {
    const values = this.hiringFunnelValues;
    const labels = ['Open Jobs', 'Draft Jobs', 'Closed Jobs', 'Accepted Invites'];
    const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b'];
    return labels.map((label, idx) => ({
      label,
      value: values[idx] || 0,
      color: colors[idx],
    }));
  }

  loadDashboard(): void {
    if (this.dashboardLoading) return;

    this.performanceRequest?.unsubscribe();
    this.dashboardLoading = true;
    this.loading = true;
    this.refreshing = this.initialized;
    this.error = '';
    this.cdr.markForCheck();

    forkJoin({
      overview: this.adminService.getOverview(),
      preferences: this.consoleService.getPreferences(),
      recruiters: this.adminService.getRecruiters(),
      developers: this.adminService.getDevelopers({
        page: 1,
        limit: 4,
        sortBy: 'lastAnalyzedAt',
        sortOrder: 'desc',
      }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ overview, preferences, recruiters, developers }) => {
          this.dashboardLoading = false;
          this.overview = overview;
          this.preferences = preferences;
          this.recruiters = recruiters;
          this.developers = developers.developers || [];

          if (!this.configApplied) {
            this.selectedDays = this.dashboardConfig.preferredDateRangeDays || 30;
            this.selectedTeamId = this.dashboardConfig.defaultTeamId || '';
            this.configApplied = true;
          }

          this.loadPerformance();
        },
        error: () => {
          this.dashboardLoading = false;
          this.handleLoadError('Failed to load organization dashboard.');
        },
      });
  }

  loadPerformance(): void {
    if (this.dashboardLoading) return;

    this.performanceRequest?.unsubscribe();
    this.loading = true;
    this.refreshing = this.initialized;
    this.error = '';
    this.cdr.markForCheck();
    this.performanceRequest = this.fetchPerformance()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.loading = false;
          this.refreshing = false;
          this.initialized = true;
          this.analyticsLoadFailed = false;
          this.performance = data;
          this.chartsNeedRender = true;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.handleLoadError(err?.error?.message || 'Failed to load organization analytics.');
        },
      });
  }

  private fetchPerformance(): Observable<PerformanceData> {
    return this.performanceService
      .getPerformance(this.selectedDays, {
        teamId: this.selectedTeamId || undefined,
        recruiterId: this.selectedRecruiterId || undefined,
        stack: this.selectedStack || undefined,
        jobStatus: this.selectedJobStatus || undefined,
      })
      .pipe(
        switchMap((data) =>
          this.normalizeSelectedFilters(data) ? this.fetchPerformance() : of(data),
        ),
      );
  }

  private handleLoadError(message: string): void {
    this.error = message;
    this.loading = false;
    this.refreshing = false;
    this.analyticsLoadFailed = true;
    this.chartsNeedRender = true;
    this.closeDetail();
    this.cdr.markForCheck();
  }

  onTeamChange(): void {
    this.selectedRecruiterId = '';
    this.loadPerformance();
  }

  onRecruiterChange(): void {
    this.loadPerformance();
  }

  onStackChange(): void {
    this.loadPerformance();
  }

  onJobStatusChange(): void {
    this.loadPerformance();
  }

  onDaysChange(): void {
    this.loadPerformance();
  }

  resetFilters(): void {
    this.selectedDays = this.dashboardConfig.preferredDateRangeDays || 30;
    this.selectedTeamId = this.dashboardConfig.defaultTeamId || '';
    this.selectedRecruiterId = '';
    this.selectedStack = '';
    this.selectedJobStatus = '';
    this.loadPerformance();
  }

  refreshAll(): void {
    this.loadDashboard();
  }

  openTeamsView(): void {
    this.router.navigate(['/app/admin/teams']);
  }

  openRecruitersView(): void {
    this.router.navigate(['/app/admin/recruiters']);
  }

  openJobsView(): void {
    this.router.navigate(['/app/admin/jobs']);
  }

  openDevelopersView(): void {
    this.router.navigate(['/app/admin/developers']);
  }

  openActivityView(): void {
    this.router.navigate(['/app/admin/activity-logs']);
  }

  openPerformanceView(): void {
    this.router.navigate(['/app/admin/console/performance-statistics']);
  }

  applyStackFilter(stack: string): void {
    if (!stack || this.selectedStack === stack) {
      return;
    }
    this.selectedStack = stack;
    this.loadPerformance();
  }

  openTrendDetail(_label: string): void {
    this.openPerformanceView();
  }

  openTopTeam(): void {
    if (this.focusTeam) {
      this.openTeamDetail(this.focusTeam);
    } else {
      this.openTeamsView();
    }
  }

  openTeamDetail(team: TeamMetric): void {
    this.selectedTeam = team;
    this.selectedRecruiterMetric = null;
    this.selectedDeveloper = null;
    this.detailView = 'team';
  }

  openRecruiterDetail(metric: RecruiterMetric): void {
    this.selectedRecruiterMetric = metric;
    this.selectedTeam = null;
    this.selectedDeveloper = null;
    this.detailView = 'recruiter';
  }

  openDeveloperDetail(developer: AdminDeveloper): void {
    this.selectedDeveloper = developer;
    this.selectedTeam = null;
    this.selectedRecruiterMetric = null;
    this.detailView = 'developer';
  }

  closeDetail(): void {
    this.detailView = '';
    this.selectedTeam = null;
    this.selectedRecruiterMetric = null;
    this.selectedDeveloper = null;
  }

  teamRecruiters(team: TeamMetric | null): AdminRecruiter[] {
    if (!team) {
      return [];
    }
    return this.recruiters.filter((recruiter) =>
      (recruiter.teams || []).some((assigned) => assigned._id === team._id),
    );
  }

  recruiterProfile(metric: RecruiterMetric | null): AdminRecruiter | null {
    if (!metric) {
      return null;
    }
    return this.recruiters.find((recruiter) => recruiter._id === metric._id) || null;
  }

  hasExternalLink(value?: string | null): boolean {
    return !!String(value || '').trim();
  }

  scorePct(value: number, max = 100): number {
    const safeValue = Number(value || 0);
    return Math.max(0, Math.min(max, safeValue));
  }

  barPct(value: number, max: number): number {
    return max > 0 ? Math.round((Number(value || 0) / max) * 100) : 0;
  }

  maxValue(values: number[]): number {
    return Math.max(1, ...values.map((value) => Number(value || 0)));
  }

  maxTeamCandidates(): number {
    return this.maxValue(
      (this.performance?.teamMetrics || []).map((team) => team.candidatesAnalyzed || 0),
    );
  }

  maxTeamAiUsage(): number {
    return this.maxValue((this.performance?.teamMetrics || []).map((team) => team.aiUsage || 0));
  }

  maxMonthlyTrend(): number {
    return this.maxValue(
      (this.performance?.hiringAnalytics?.monthlyTrend || []).map((item) => item.count),
    );
  }

  maxStackDistribution(): number {
    return this.maxValue(
      (this.performance?.hiringAnalytics?.stackDistribution || []).map((item) => item.count),
    );
  }

  leaderboardTooltip(team: TeamMetric): string {
    return `${team.name}: ${team.totalJobs} jobs, ${team.candidatesAnalyzed || 0} candidates, score ${team.performanceScore || team.engagementScore}`;
  }

  formatActivityAction(action?: string, route?: string): string {
    const raw = String(action || route || 'Activity').trim();
    if (!raw) {
      return 'Activity';
    }

    if (raw.startsWith('/api/')) {
      return raw
        .split('/')
        .filter(Boolean)
        .slice(-2)
        .join(' ')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    return raw
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  shortStatusLabel(code: number): string {
    if (code >= 400) {
      return `Error ${code}`;
    }
    if (code >= 200) {
      return `OK ${code}`;
    }
    return String(code || '');
  }

  trackByActivityId(_: number, activity: { _id: string }): string {
    return activity._id;
  }

  trackByTeamId(_: number, team: TeamMetric): string {
    return team._id;
  }

  trackByRecruiterId(_: number, recruiter: RecruiterMetric): string {
    return recruiter._id;
  }

  trackByDeveloperId(_: number, developer: AdminDeveloper): string {
    return developer._id;
  }

  private normalizeSelectedFilters(data: PerformanceData): boolean {
    let changed = false;

    if (
      this.selectedTeamId &&
      !data.filters.teams.some((team) => team._id === this.selectedTeamId)
    ) {
      this.selectedTeamId = '';
      changed = true;
    }

    if (
      this.selectedRecruiterId &&
      !data.filters.recruiters.some((recruiter) => recruiter._id === this.selectedRecruiterId)
    ) {
      this.selectedRecruiterId = '';
      changed = true;
    }

    if (this.selectedStack && !data.filters.stacks.includes(this.selectedStack)) {
      this.selectedStack = '';
      changed = true;
    }

    if (
      this.selectedJobStatus &&
      !(data.filters.jobStatuses || []).includes(this.selectedJobStatus)
    ) {
      this.selectedJobStatus = '';
      changed = true;
    }

    return changed;
  }

  private renderCharts(): void {
    this.destroyCharts();
    if (!this.performance || this.analyticsLoadFailed) {
      return;
    }

    this.renderTeamActivityChart();
    this.renderRecruiterPerformanceChart();
    this.renderHiringFunnelChart();
  }

  private renderTeamActivityChart(): void {
    const canvas = this.teamActivityChartRef?.nativeElement;
    if (
      !canvas ||
      !this.performance?.teamMetrics.length ||
      typeof canvas.getContext !== 'function' ||
      !canvas.getContext('2d')
    ) {
      return;
    }

    const teams = this.performance.teamMetrics.slice(0, 8);
    const config: ChartConfiguration<'bar' | 'line'> = {
      type: 'bar',
      data: {
        labels: teams.map((team) => team.name),
        datasets: [
          {
            type: 'bar',
            label: 'Engagement Score',
            data: teams.map((team) => this.chartValue(team.engagementScore)),
            backgroundColor: '#4f46e5',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 28,
          },
          {
            type: 'line',
            label: 'Candidates Analyzed',
            data: teams.map((team) => this.chartValue(team.candidatesAnalyzed)),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.14)',
            tension: 0.36,
            borderWidth: 2.5,
            fill: true,
            pointRadius: 3.5,
            pointHoverRadius: 5,
            pointBackgroundColor: '#10b981',
            yAxisID: 'y1',
          },
        ],
      },
      options: this.buildChartOptions({
        leftTitle: 'Score',
        rightTitle: 'Candidates',
      }),
    };

    this.teamChart = new Chart(canvas, config);
  }

  private renderRecruiterPerformanceChart(): void {
    const canvas = this.recruiterPerformanceChartRef?.nativeElement;
    if (
      !canvas ||
      !this.performance?.recruiterMetrics.length ||
      typeof canvas.getContext !== 'function' ||
      !canvas.getContext('2d')
    ) {
      return;
    }

    const recruiters = this.performance.recruiterMetrics.slice(0, 8);
    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: recruiters.map((recruiter) => recruiter.name),
        datasets: [
          {
            label: 'Jobs',
            data: recruiters.map((recruiter) => this.chartValue(recruiter.totalJobs)),
            backgroundColor: '#4f46e5',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22,
          },
          {
            label: 'Matches',
            data: recruiters.map((recruiter) => this.chartValue(recruiter.matchesGenerated)),
            backgroundColor: '#10b981',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22,
          },
          {
            label: 'AI Calls',
            data: recruiters.map((recruiter) => this.chartValue(recruiter.totalAnalyses)),
            backgroundColor: '#0ea5e9',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22,
          },
        ],
      },
      options: this.buildChartOptions(),
    };

    this.recruiterChart = new Chart(canvas, config);
  }

  private renderHiringFunnelChart(): void {
    const canvas = this.hiringFunnelChartRef?.nativeElement;
    const values = this.hiringFunnelValues;
    if (
      !canvas ||
      !values.some((value) => value > 0) ||
      typeof canvas.getContext !== 'function' ||
      !canvas.getContext('2d')
    ) {
      return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: ['Open Jobs', 'Draft Jobs', 'Closed Jobs', 'Accepted Invites'],
        datasets: [
          {
            data: values,
            backgroundColor: ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b'],
            borderColor: this.chartToken('--surface-card') || (isDark ? '#141720' : '#ffffff'),
            borderWidth: 2,
            borderRadius: 4,
            spacing: 2,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#0f172a',
            borderColor: isDark ? 'rgba(148, 163, 184, 0.28)' : 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
          },
        },
      },
    };

    this.funnelChart = new Chart(canvas, config);
  }

  private buildChartOptions(axisTitles?: {
    leftTitle?: string;
    rightTitle?: string;
  }): ChartConfiguration<'bar' | 'line'>['options'] {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(203, 213, 225, 0.55)';
    return {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: this.chartToken('--chart-label') || '#64748b',
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8,
            padding: 14,
            font: { size: 11.5, weight: 500 },
          },
        },
        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#0f172a',
          borderColor: isDark ? 'rgba(148, 163, 184, 0.28)' : 'rgba(255, 255, 255, 0.12)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
        },
      },
      scales: {
        x: {
          ticks: {
            color: this.chartToken('--chart-tick') || '#64748b',
            font: { size: 11 },
          },
          border: { display: false },
          grid: {
            display: false,
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            color: this.chartToken('--chart-tick') || '#64748b',
            font: { size: 11 },
          },
          border: { display: false },
          title: axisTitles?.leftTitle
            ? {
                display: true,
                text: axisTitles.leftTitle,
                color: this.chartToken('--chart-tick') || '#64748b',
                font: { size: 11, weight: 600 },
              }
            : undefined,
          grid: {
            color: gridColor,
          },
        },
        ...(axisTitles?.rightTitle && {
          y1: {
            axis: 'y',
            type: 'linear',
            beginAtZero: true,
            position: 'right',
            border: { display: false },
            ticks: {
              precision: 0,
              color: this.chartToken('--chart-tick') || '#64748b',
              font: { size: 11 },
            },
            title: {
              display: true,
              text: axisTitles.rightTitle,
              color: this.chartToken('--chart-tick') || '#64748b',
              font: { size: 11, weight: 600 },
            },
            grid: {
              drawOnChartArea: false,
            },
          },
        }),
      },
    };
  }

  private chartToken(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  private chartValue(value?: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  private destroyCharts(): void {
    this.teamChart?.destroy();
    this.recruiterChart?.destroy();
    this.funnelChart?.destroy();
    this.teamChart = null;
    this.recruiterChart = null;
    this.funnelChart = null;
  }
}
