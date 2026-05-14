import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import {
  AdminPerformanceService,
  PerformanceData,
  RecruiterMetric,
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
  readonly dayOptions = [7, 14, 30, 60, 90];

  constructor(
    private readonly svc: AdminPerformanceService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.svc.getPerformance(this.selectedDays, {
      teamId: this.selectedTeamId || undefined,
      recruiterId: this.selectedRecruiterId || undefined,
      stack: this.selectedStack || undefined
    }).pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (d) => { this.data = d; },
      error: (e) => { this.error = e?.error?.message || 'Failed to load performance data.'; }
    });
  }

  setSection(s: Section): void { this.activeSection = s; }
  resetFilters(): void {
    this.selectedTeamId = '';
    this.selectedRecruiterId = '';
    this.selectedStack = '';
    this.load();
  }

  // ── Chart helpers ─────────────────────────────────────────────────────

  /** Width % for a bar relative to the max value in the set */
  barPct(value: number, max: number): number {
    return max > 0 ? Math.round((value / max) * 100) : 0;
  }

  maxTrend(trend: TrendItem[]): number {
    return Math.max(1, ...trend.map((t) => t.count));
  }

  maxStack(items: StackItem[]): number {
    return Math.max(1, ...items.map((s) => s.count));
  }

  maxRecruiterJobs(metrics: RecruiterMetric[]): number {
    return Math.max(1, ...metrics.map((r) => r.totalJobs));
  }

  maxTeamScore(metrics: TeamMetric[]): number {
    return Math.max(1, ...metrics.map((t) => t.engagementScore));
  }

  max2(a: number, b: number): number {
    return Math.max(1, Number(a || 0), Number(b || 0));
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

  /** Rank medal for leaderboard */
  medal(i: number): string {
    return ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`;
  }

  scoreColor(score: number): string {
    if (score >= 70) return 'green';
    if (score >= 40) return 'amber';
    return 'red';
  }
}
