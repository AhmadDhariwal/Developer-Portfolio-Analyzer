import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import {
  AdminPerformanceService,
  PerformanceData,
  RecruiterMetric,
  RecruiterAnalysisUsage,
  TeamMetric,
  StackItem,
  TrendItem
} from './admin-performance.service';

type Section = 'overview' | 'recruiters' | 'teams' | 'hiring' | 'ai';

@Component({
  selector: 'app-admin-performance',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-performance.component.html',
  styleUrls: ['./admin-performance.component.scss']
})
export class AdminPerformanceComponent implements OnInit {
  loading = false;
  error = '';
  data: PerformanceData | null = null;
  activeSection: Section = 'overview';
  selectedDays = 30;
  selectedTeamId = '';
  selectedRecruiterId = '';
  selectedStack = '';
  selectedJobStatus = '';
  readonly dayOptions = [7, 14, 30, 60, 90];

  constructor(
    private readonly svc: AdminPerformanceService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.svc.getPerformance(this.selectedDays, {
      teamId: this.selectedTeamId || undefined,
      recruiterId: this.selectedRecruiterId || undefined,
      stack: this.selectedStack || undefined,
      jobStatus: this.selectedJobStatus || undefined
    }).pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (d) => {
        if (this.normalizeSelectedFilters(d)) {
          this.load();
          return;
        }
        this.data = d;
      },
      error: (e) => { this.error = e?.error?.message || 'Failed to load performance data.'; }
    });
  }

  setSection(section: Section): void {
    this.activeSection = section;
  }

  onTeamChange(): void {
    this.selectedRecruiterId = '';
    this.load();
  }

  onRecruiterChange(): void {
    this.load();
  }

  onStackChange(): void {
    this.load();
  }

  onJobStatusChange(): void {
    this.load();
  }

  onDaysChange(): void {
    this.load();
  }

  resetFilters(): void {
    this.selectedTeamId = '';
    this.selectedRecruiterId = '';
    this.selectedStack = '';
    this.selectedJobStatus = '';
    this.load();
  }

  barPct(value: number, max: number): number {
    return max > 0 ? Math.round((value / max) * 100) : 0;
  }

  maxTrend(trend: TrendItem[]): number {
    return Math.max(1, ...trend.map((t) => t.count));
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
