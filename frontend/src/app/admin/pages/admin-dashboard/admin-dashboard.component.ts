import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

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
export class AdminDashboardPageComponent implements OnInit {
  loading = false;
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

  constructor(
    private readonly adminService: AdminHiringService,
    private readonly consoleService: AdminConsoleService,
    private readonly performanceService: AdminPerformanceService
  ) {}

  ngOnInit(): void {
    this.loadDashboard();
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
    this.error = '';

    forkJoin({
      overview: this.adminService.getOverview(),
      preferences: this.consoleService.getPreferences(),
      recruiters: this.adminService.getRecruiters(),
      developers: this.adminService.getDevelopers()
    }).subscribe({
      next: ({ overview, preferences, recruiters, developers }) => {
        this.overview = overview;
        this.preferences = preferences;
        this.recruiters = recruiters;
        this.developers = developers;

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
      })
    ).subscribe({
      next: (data) => {
        if (this.normalizeSelectedFilters(data)) {
          this.loadPerformance();
          return;
        }
        this.performance = data;
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
    this.configApplied = true;
    this.loadDashboard();
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
}
