import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../../../shared/services/auth.service';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';

@Component({
  selector: 'app-recruiter-dashboard',
  standalone: false,
  templateUrl: './recruiter-dashboard.component.html',
  styleUrl: './recruiter-dashboard.component.scss',
})
export class RecruiterDashboardComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly authService = inject(AuthService, { optional: true });
  loading = true;
  error = '';
  metricsReady = false;
  insightsReady = false;
  chartsReady = false;
  dashboard: any = this.defaultDashboard();

  constructor(
    private readonly hubService: RecruiterHubService,
    private readonly router: Router,
    private readonly tenantContext: TenantContextService,
  ) {}

  ngOnInit(): void {
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.loading = true;
    this.error = '';
    this.metricsReady = false;
    this.insightsReady = false;
    this.chartsReady = false;

    this.hubService
      .getDashboard()
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (dashboard) => {
          this.dashboard = this.normalizeDashboard(dashboard);
          if (
            this.dashboard?.profile?.organizationId ||
            this.dashboard?.profile?.organizationName
          ) {
            this.tenantContext.syncOrganization({
              id: String(
                this.dashboard?.profile?.organizationId ||
                  this.tenantContext.snapshot.organizationId ||
                  '',
              ),
              name: String(
                this.dashboard?.profile?.organizationName ||
                  this.tenantContext.snapshot.organizationName ||
                  '',
              ),
              myRole: 'recruiter',
            });
          }
          this.metricsReady = true;
          this.insightsReady = true;
          this.chartsReady = true;
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to load recruiter dashboard.';
          this.loading = false;
        },
      });
  }

  get productivityItems(): Array<{ label: string; value: number }> {
    return [
      { label: 'Activity', value: Number(this.dashboard?.metrics?.recruiterActivityScore || 0) },
    ];
  }

  get successRateLabel(): string {
    return `${Number(this.dashboard?.metrics?.successRate || 0)}% success`;
  }

  get activityTrendLabel(): string {
    const items = this.dashboard?.charts?.weeklyRecruiterActivity || [];
    if (items.length < 2) return 'Current cycle';
    const latest = Number(items[items.length - 1]?.count || 0);
    const previous = Number(items[items.length - 2]?.count || 0);
    if (previous <= 0) return latest > 0 ? '+100%' : 'Stable';
    const delta = Math.round(((latest - previous) / previous) * 100);
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta}%`;
  }

  get topCandidates(): any[] {
    return this.dashboard?.widgets?.topCandidates || [];
  }

  get recentJobs(): any[] {
    return this.dashboard?.widgets?.recentJobs || [];
  }

  get recentMatches(): any[] {
    return this.dashboard?.widgets?.recentMatches || [];
  }

  get pendingFollowUps(): any[] {
    return this.dashboard?.widgets?.pendingFollowUps || [];
  }

  get recentActivity(): any[] {
    return this.dashboard?.widgets?.recentActivity || [];
  }

  get aiInsights(): string[] {
    return this.dashboard?.widgets?.aiInsights || [];
  }

  get hasSupplyDemandDemand(): boolean {
    return (this.dashboard?.charts?.supplyVsDemand || []).some(
      (item: any) => Number(item?.demand || 0) > 0,
    );
  }

  get supplyVsDemandSubtitle(): string {
    return this.hasSupplyDemandDemand
      ? 'Eligible candidates per skill (Supply) vs your created jobs (Demand)'
      : 'Eligible candidates per skill (Supply) · Create jobs with required skills to populate Demand';
  }

  get funnelItems(): Array<{ label: string; value: number; percent: number; tone: string }> {
    const m = this.dashboard?.metrics || {};
    const rows = [
      { label: 'Visible Candidates', value: Number(m.totalCandidates || 0), tone: 'blue' },
      { label: 'Candidates Viewed', value: Number(m.candidatesViewed || 0), tone: 'cyan' },
      { label: 'Candidates Analyzed', value: Number(m.candidatesAnalyzed || 0), tone: 'indigo' },
      { label: 'Matches Generated', value: Number(m.matchesGenerated || 0), tone: 'purple' },
      { label: 'Shortlisted', value: Number(m.shortlistedCandidates || 0), tone: 'green' },
    ];
    const baseline = Math.max(10, ...rows.map((r) => r.value));
    return rows.map((row) => ({
      ...row,
      percent: Math.round((row.value / baseline) * 100),
    }));
  }

  initialFor(value: string): string {
    return (
      String(value || 'C')
        .trim()
        .charAt(0)
        .toUpperCase() || 'C'
    );
  }

  matchScore(match: any): number {
    const score = Number(match?.matchScore || 0);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  statusClass(status: string): string {
    const value = String(status || 'open').toLowerCase();
    if (value === 'draft') return 'status-chip status-chip--draft';
    if (value === 'closed' || value === 'archived') return 'status-chip status-chip--closed';
    return 'status-chip status-chip--open';
  }

  timeAgo(input: string | Date): string {
    const date = new Date(input || '');
    if (Number.isNaN(date.getTime())) return 'recent';
    const ms = Date.now() - date.getTime();
    const minutes = Math.max(1, Math.floor(ms / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  openRoute(path: string, queryParams?: Record<string, string>): void {
    if (queryParams) {
      this.router.navigate([path], { queryParams });
      return;
    }
    this.router.navigate([path]);
  }

  candidateIdFor(candidate: any): string {
    return String(candidate?.id || candidate?.userId || '').trim();
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByItem(index: number, item: any): string {
    return String(
      item?._id ||
        item?.id ||
        item?.candidateId ||
        item?.jobId ||
        item?.label ||
        item?.title ||
        item?.updatedAt ||
        item?.createdAt ||
        index,
    );
  }

  private normalizeDashboard(response: any): any {
    const payload = response?.dashboard || response || {};
    const defaults = this.defaultDashboard();
    return {
      profile: {
        ...defaults.profile,
        ...(payload?.profile || {}),
      },
      metrics: {
        ...defaults.metrics,
        ...(payload?.metrics || {}),
      },
      charts: {
        scoreDistribution: this.asArray(payload?.charts?.scoreDistribution),
        candidatesByStack: this.asArray(payload?.charts?.candidatesByStack),
        jobsPostedTrend: this.asArray(payload?.charts?.jobsPostedTrend),
        experienceDistribution: this.asArray(payload?.charts?.experienceDistribution),
        topSkillsDemand: this.asArray(payload?.charts?.topSkillsDemand),
        supplyVsDemand: this.asArray(payload?.charts?.supplyVsDemand),
        weeklyRecruiterActivity: this.asArray(payload?.charts?.weeklyRecruiterActivity),
      },
      widgets: {
        assignedTeams: this.asArray(payload?.widgets?.assignedTeams),
        topCandidates: this.asArray(payload?.widgets?.topCandidates),
        recentJobs: this.asArray(payload?.widgets?.recentJobs),
        recentMatches: this.asArray(payload?.widgets?.recentMatches),
        pendingFollowUps: this.asArray(payload?.widgets?.pendingFollowUps),
        recentActivity: this.asArray(payload?.widgets?.recentActivity),
        aiInsights: this.asArray(payload?.widgets?.aiInsights),
      },
    };
  }

  private defaultDashboard(): any {
    const user = this.authService?.getCurrentUser?.() as any;
    return {
      profile: {
        name: String(user?.name || '').trim() || 'Recruiter',
        organizationId: String(user?.organizationId || ''),
        organizationName: String(user?.organizationName || ''),
        organizationDescription: '',
      },
      metrics: {
        totalCandidates: 0,
        avgCandidateScore: 0,
        openJobs: 0,
        draftJobs: 0,
        closedJobs: 0,
        teamRecruiters: 0,
        assignedTeams: 0,
        activeJobs: 0,
        candidatesViewed: 0,
        candidatesAnalyzed: 0,
        matchesGenerated: 0,
        shortlistedCandidates: 0,
        recruiterActivityScore: 0,
        successRate: 0,
      },
      charts: {
        scoreDistribution: [],
        candidatesByStack: [],
        jobsPostedTrend: [],
        experienceDistribution: [],
        topSkillsDemand: [],
        supplyVsDemand: [],
        weeklyRecruiterActivity: [],
      },
      widgets: {
        assignedTeams: [],
        topCandidates: [],
        recentJobs: [],
        recentMatches: [],
        pendingFollowUps: [],
        recentActivity: [],
        aiInsights: [],
      },
    };
  }

  private asArray<T = any>(value: unknown): T[] {
    return Array.isArray(value) ? value : [];
  }
}
