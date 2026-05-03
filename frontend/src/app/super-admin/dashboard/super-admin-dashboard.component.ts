import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SuperAdminService } from '../shared/super-admin.service';
import { Chart, registerables } from 'chart.js';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

Chart.register(...registerables);

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './super-admin-dashboard.component.html',
  styleUrls: ['./super-admin-dashboard.component.scss']
})
export class SuperAdminDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('userGrowthChart') userGrowthRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('roleDistChart')   roleDistRef!:   ElementRef<HTMLCanvasElement>;
  @ViewChild('stackDistChart')  stackDistRef!:  ElementRef<HTMLCanvasElement>;
  @ViewChild('analysisChart')   analysisRef!:   ElementRef<HTMLCanvasElement>;

  loading = true;
  metrics: any = {};
  latestOrgs: any[] = [];
  topDevelopers: any[] = [];
  activeAdmins: any[] = [];
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
    this.sa.getDashboard().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.metrics       = res?.metrics       ?? {};
        this.latestOrgs    = res?.latestOrgs    ?? [];
        this.topDevelopers = res?.topDevelopers ?? [];
        this.activeAdmins  = res?.activeAdmins  ?? [];
        this.charts        = res?.charts        ?? {};
        this.loading = false;
        this.dataReady = true;

        // Ensure the view updates even if this callback runs outside Angular's zone.
        // Also let Angular render the *ngIf block before chart refs are queried.
        setTimeout(() => {
          try { this.cdr.detectChanges(); } catch {}
          if (this.viewReady) this.buildCharts();
        }, 0);
      },
      error: () => {
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.dataReady) {
      setTimeout(() => {
        try { this.cdr.detectChanges(); } catch {}
        this.buildCharts();
      }, 0);
    }
  }

  ngOnDestroy(): void {
    this.chartInstances.forEach(c => c.destroy());
  }

  get metricCards() {
    const g = this.metrics.platformGrowth ?? 0;
    return [
      { label: 'Organizations',   value: this.metrics.totalOrgs      ?? 0, sub: `+${this.metrics.recentOrgs ?? 0} this month`, link: '../organizations', color: 'blue'   },
      { label: 'Admins',          value: this.metrics.totalAdmins     ?? 0, sub: 'Org administrators',                          link: '../admins',        color: 'purple' },
      { label: 'Recruiters',      value: this.metrics.totalRecruiters ?? 0, sub: 'Active recruiters',                           link: '../recruiters',    color: 'green'  },
      { label: 'Developers',      value: this.metrics.totalDevelopers ?? 0, sub: `+${this.metrics.recentUsers ?? 0} this month`, link: '../developers',    color: 'orange' },
      { label: 'Teams',           value: this.metrics.totalTeams      ?? 0, sub: 'Across all orgs',                             link: null,               color: 'teal'   },
      { label: 'AI Analyses',     value: this.metrics.totalAnalyses   ?? 0, sub: 'Total runs',                                  link: null,               color: 'red'    },
      { label: 'Platform Growth', value: `${g >= 0 ? '+' : ''}${g}%`,      sub: 'Org growth vs last 30d',                      link: null,               color: g >= 0 ? 'indigo' : 'danger' },
      { label: 'New Users (30d)', value: this.metrics.recentUsers     ?? 0, sub: 'Joined recently',                             link: null,               color: 'pink'   },
    ];
  }

  private buildCharts(): void {
    setTimeout(() => {
      this.destroyCharts();
      const c = this.charts;
      if (!c?.monthLabels) return;

      // 1. User Growth Line Chart
      if (this.userGrowthRef?.nativeElement) {
        this.chartInstances.push(new Chart(this.userGrowthRef.nativeElement, {
          type: 'line',
          data: {
            labels: c.monthLabels,
            datasets: [
              { label: 'Organizations', data: c.userGrowth?.organizations ?? [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', tension: 0.4, fill: true, pointRadius: 3 },
              { label: 'Recruiters',    data: c.userGrowth?.recruiters    ?? [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)',   tension: 0.4, fill: true, pointRadius: 3 },
              { label: 'Developers',   data: c.userGrowth?.developers    ?? [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',  tension: 0.4, fill: true, pointRadius: 3 },
            ]
          },
          options: { ...this.lineOpts(), plugins: { ...this.lineOpts().plugins, title: { display: false } } }
        }));
      }

      // 2. Role Distribution Doughnut
      if (this.roleDistRef?.nativeElement && c.roleDistribution?.length) {
        this.chartInstances.push(new Chart(this.roleDistRef.nativeElement, {
          type: 'doughnut',
          data: {
            labels: c.roleDistribution.map((r: any) => r.role),
            datasets: [{ data: c.roleDistribution.map((r: any) => r.count), backgroundColor: ['#7c3aed','#22c55e','#f59e0b'], borderWidth: 0, hoverOffset: 6 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } } }
        }));
      }

      // 3. Stack Distribution Bar
      if (this.stackDistRef?.nativeElement && c.stackDistribution?.length) {
        this.chartInstances.push(new Chart(this.stackDistRef.nativeElement, {
          type: 'bar',
          data: {
            labels: c.stackDistribution.map((s: any) => s.stack),
            datasets: [{ label: 'Developers', data: c.stackDistribution.map((s: any) => s.count), backgroundColor: ['#6366f1','#22c55e','#f59e0b','#ec4899'], borderRadius: 6 }]
          },
          options: { ...this.barOpts() }
        }));
      }

      // 4. Analysis Growth Bar
      if (this.analysisRef?.nativeElement) {
        this.chartInstances.push(new Chart(this.analysisRef.nativeElement, {
          type: 'bar',
          data: {
            labels: c.monthLabels,
            datasets: [{ label: 'AI Analyses', data: c.analysisGrowth ?? [], backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4 }]
          },
          options: { ...this.barOpts() }
        }));
      }
    }, 50);
  }

  private destroyCharts(): void {
    this.chartInstances.forEach(c => c.destroy());
    this.chartInstances = [];
  }

  private lineOpts(): any {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
      }
    };
  }

  private barOpts(): any {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
      }
    };
  }
}
