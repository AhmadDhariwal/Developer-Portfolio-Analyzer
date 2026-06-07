import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription, catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import {
  AdminPerformanceService,
  PerformanceComparison,
  PerformanceData,
  RecruiterAnalysisUsage,
  RecruiterMetric,
  StackItem,
  TeamMetric,
  TrendItem
} from './admin-performance.service';

type Section = 'overview' | 'recruiters' | 'teams' | 'hiring' | 'ai';
type DrawerType = 'recruiter' | 'team' | '';

interface FilterState {
  days: number;
  teamId: string;
  recruiterId: string;
  stack: string;
  jobStatus: string;
  tab: Section;
}

@Component({
  selector: 'app-admin-performance',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-performance.component.html',
  styleUrls: ['./admin-performance.component.scss']
})
export class AdminPerformanceComponent implements OnInit, OnDestroy {
  loading = false;
  error = '';
  data: PerformanceData | null = null;
  activeSection: Section = 'overview';
  selectedDays = 30;
  selectedTeamId = '';
  selectedRecruiterId = '';
  selectedStack = '';
  selectedJobStatus = '';
  drawerOpen = false;
  drawerType: DrawerType = '';
  selectedRecruiterDetail: RecruiterMetric | null = null;
  selectedTeamDetail: TeamMetric | null = null;
  readonly dayOptions = [7, 14, 30, 60, 90];
  readonly skeletonCards = Array.from({ length: 6 });
  readonly skeletonRows = Array.from({ length: 5 });
  private routeSub?: Subscription;
  private refreshSub?: Subscription;

