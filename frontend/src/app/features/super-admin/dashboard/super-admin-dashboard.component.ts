import { AfterViewInit, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Chart, registerables } from 'chart.js';
import { SuperAdminService } from '../shared/super-admin.service';

Chart.register(...registerables);

type Tone = 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'red' | 'indigo' | 'pink';

interface MetricCard {
  label: string;
  value: string | number;
  sub: string;
  trendText: string;
  sparkline: string;
  tone: Tone;
  link: string | null;
}

interface PerformanceCard {
  label: string;
  value: string | number;
  sub: string;
  tone: Tone;
}

interface ComparisonCard {
  label: string;
  current: string | number;
  previous: string | number;
  delta: number;
  deltaText: string;
  sparkline: string;
  tone: Tone;
}

interface ActivityItem {
  id: string;
  title: string;
  meta: string;
  status: string;
  createdAt?: string | Date;
  tone: Tone;
}

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './super-admin-dashboard.component.html',
  styleUrls: ['./super-admin-dashboard.component.scss']
})
export class SuperAdminDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('userGrowthChart') userGrowthRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('roleDistChart') roleDistRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stackDistChart') stackDistRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('analysisChart') analysisRef!: ElementRef<HTMLCanvasElement>;

  loading = true;
  error = '';

  metrics: any = {};
  latestOrgs: any[] = [];
  topDevelopers: any[] = [];
  activeAdmins: any[] = [];
  recentActivity = {
    organizations: [] as ActivityItem[],
    recruiterInvites: [] as ActivityItem[],
    developerRegistrations: [] as ActivityItem[],
    aiAnalyses: [] as ActivityItem[]
  };

  summary: any = {};
  comparisons: any = {};
  charts: any = {};

  private chartInstances: Chart[] = [];
  private dataReady = false;
  private viewReady = false;

  constructor(
    private readonly sa: SuperAdminService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.sa.getDashboardBundle().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const dashboard = res?.dashboard ?? {};
        const analytics = res?.analytics ?? {};

        this.metrics = dashboard?.metrics ?? {};
        this.latestOrgs = dashboard?.latestOrgs ?? [];
        this.topDevelopers = dashboard?.topDevelopers ?? [];
        this.activeAdmins = dashboard?.activeAdmins ?? [];
        this.recentActivity = dashboard?.recentActivity ?? this.recentActivity;
        this.summary = analytics?.summary ?? {};
        this.comparisons = analytics?.comparisons ?? {};
        this.charts = dashboard?.charts ?? {};

        this.error = '';
        this.loading = false;
        this.dataReady = true;

        setTimeout(() => {
          try {
            this.cdr.detectChanges();
          } catch {}

          if (this.viewReady) {
            this.buildCharts();
          }
        }, 0);
      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load dashboard data right now.';
        try {
          this.cdr.detectChanges();
        } catch {}
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.dataReady) {
      setTimeout(() => {
        try {
          this.cdr.detectChanges();
        } catch {}
        this.buildCharts();
      }, 0);
    }
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  get metricCards(): MetricCard[] {
    const platformDelta = this.comparisons?.platformOverview?.deltaPct ?? this.metrics.platformGrowth ?? 0;
    const orgSeries = this.charts?.userGrowth?.organizations ?? [];
    const recruiterSeries = this.charts?.userGrowth?.recruiters ?? [];
    const developerSeries = this.charts?.userGrowth?.developers ?? [];
    const analysisSeries = this.charts?.analysisGrowth ?? [];
    const health = this.summary?.systemHealth ?? {};
    const systemScore = Math.max(0, 100 - Number(health.errorRatePct || 0));

    return [
      {
        label: 'Organizations',
        value: this.metrics.totalOrgs ?? 0,
        sub: `${this.metrics.recentOrgs ?? 0} new in 30 days`,
        trendText: this.trendLabel(platformDelta),
        sparkline: this.sparkline(orgSeries),
        tone: 'blue',
        link: '../organizations'
      },
      {
        label: 'Recruiters',
        value: this.metrics.totalRecruiters ?? 0,
        sub: 'Active recruiter accounts',
        trendText: this.trendLabel(this.summary?.recruiterPerformance?.trendPct ?? 0),
        sparkline: this.sparkline(recruiterSeries),
        tone: 'green',
        link: '../recruiters'
      },
      {
        label: 'Developers',
        value: this.metrics.totalDevelopers ?? 0,
        sub: 'Developer accounts',
        trendText: this.trendLabel(this.summary?.developerInsights?.githubActivityTrendPct ?? 0),
        sparkline: this.sparkline(developerSeries),
        tone: 'orange',
        link: '../developers'
      },
      {
        label: 'AI Analyses',
        value: this.metrics.totalAnalyses ?? 0,
        sub: 'Generated across the platform',
        trendText: this.trendLabel(this.summary?.aiUsage?.githubTrendPct ?? 0),
        sparkline: this.sparkline(analysisSeries),
        tone: 'purple',
        link: null
      },
      {
        label: 'Platform Growth',
        value: `${platformDelta >= 0 ? '+' : ''}${platformDelta}%`,
        sub: 'Org growth vs prior window',
        trendText: this.trendLabel(platformDelta),
        sparkline: this.sparkline(orgSeries),
        tone: platformDelta >= 0 ? 'indigo' : 'red',
        link: null
      },
      {
        label: 'System Health',
        value: `${systemScore}%`,
        sub: `${Number(health.avgResponseTimeMs || 0)} ms avg response`,
        trendText: `${Number(health.errorRatePct || 0)}% error rate`,
        sparkline: this.sparkline([
          Number(health.avgResponseTimeMs || 0),
          Number(health.p95ResponseTimeMs || 0),
          Number(health.failedRequests || 0),
          Number(health.errorRatePct || 0)
        ]),
        tone: 'teal',
        link: '../analytics'
      }
    ];
  }

  get performanceCards(): PerformanceCard[] {
    const platform = this.summary?.platformOverview ?? {};
    const recruiter = this.summary?.recruiterPerformance ?? {};
    const ai = this.summary?.aiUsage ?? {};
    const developer = this.summary?.developerInsights ?? {};
    const health = this.summary?.systemHealth ?? {};
    const organizationPerformance = this.summary?.organizationPerformance ?? {};

    return [
      {
        label: 'Active organizations',
        value: Number(platform.totalOrganizations || this.metrics.activeOrgs || this.metrics.totalOrgs || 0),
        sub: `${Number(this.latestOrgs.filter((org: any) => !org.isSuspended).length || 0)} recent active orgs`,
        tone: 'blue'
      },
      {
        label: 'Recruiter activity',
        value: Number(recruiter.activeRecruiters || 0),
        sub: `${Number(recruiter.candidatesAnalyzed || 0)} candidates analyzed`,
        tone: 'green'
      },
      {
        label: 'AI usage',
        value: Number((ai.githubAnalyses || 0) + (ai.resumeAnalyses || 0) + (ai.recommendationsGenerated || 0)),
        sub: `${Number(ai.githubAnalyses || 0)} GitHub, ${Number(ai.resumeAnalyses || 0)} resume`,
        tone: 'purple'
      },
      {
        label: 'Developer activity',
        value: Number(developer.mostActiveDevelopers?.length || this.topDevelopers.length || 0),
        sub: `${Number(developer.profileCompletionPct || 0)}% profile completion`,
        tone: 'orange'
      },
      {
        label: 'Platform growth',
        value: `${Number(platform.platformGrowthPct || this.metrics.platformGrowth || 0)}%`,
        sub: `${Number(platform.organizationGrowthPct || 0)}% organization growth`,
        tone: 'indigo'
      },
      {
        label: 'API / system health',
        value: `${Number(health.errorRatePct || 0)}%`,
        sub: `${Number(health.avgResponseTimeMs || 0)} ms avg, ${Number(health.totalRequests || 0)} requests`,
        tone: 'teal'
      }
    ];
  }

  get comparisonCards(): ComparisonCard[] {
    const platform = this.comparisons?.platformOverview ?? {};
    const ai = this.comparisons?.aiUsage ?? {};
    const recruiter = this.comparisons?.recruiterPerformance ?? {};
    const resume = this.comparisons?.resumeUsage ?? {};
    const recommendation = this.comparisons?.recommendations ?? {};
    const topOrgCounts = this.summary?.organizationPerformance?.topOrganizations?.map((org: any) => Number(org.memberCount || 0)) ?? [];
    const aiSeries = this.charts?.analysisGrowth ?? [];

    return [
      {
        label: 'Organization performance',
        current: Number(platform.current || 0),
        previous: Number(platform.previous || 0),
        delta: Number(platform.deltaPct || 0),
        deltaText: this.trendLabel(platform.deltaPct ?? 0),
        sparkline: this.sparkline(this.charts?.userGrowth?.organizations ?? []),
        tone: 'blue'
      },
      {
        label: 'Recruiter performance',
        current: Number(recruiter.current || 0),
        previous: Number(recruiter.previous || 0),
        delta: Number(recruiter.deltaPct || 0),
        deltaText: this.trendLabel(recruiter.deltaPct ?? 0),
        sparkline: this.sparkline(this.charts?.analysisGrowth ?? []),
        tone: 'green'
      },
      {
        label: 'Stack popularity',
        current: Number(topOrgCounts[0] || 0),
        previous: Number(topOrgCounts[1] || 0),
        delta: this.deltaFromPair(topOrgCounts[0], topOrgCounts[1]),
        deltaText: `${this.deltaFromPair(topOrgCounts[0], topOrgCounts[1]) >= 0 ? '+' : ''}${this.deltaFromPair(topOrgCounts[0], topOrgCounts[1])}%`,
        sparkline: this.sparkline(topOrgCounts),
        tone: 'orange'
      },
      {
        label: 'Hiring trends',
        current: Number(recommendation.current || 0),
        previous: Number(recommendation.previous || 0),
        delta: Number(recruiter.deltaPct || 0),
        deltaText: this.trendLabel(recruiter.deltaPct ?? 0),
        sparkline: this.sparkline(aiSeries.length ? aiSeries : []),
        tone: 'purple'
      }
    ];
  }

  get activityGroups(): Array<{ title: string; items: ActivityItem[]; empty: string; tone: Tone }> {
    return [
      {
        title: 'New organizations',
        items: this.recentActivity.organizations ?? [],
        empty: 'No organizations have been created yet.',
        tone: 'blue'
      },
      {
        title: 'Recruiter invites',
        items: this.recentActivity.recruiterInvites ?? [],
        empty: 'No recruiter invitations yet.',
        tone: 'purple'
      },
      {
        title: 'Developer registrations',
        items: this.recentActivity.developerRegistrations ?? [],
        empty: 'No developer registrations yet.',
        tone: 'green'
      },
      {
        title: 'AI analyses generated',
        items: this.recentActivity.aiAnalyses ?? [],
        empty: 'No AI analyses have been generated yet.',
        tone: 'orange'
      },
      {
        title: 'Active admins',
        items: this.activeAdmins.map((admin: any) => ({
          id: String(admin._id || admin.id || admin.email || admin.name),
          title: admin.name || 'Admin',
          meta: admin.email || 'No email',
          status: 'Active',
          createdAt: admin.createdAt,
          tone: 'teal'
        })),
        empty: 'No active admins yet.',
        tone: 'teal'
      }
    ];
  }

  get topStacks(): Array<{ stack: string; count: number }> {
    return this.summary?.developerInsights?.topStacks ?? this.charts?.stackDistribution?.map((stack: any) => ({
      stack: stack.stack,
      count: Number(stack.count || 0)
    })) ?? [];
  }

  get topOrganizations(): Array<any> {
    return this.summary?.organizationPerformance?.topOrganizations ?? this.charts?.topOrgs ?? [];
  }

  get hasUserGrowthData(): boolean {
    return this.hasSeries(this.charts?.userGrowth?.organizations)
      || this.hasSeries(this.charts?.userGrowth?.recruiters)
      || this.hasSeries(this.charts?.userGrowth?.developers);
  }

  get hasRoleDistributionData(): boolean {
    return Array.isArray(this.charts?.roleDistribution) && this.charts.roleDistribution.length > 0;
  }

  get hasStackDistributionData(): boolean {
    return Array.isArray(this.charts?.stackDistribution) && this.charts.stackDistribution.length > 0;
  }

  get hasAnalysisData(): boolean {
    return this.hasSeries(this.charts?.analysisGrowth);
  }

  private buildCharts(): void {
    this.destroyCharts();
    const c = this.charts ?? {};

    if (this.userGrowthRef?.nativeElement && this.hasUserGrowthData) {
      this.chartInstances.push(new Chart(this.userGrowthRef.nativeElement, {
        type: 'line',
        data: {
          labels: c.monthLabels ?? [],
          datasets: [
            {
              label: 'Organizations',
              data: c.userGrowth?.organizations ?? [],
              borderColor: '#38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              tension: 0.4,
              fill: true,
              pointRadius: 2
            },
            {
              label: 'Recruiters',
              data: c.userGrowth?.recruiters ?? [],
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34, 197, 94, 0.10)',
              tension: 0.4,
              fill: true,
              pointRadius: 2
            },
            {
              label: 'Developers',
              data: c.userGrowth?.developers ?? [],
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.10)',
              tension: 0.4,
              fill: true,
              pointRadius: 2
            }
          ]
        },
        options: this.lineOpts()
      }));
    }

    if (this.roleDistRef?.nativeElement && this.hasRoleDistributionData) {
      this.chartInstances.push(new Chart(this.roleDistRef.nativeElement, {
        type: 'doughnut',
        data: {
          labels: c.roleDistribution.map((role: any) => role.role),
          datasets: [{
            data: c.roleDistribution.map((role: any) => role.count),
            backgroundColor: ['#7c3aed', '#22c55e', '#f59e0b'],
            borderWidth: 0,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94a3b8', font: { size: 11 } }
            }
          }
        }
      }));
    }

    if (this.stackDistRef?.nativeElement && this.hasStackDistributionData) {
      this.chartInstances.push(new Chart(this.stackDistRef.nativeElement, {
        type: 'bar',
        data: {
          labels: c.stackDistribution.map((stack: any) => stack.stack),
          datasets: [{
            label: 'Developers',
            data: c.stackDistribution.map((stack: any) => stack.count),
            backgroundColor: ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4'],
            borderRadius: 8
          }]
        },
        options: this.barOpts()
      }));
    }

    if (this.analysisRef?.nativeElement && this.hasAnalysisData) {
      this.chartInstances.push(new Chart(this.analysisRef.nativeElement, {
        type: 'bar',
        data: {
          labels: c.monthLabels ?? [],
          datasets: [{
            label: 'AI analyses',
            data: c.analysisGrowth ?? [],
            backgroundColor: 'rgba(99, 102, 241, 0.72)',
            borderRadius: 6
          }]
        },
        options: this.barOpts()
      }));
    }
  }

  private destroyCharts(): void {
    this.chartInstances.forEach((chart) => chart.destroy());
    this.chartInstances = [];
  }

  private lineOpts(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: '#cbd5e1', usePointStyle: true, pointStyle: 'circle' } }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    };
  }

  private barOpts(): any {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    };
  }

  private hasSeries(values: unknown): boolean {
    return Array.isArray(values) && values.some((value) => Number(value || 0) > 0);
  }

  private trendLabel(delta: number): string {
    const value = Number(delta || 0);
    return `${value >= 0 ? '+' : ''}${value}% vs prior period`;
  }

  private deltaFromPair(current: number | string | undefined, previous: number | string | undefined): number {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (!previousValue) return currentValue > 0 ? 100 : 0;
    return Math.round(((currentValue - previousValue) / Math.max(previousValue, 1)) * 100);
  }

  private sparkline(values: Array<number | string> = []): string {
    const points = values.map((value) => Math.max(0, Number(value || 0)));
    if (!points.length) return '';

    const width = 90;
    const height = 28;
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const span = Math.max(max - min, 1);
    const step = points.length > 1 ? width / (points.length - 1) : width;

    return points.map((point, index) => {
      const x = index * step;
      const normalized = (point - min) / span;
      const y = height - (normalized * (height - 4)) - 2;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  }
}
