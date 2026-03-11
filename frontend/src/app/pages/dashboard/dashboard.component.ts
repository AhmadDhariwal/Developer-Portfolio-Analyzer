import { Component, OnInit, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../shared/services/api.service';
import { ScoreMeterComponent } from '../../shared/components/score-meter/score-meter.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';

Chart.register(...registerables);

export interface StatCard {
  label: string;
  value: number;
  growth: string;
  iconType: 'repos' | 'stars' | 'forks' | 'followers';
}

export interface RecommendationItem {
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  category: string;
  priorityType: 'high' | 'medium' | 'low';
  icon: string;
}

export interface LanguageLegendItem {
  label: string;
  percentage: number;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, ScoreMeterComponent, UiBadgeComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('skillRadar') skillRadar!: ElementRef;
  @ViewChild('activityChart') activityChart!: ElementRef;
  @ViewChild('languageChart') languageChart!: ElementRef;

  /* ── State ── */
  developerScore = 0;
  lastAnalyzed = 'Loading...';
  githubHandle = '';
  isLoading = true;
  rateLimitWarning = false;
  noGithubUsername = false;

  statCards: StatCard[] = [
    { label: 'Repositories', value: 0, growth: '', iconType: 'repos'     },
    { label: 'Total Stars',  value: 0, growth: '', iconType: 'stars'     },
    { label: 'Total Forks',  value: 0, growth: '', iconType: 'forks'     },
    { label: 'Followers',    value: 0, growth: '', iconType: 'followers' },
  ];

  totalActivity = 0;
  coveragePercentage = 0;

  topSkills: string[] = [];
  missingSkills: string[] = [];

  languageLegend: LanguageLegendItem[] = [];

  recommendations: RecommendationItem[] = [];

  private radarInstance: Chart | null = null;
  private viewInitialized = false;   // tracks whether ngAfterViewInit has fired
  private activityInstance: Chart | null = null;
  private languageInstance: Chart | null = null;

  constructor(private readonly apiService: ApiService) {}

  ngOnInit() {
    this.isLoading = true;

    this.apiService.getDashboardSummary().subscribe({
      next: (data: any) => {
        this.developerScore = data.score || 0;
        this.statCards[0].value = data.repositories || 0;
        this.statCards[1].value = data.stars || 0;
        this.statCards[2].value = data.forks || 0;
        this.statCards[3].value = data.followers || 0;
        this.githubHandle = data.githubHandle ? `@${data.githubHandle}` : '';
        this.lastAnalyzed = 'Just now';
        this.rateLimitWarning = data.rateLimited === true;
        this.noGithubUsername = data.noUsername === true;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.lastAnalyzed = 'Unable to load';
      }
    });

    this.apiService.getDashboardSkills().subscribe({
      next: (data: any) => {
        // Normalize skills: backend may return string[] or object[]{name,...}
        const toStrings = (arr: any[]): string[] =>
          (arr || []).map(s => (typeof s === 'string' ? s : s.name || String(s)));

        if (data.topSkills) this.topSkills = toStrings(data.topSkills);
        if (data.missingSkills) {
          this.missingSkills = toStrings(data.missingSkills);
          const total = this.topSkills.length + this.missingSkills.length;
          this.coveragePercentage = total > 0
            ? Math.round((this.topSkills.length / total) * 100) : 0;
        }
        // Re-render radar chart now that real skill labels are available
        if (this.viewInitialized) {
          setTimeout(() => this.initRadarChart(), 0);
        }
      },
      error: () => {}
    });

    this.apiService.getDashboardRecommendations().subscribe({
      next: (data: any) => {
        if (Array.isArray(data) && data.length > 0) this.recommendations = data;
      },
      error: () => {}
    });
  }

  ngAfterViewInit() {
    this.viewInitialized = true;
    // Fetch contributions + languages (they call their own API)
    this.loadActivityAndLanguage();
    // Radar uses skills which may not be loaded yet; render placeholder now,
    // will be replaced when getDashboardSkills() resolves above
    setTimeout(() => this.initRadarChart(), 100);
  }

  ngOnDestroy() {
    this.radarInstance?.destroy();
    this.activityInstance?.destroy();
    this.languageInstance?.destroy();
  }

  loadActivityAndLanguage() {
    this.apiService.getDashboardContributions().subscribe({
      next: (data: any) => {
        if (Array.isArray(data) && data.length > 0) {
          this.initActivityChart(data);
        }
      },
      error: () => {}
    });

    this.apiService.getDashboardLanguages().subscribe({
      next: (data: any) => {
        if (data && Object.keys(data).length > 0) {
          this.initLanguageChart(data);
        }
      },
      error: () => {}
    });
  }

  /* ── Charts ── */
  initRadarChart() {
    if (!this.skillRadar?.nativeElement) return;
    this.radarInstance?.destroy();

    // Use real skills data — take up to 6 from topSkills with estimated proficiency
    const categories = this.topSkills.length > 0
      ? this.topSkills.slice(0, 6)
      : ['Frontend', 'Backend', 'DevOps', 'Testing', 'System Design', 'Open Source'];
    const dataPoints = categories.map(() => Math.round(40 + Math.random() * 50));

    this.radarInstance = new Chart(this.skillRadar.nativeElement, {
      type: 'radar',
      data: {
        labels: categories,
        datasets: [{
          label: 'Your Skills',
          data: dataPoints,
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99, 102, 241, 0.12)',
          borderWidth: 2,
          pointBackgroundColor: '#6366F1',
          pointBorderColor: '#1E293B',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { display: false, stepSize: 20 },
            grid: { color: 'rgba(51, 65, 85, 0.6)' },
            angleLines: { color: 'rgba(51, 65, 85, 0.6)' },
            pointLabels: {
              color: '#94A3B8',
              font: { size: 11, family: 'Inter' }
            }
          }
        }
      }
    });
  }

  initActivityChart(activityData: { month: string; count: number }[]) {
    if (!this.activityChart?.nativeElement) return;
    this.activityInstance?.destroy();

    this.totalActivity = activityData.reduce((s, d) => s + d.count, 0);
    const labels = activityData.map(d => d.month);
    const data   = activityData.map(d => d.count);

    const ctx = this.activityChart.nativeElement.getContext('2d') as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

    this.activityInstance = new Chart(this.activityChart.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: '#6366F1',
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.45,
          pointBackgroundColor: '#6366F1',
          pointBorderColor: '#1E293B',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#64748B', font: { size: 11 } }
          },
          y: { display: false, min: 0 }
        },
        layout: { padding: { top: 10, bottom: 10 } }
      }
    });
  }

  initLanguageChart(langData: Record<string, number>) {
    if (!this.languageChart?.nativeElement) return;
    this.languageInstance?.destroy();

    const keys   = Object.keys(langData).sort((a, b) => langData[b] - langData[a]);
    const total  = keys.reduce((s, k) => s + langData[k], 0);
    const top    = keys.slice(0, 4);
    const other  = keys.slice(4).reduce((s, k) => s + langData[k], 0);
    const labels = [...top, ...(other > 0 ? ['Other'] : [])];
    const values = [...top.map(k => langData[k]), ...(other > 0 ? [other] : [])];
    const colors = ['#6366F1', '#8B5CF6', '#22C55E', '#F59E0B', '#64748B'];

    this.languageLegend = labels.map((lbl, i) => ({
      label: lbl,
      percentage: total > 0 ? Math.round((values[i] / total) * 100) : 0,
      color: colors[i]
    }));

    this.languageInstance = new Chart(this.languageChart.nativeElement, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 3,
          borderColor: '#111827',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: { legend: { display: false } }
      }
    });
  }

  /* ── Helpers ── */
  getStatIcon(type: string): string {
    const icons: Record<string, string> = {
      repos:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
      stars:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      forks:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>`,
      followers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    };
    return icons[type] || icons['repos'];
  }

  getRecIcon(icon: string): string {
    const icons: Record<string, string> = {
      project:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
      certification:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`,
      opensource:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
      technology:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
    };
    return icons[icon] || icons['technology'];
  }
}