  constructor(
    private readonly svc: AdminPerformanceService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.routeSub = this.route.queryParamMap.pipe(
      map((params) => this.readStateFromQuery(params)),
      distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
      tap((state) => this.applyState(state)),
      switchMap((state) => {
        this.loading = true;
        this.error = '';
        this.closeDrawer();
        return this.svc.getPerformance(state.days, {
          teamId: state.teamId || undefined,
          recruiterId: state.recruiterId || undefined,
          stack: state.stack || undefined,
          jobStatus: state.jobStatus || undefined
        }).pipe(
          map((data) => ({ data, state })),
          catchError((error) => of({ error, state }))
        );
      })
    ).subscribe((result) => {
      this.loading = false;

      if ('error' in result) {
        this.error = result.error?.error?.message || 'Failed to load performance data.';
        this.cdr.detectChanges();
        return;
      }

      this.data = result.data;
      if (this.normalizeSelectedFilters(result.data)) {
        this.replaceUrlState();
      }
      this.syncDrawerSelection();
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
  }

  refresh(): void {
    this.refreshSub?.unsubscribe();
    this.loading = true;
    this.error = '';
    const state = this.currentState();
    this.refreshSub = this.svc.getPerformance(state.days, {
      teamId: state.teamId || undefined,
      recruiterId: state.recruiterId || undefined,
      stack: state.stack || undefined,
      jobStatus: state.jobStatus || undefined
    }).pipe(
      catchError((error) => {
        this.error = error?.error?.message || 'Failed to load performance data.';
        return of(null);
      })
    ).subscribe((data) => {
      this.loading = false;
      if (data) {
        this.data = data;
        this.syncDrawerSelection();
      }
      this.cdr.detectChanges();
    });
  }

  setSection(section: Section): void {
    if (section === this.activeSection) return;
    this.activeSection = section;
    this.replaceUrlState();
  }

  onTeamChange(): void {
    this.selectedRecruiterId = '';
    this.replaceUrlState();
  }

  onRecruiterChange(): void {
    this.replaceUrlState();
  }

  onStackChange(): void {
    this.replaceUrlState();
  }

  onJobStatusChange(): void {
    this.replaceUrlState();
  }

  onDaysChange(): void {
    this.replaceUrlState();
  }

  resetFilters(): void {
    this.selectedDays = 30;
    this.selectedTeamId = '';
    this.selectedRecruiterId = '';
    this.selectedStack = '';
    this.selectedJobStatus = '';
    this.replaceUrlState();
  }

  openRecruiterDetails(metric: RecruiterMetric): void {
    this.selectedRecruiterDetail = metric;
    this.selectedTeamDetail = null;
    this.drawerType = 'recruiter';
    this.drawerOpen = true;
  }

  openTeamDetails(metric: TeamMetric): void {
    this.selectedTeamDetail = metric;
    this.selectedRecruiterDetail = null;
    this.drawerType = 'team';
    this.drawerOpen = true;
  }

  closeDrawer(): void {
    this.drawerOpen = false;
    this.drawerType = '';
    this.selectedRecruiterDetail = null;
    this.selectedTeamDetail = null;
  }

  exportRecruiters(): void {
    if (!this.data?.recruiterMetrics?.length) return;
    this.downloadCsv('recruiter-performance.csv', [
      ['Recruiter', 'Email', 'Status', 'Team Id', 'Total Jobs', 'Recent Jobs', 'AI Calls', 'Candidates', 'Hiring Success %', 'Last Active', 'Score'],
      ...this.data.recruiterMetrics.map((item) => [
        item.name,
        item.email,
        item.isActive ? 'Active' : 'Inactive',
        item.teamId || '',
        item.totalJobs,
        item.recentJobs,
        item.totalAnalyses,
        item.candidatesAnalyzed,
        item.hiringSuccessRate,
        item.lastActiveAt || '',
        item.score
      ])
    ]);
  }

  exportTeams(): void {
    if (!this.data?.teamMetrics?.length) return;
    this.downloadCsv('team-performance.csv', [
      ['Team', 'Status', 'Members', 'Active Members', 'Recruiters', 'Total Jobs', 'Recent Jobs', 'Candidates', 'AI Usage', 'Engagement Score', 'Performance Score'],
      ...this.data.teamMetrics.map((item) => [
        item.name,
        item.isActive ? 'Active' : 'Inactive',
        item.memberCount,
        item.activeMembers,
        item.recruiterCount,
        item.totalJobs,
        item.recentJobs,
        item.candidatesAnalyzed || 0,
        item.aiUsage || 0,
        item.engagementScore,
        item.performanceScore || 0
      ])
    ]);
  }

  barPct(value: number, max: number): number {
    return max > 0 ? Math.round((value / max) * 100) : 0;
  }

  maxTrend(trend: TrendItem[]): number {
    return Math.max(1, ...trend.map((item) => item.count));
  }

  maxStack(items: StackItem[]): number {
    return Math.max(1, ...items.map((item) => item.count));
  }

  maxRecruiterJobs(metrics: RecruiterMetric[]): number {
    return Math.max(1, ...metrics.map((metric) => metric.totalJobs));
  }

  maxTeamScore(metrics: TeamMetric[]): number {
    return Math.max(1, ...metrics.map((metric) => metric.engagementScore));
  }

  max2(a: number, b: number): number {
    return Math.max(1, Number(a || 0), Number(b || 0));
  }

  maxAnalysisCount(items: RecruiterAnalysisUsage[]): number {
    return Math.max(1, ...items.map((item) => item.count));
  }

  funnelPct(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }

  heatClass(value: number, max: number): string {
    const safeMax = max > 0 ? max : 1;
    const ratio = value / safeMax;
    if (value <= 0) return 'ps-heatmap__cell ps-heatmap__cell--0';
    if (ratio >= 0.85) return 'ps-heatmap__cell ps-heatmap__cell--4';
    if (ratio >= 0.6) return 'ps-heatmap__cell ps-heatmap__cell--3';
    if (ratio >= 0.35) return 'ps-heatmap__cell ps-heatmap__cell--2';
    return 'ps-heatmap__cell ps-heatmap__cell--1';
  }

  medal(i: number): string {
    return ['01', '02', '03'][i] ?? `#${i + 1}`;
  }

  scoreColor(score: number): string {
    if (score >= 70) return 'green';
    if (score >= 40) return 'amber';
    return 'red';
  }

  comparison(key: keyof NonNullable<PerformanceData['comparisons']>): PerformanceComparison | null {
    return this.data?.comparisons?.[key] || null;
  }

  comparisonTone(comparison: PerformanceComparison | null): string {
    if (!comparison || comparison.delta === 0) return 'neutral';
    return comparison.delta > 0 ? 'positive' : 'negative';
  }

  comparisonLabel(comparison: PerformanceComparison | null, suffix = ''): string {
    if (!comparison) return 'No comparison';
    if (comparison.delta === 0) return 'Flat vs previous';
    const prefix = comparison.delta > 0 ? '+' : '';
    return `${prefix}${comparison.delta}${suffix} (${prefix}${comparison.deltaPct}%)`;
  }

  trackByValue(_: number, value: string): string {
    return value;
  }

  private readStateFromQuery(params: { get(name: string): string | null }): FilterState {
    const rawDays = Number.parseInt(String(params.get('days') || '30'), 10);
    const days = this.dayOptions.includes(rawDays) ? rawDays : 30;
    const tab = this.parseSection(params.get('tab'));
    return {
      days,
      teamId: String(params.get('teamId') || '').trim(),
      recruiterId: String(params.get('recruiterId') || '').trim(),
      stack: String(params.get('stack') || '').trim(),
      jobStatus: String(params.get('jobStatus') || '').trim(),
      tab
    };
  }

  private parseSection(value: string | null): Section {
    const section = String(value || '').trim();
    if (section === 'recruiters' || section === 'teams' || section === 'hiring' || section === 'ai') {
      return section;
    }
    return 'overview';
  }

  private applyState(state: FilterState): void {
    this.selectedDays = state.days;
    this.selectedTeamId = state.teamId;
    this.selectedRecruiterId = state.recruiterId;
    this.selectedStack = state.stack;
    this.selectedJobStatus = state.jobStatus;
    this.activeSection = state.tab;
  }

  private currentState(): FilterState {
    return {
      days: this.selectedDays,
      teamId: this.selectedTeamId,
      recruiterId: this.selectedRecruiterId,
      stack: this.selectedStack,
      jobStatus: this.selectedJobStatus,
      tab: this.activeSection
    };
  }

  private replaceUrlState(): void {
    const state = this.currentState();
    const queryParams: Params = {
      days: state.days !== 30 ? state.days : null,
      teamId: state.teamId || null,
      recruiterId: state.recruiterId || null,
      stack: state.stack || null,
      jobStatus: state.jobStatus || null,
      tab: state.tab !== 'overview' ? state.tab : null
    };

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true
    });
  }

  private normalizeSelectedFilters(data: PerformanceData): boolean {
    let changed = false;

    if (this.selectedTeamId && !data.filters.teams.some((team) => team._id === this.selectedTeamId)) {
      this.selectedTeamId = '';
      this.selectedRecruiterId = '';
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

  private syncDrawerSelection(): void {
    if (!this.drawerOpen || !this.data) return;

    if (this.drawerType === 'recruiter' && this.selectedRecruiterDetail) {
      const nextRecruiter = this.data.recruiterMetrics.find((item) => item._id === this.selectedRecruiterDetail?._id) || null;
      this.selectedRecruiterDetail = nextRecruiter;
      this.drawerOpen = !!nextRecruiter;
    }

    if (this.drawerType === 'team' && this.selectedTeamDetail) {
      const nextTeam = this.data.teamMetrics.find((item) => item._id === this.selectedTeamDetail?._id) || null;
      this.selectedTeamDetail = nextTeam;
      this.drawerOpen = !!nextTeam;
    }
  }

  private downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
