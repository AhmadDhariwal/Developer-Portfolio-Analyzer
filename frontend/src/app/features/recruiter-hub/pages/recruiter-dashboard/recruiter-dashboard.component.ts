import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';

@Component({
  selector: 'app-recruiter-dashboard',
  standalone: false,
  templateUrl: './recruiter-dashboard.component.html',
  styleUrl: './recruiter-dashboard.component.scss',
})
export class RecruiterDashboardComponent implements OnInit {
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

    this.hubService.getDashboard().subscribe({
      next: (dashboard) => {
        this.dashboard = this.normalizeDashboard(dashboard);
        if (this.dashboard?.profile?.organizationId || this.dashboard?.profile?.organizationName) {
          this.tenantContext.syncOrganization({
            id: String(this.dashboard?.profile?.organizationId || this.tenantContext.snapshot.organizationId || ''),
            name: String(this.dashboard?.profile?.organizationName || this.tenantContext.snapshot.organizationName || ''),
            myRole: 'recruiter'
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
    if (items.length < 2) return 'Current week';
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

  get funnelItems(): Array<{ label: string; value: number; tone: string }> {
    return [
      { label: 'Candidates', value: Number(this.dashboard?.metrics?.totalCandidates || 0), tone: 'blue' },
      { label: 'Viewed', value: Number(this.dashboard?.metrics?.candidatesViewed || 0), tone: 'cyan' },
      { label: 'Open Jobs', value: Number(this.dashboard?.metrics?.openJobs || 0), tone: 'purple' },
      { label: 'Closed Jobs', value: Number(this.dashboard?.metrics?.closedJobs || 0), tone: 'green' },
    ];
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

  openRoute(path: string): void {
    this.router.navigate([path]);
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
        topCandidates: this.asArray(payload?.widgets?.topCandidates),
        recentJobs: this.asArray(payload?.widgets?.recentJobs),
        recentMatches: this.asArray(payload?.widgets?.recentMatches),
        pendingFollowUps: this.asArray(payload?.widgets?.pendingFollowUps),
        recentActivity: this.asArray(payload?.widgets?.recentActivity),
      },
    };
  }

  private defaultDashboard(): any {
    return {
      profile: { name: 'Recruiter', organizationId: '', organizationName: '', organizationDescription: '' },
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
        topCandidates: [],
        recentJobs: [],
        recentMatches: [],
        pendingFollowUps: [],
        recentActivity: [],
      },
    };
  }

  private asArray<T = any>(value: unknown): T[] {
    return Array.isArray(value) ? value : [];
  }
}
