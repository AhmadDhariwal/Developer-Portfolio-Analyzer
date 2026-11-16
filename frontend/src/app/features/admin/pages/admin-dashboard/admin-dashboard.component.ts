import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

import {
  AdminDeveloper,
  AdminHiringService,
  AdminOverview,
  AdminRecruiter
} from '../../services/admin-hiring.service';
import { AdminConsoleService, ConsolePreferences } from '../admin-console/admin-console.service';
import {
  AdminPerformanceService,
  PerformanceData,
  RecruiterMetric,
  TeamMetric
} from '../admin-performance/admin-performance.service';

type DetailView = 'team' | 'recruiter' | 'developer' | '';

@Component({
  selector: 'app-admin-dashboard-page',
  standalone: false,
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardPageComponent implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('teamActivityChart') private teamActivityChartRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('recruiterPerformanceChart') private recruiterPerformanceChartRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('hiringFunnelChart') private hiringFunnelChartRef?: ElementRef<HTMLCanvasElement>;

  loading = false;
  refreshing = false;
  initialized = false;
  error = '';

  overview: AdminOverview = {
    organizationId: '',
    recruitersCount: 0,
    jobsCount: 0,
    globalDevelopersCount: 0,
    pendingInvitationsCount: 0,
    activeTeamsCount: 0,
    recentActivityCount: 0,
    recentActivity: []
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

  private configApplied = false;
  private chartsNeedRender = false;
  private teamChart: Chart | null = null;
  private recruiterChart: Chart | null = null;
  private funnelChart: Chart | null = null;

  constructor(
    private readonly adminService: AdminHiringService,
    private readonly consoleService: AdminConsoleService,
    private readonly performanceService: AdminPerformanceService,
    private readonly router: Router
  ) {
    Chart.register(...registerables);
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

  get dashboardConfig(): Required<NonNullable<ConsolePreferences['organization']['dashboardConfig']>> {
    const config = this.preferences?.organization?.dashboardConfig;
    return {
      preferredDateRangeDays: config?.preferredDateRangeDays || 30,
      defaultTeamId: config?.defaultTeamId || '',
      showKpiCards: config?.showKpiCards !== false,
      showTeamAnalytics: config?.showTeamAnalytics !== false,
      showRecruiterPerformance: config?.showRecruiterPerformance !== false,
      showJobTrends: config?.showJobTrends !== false,
      showActivityFeed: config?.showActivityFeed !== false
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
    return this.refreshing && !!this.performance;
  }

  get hasPerformanceData(): boolean {
    return Boolean(this.performance && (
      this.performance.teamMetrics.length ||
      this.performance.recruiterMetrics.length ||
      this.performance.hiringAnalytics.total ||
      this.performance.candidateAnalytics?.candidatesAnalyzed ||
      this.recentActivityFeed.length
    ));
  }

  get recentActivityFeed(): Array<{ _id: string; action: string; method?: string; route?: string; statusCode: number; timestamp: string; actorName: string }> {
    if (this.performance?.recentActivity?.length) {
      return this.performance.recentActivity;
    }
    return this.overview.recentActivity;
  }

  get topTeams(): TeamMetric[] {
    return [...(this.performance?.teamMetrics || [])]
      .sort((a, b) => Number(b.performanceScore || b.engagementScore || 0) - Number(a.performanceScore || a.engagementScore || 0))
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
    return this.performance.teamMetrics.find((team) => team._id === this.selectedTeamId) || this.performance.teamMetrics[0];
  }

  get focusRecruiterMetric(): RecruiterMetric | null {
    if (!this.performance?.recruiterMetrics?.length) {
      return null;
    }
    return this.performance.recruiterMetrics.find((recruiter) => recruiter._id === this.selectedRecruiterId) || this.performance.recruiterMetrics[0];
  }

  loadDashboard(): void {
    this.loading = true;
    this.refreshing = this.initialized;
    this.error = '';

    forkJoin({
      overview: this.adminService.getOverview(),
      preferences: this.consoleService.getPreferences(),
      recruiters: this.adminService.getRecruiters(),
      developers: this.adminService.getDevelopers({ page: 1, limit: 4, sortBy: 'lastAnalyzedAt', sortOrder: 'desc' })
    }).subscribe({
      next: ({ overview, preferences, recruiters, developers }) => {
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
        this.error = 'Failed to load organization dashboard.';
        this.loading = false;
        this.refreshing = false;
      }
    });
  }

  loadPerformance(): void {
    this.performanceService.getPerformance(this.selectedDays, {
      teamId: this.selectedTeamId || undefined,
      recruiterId: this.selectedRecruiterId || undefined,
      stack: this.selectedStack || undefined,
      jobStatus: this.selectedJobStatus || undefined
    }).pipe(
      finalize(() => {
        this.loading = false;
        this.refreshing = false;
        this.initialized = true;
      })
    ).subscribe({
      next: (data) => {
        if (this.normalizeSelectedFilters(data)) {
          this.loadPerformance();
          return;
        }
        this.performance = data;
        this.chartsNeedRender = true;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to load organization analytics.';
      }
    });
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
    this.configApplied = false;
    this.loadDashboard();
  }

  openTeamsView(): void {
    this.router.navigate(['/app/admin/console'], { queryParams: { tab: 'teams' } });
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
      (recruiter.teams || []).some((assigned) => assigned._id === team._id)
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
    return this.maxValue((this.performance?.teamMetrics || []).map((team) => team.candidatesAnalyzed || 0));
  }

  maxTeamAiUsage(): number {
    return this.maxValue((this.performance?.teamMetrics || []).map((team) => team.aiUsage || 0));
  }

  maxMonthlyTrend(): number {
    return this.maxValue((this.performance?.hiringAnalytics?.monthlyTrend || []).map((item) => item.count));
  }

  maxStackDistribution(): number {
    return this.maxValue((this.performance?.hiringAnalytics?.stackDistribution || []).map((item) => item.count));
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

    if (this.selectedTeamId && !data.filters.teams.some((team) => team._id === this.selectedTeamId)) {
      this.selectedTeamId = '';
      changed = true;
    }

    if (this.selectedRecruiterId && !data.filters.recruiters.some((recruiter) => recruiter._id === this.selectedRecruiterId)) {
      this.selectedRecruiterId = '';
      changed = true;
    }

    if (this.selectedStack && !data.filters.stacks.includes(this.selectedStack)) {
      this.selectedStack = '';
      changed = true;
    }

    if (this.selectedJobStatus && !(data.filters.jobStatuses || []).includes(this.selectedJobStatus)) {
      this.selectedJobStatus = '';
      changed = true;
    }

    return changed;
  }

  private renderCharts(): void {
    if (!this.performance) {
      return;
    }

    this.renderTeamActivityChart();
    this.renderRecruiterPerformanceChart();
    this.renderHiringFunnelChart();
  }

  private renderTeamActivityChart(): void {
    const canvas = this.teamActivityChartRef?.nativeElement;
    if (!canvas || !this.performance?.teamMetrics.length) {
      this.teamChart?.destroy();
      this.teamChart = null;
      return;
    }

    this.teamChart?.destroy();
    const teams = this.performance.teamMetrics.slice(0, 8);
    const config: ChartConfiguration<'bar' | 'line'> = {
      type: 'bar',
      data: {
        labels: teams.map((team) => team.name),
        datasets: [
          {
            type: 'bar',
            label: 'Engagement Score',
            data: teams.map((team) => team.engagementScore),
            backgroundColor: 'rgba(99, 102, 241, 0.72)',
            borderRadius: 8,
            maxBarThickness: 28
          },
          {
            type: 'line',
            label: 'Candidates Analyzed',
            data: teams.map((team) => team.candidatesAnalyzed || 0),
            borderColor: '#22d3ee',
            backgroundColor: 'rgba(34, 211, 238, 0.18)',
            tension: 0.35,
            fill: false,
            pointRadius: 3,
            yAxisID: 'y1'
          }
        ]
      },
      options: this.buildChartOptions({
        leftTitle: 'Score',
        rightTitle: 'Candidates'
      })
    };

    this.teamChart = new Chart(canvas, config);
  }

  private renderRecruiterPerformanceChart(): void {
    const canvas = this.recruiterPerformanceChartRef?.nativeElement;
    if (!canvas || !this.performance?.recruiterMetrics.length) {
      this.recruiterChart?.destroy();
      this.recruiterChart = null;
      return;
    }

    this.recruiterChart?.destroy();
    const recruiters = this.performance.recruiterMetrics.slice(0, 8);
    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: recruiters.map((recruiter) => recruiter.name),
        datasets: [
          {
            label: 'Jobs',
            data: recruiters.map((recruiter) => recruiter.totalJobs),
            backgroundColor: 'rgba(14, 165, 233, 0.76)',
            borderRadius: 8,
            maxBarThickness: 22
          },
          {
            label: 'Matches',
            data: recruiters.map((recruiter) => recruiter.matchesGenerated),
            backgroundColor: 'rgba(45, 212, 191, 0.76)',
            borderRadius: 8,
            maxBarThickness: 22
          },
          {
            label: 'AI Calls',
            data: recruiters.map((recruiter) => recruiter.totalAnalyses),
            backgroundColor: 'rgba(244, 114, 182, 0.76)',
            borderRadius: 8,
            maxBarThickness: 22
          }
        ]
      },
      options: this.buildChartOptions()
    };

    this.recruiterChart = new Chart(canvas, config);
  }

  private renderHiringFunnelChart(): void {
    const canvas = this.hiringFunnelChartRef?.nativeElement;
    if (!canvas || !this.performance) {
      this.funnelChart?.destroy();
      this.funnelChart = null;
      return;
    }

    this.funnelChart?.destroy();
    const data = this.performance.hiringAnalytics;
    const config: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: ['Open Jobs', 'Draft Jobs', 'Closed Jobs', 'Accepted Invites'],
        datasets: [
          {
            data: [
              data.open,
              data.draft,
              data.closed,
              data.invitationFunnel.accepted
            ],
            backgroundColor: ['#6366f1', '#22d3ee', '#14b8a6', '#f59e0b'],
            borderColor: '#091426',
            borderWidth: 2,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#cbd5e1',
              boxWidth: 12,
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(71, 85, 105, 0.45)',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0'
          }
        }
      }
    };

    this.funnelChart = new Chart(canvas, config);
  }

  private buildChartOptions(axisTitles?: { leftTitle?: string; rightTitle?: string }): ChartConfiguration<'bar' | 'line'>['options'] {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#cbd5e1',
            boxWidth: 12,
            padding: 16
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          borderColor: 'rgba(71, 85, 105, 0.45)',
          borderWidth: 1,
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0'
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#94a3b8'
          },
          grid: {
            color: 'rgba(51, 65, 85, 0.25)'
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#94a3b8'
          },
          title: axisTitles?.leftTitle
            ? {
                display: true,
                text: axisTitles.leftTitle,
                color: '#94a3b8'
              }
            : undefined,
          grid: {
            color: 'rgba(51, 65, 85, 0.25)'
          }
        },
        y1: axisTitles?.rightTitle
          ? {
              beginAtZero: true,
              position: 'right',
              ticks: {
                color: '#94a3b8'
              },
              title: {
                display: true,
                text: axisTitles.rightTitle,
                color: '#94a3b8'
              },
              grid: {
                drawOnChartArea: false
              }
            }
          : undefined
      }
    };
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
