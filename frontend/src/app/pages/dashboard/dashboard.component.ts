import { Component, OnInit, ElementRef, ViewChild, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../shared/services/api.service';
import { RoleService, TargetRole } from '../../shared/services/role.service';
import { ScoreMeterComponent } from '../../shared/components/score-meter/score-meter.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

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
  imports: [CommonModule, RouterLink, FormsModule, ScoreMeterComponent, UiBadgeComponent],
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

  availableRoles: TargetRole[] = [];
  selectedRole: TargetRole = 'Full Stack Developer';

  statCards: StatCard[] = [
    { label: 'Repositories', value: 0, growth: '', iconType: 'repos',     },
    { label: 'Total Stars',  value: 0, growth: '', iconType: 'stars',     },
    { label: 'Total Forks',  value: 0, growth: '', iconType: 'forks',     },
    { label: 'Followers',    value: 0, growth: '', iconType: 'followers', },
  ];

  totalActivity = 0;
  coveragePercentage = 0;

  topSkills: string[] = [];
  missingSkills: string[] = [];

  languageLegend: LanguageLegendItem[] = [];
  recommendations: RecommendationItem[] = [];
  aiBreakdown: any = null;

  private radarInstance: Chart | null = null;
  private viewInitialized = false;
  private activityInstance: Chart | null = null;
  private languageInstance: Chart | null = null;

  private pendingActivityData: { month: string; count: number }[] | null = null;
  private pendingLanguageData: Record<string, number> | null = null;
  private subscriptions: Subscription = new Subscription();

  constructor(
    private readonly apiService: ApiService,
    private readonly roleService: RoleService,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.availableRoles = this.roleService.getRoles();
    this.selectedRole = this.roleService.getCurrentRole();
  }

  ngOnInit() {
    this.subscriptions.add(
        this.roleService.targetRole$.subscribe(role => {
            this.selectedRole = role;
            this.loadDashboardData();
        })
    );
  }

  onRoleChange(newRole: TargetRole) {
    this.roleService.setRole(newRole);
  }

  reanalyze() {
    this.loadDashboardData(true);
  }

  loadDashboardData(forceRefresh = false) {
    this.isLoading = true;
    this.cdr.detectChanges();

    // 1. Fetch Basic Dashboard Stats
    this.apiService.getDashboardSummary().subscribe({
      next: (data: any) => {
        this.githubHandle     = data.githubHandle ? `@${data.githubHandle}` : '';
        this.lastAnalyzed     = 'Just now';
        this.rateLimitWarning = data.rateLimited  === true;
        this.noGithubUsername = data.noUsername   === true;

        this.statCards = [
          { label: 'Repositories', value: data.repositories || 0, growth: '', iconType: 'repos'     },
          { label: 'Total Stars',  value: data.stars        || 0, growth: '', iconType: 'stars'     },
          { label: 'Total Forks',  value: data.forks        || 0, growth: '', iconType: 'forks'     },
          { label: 'Followers',    value: data.followers    || 0, growth: '', iconType: 'followers' },
        ];
        
        // After summary, we might need resume analysis for next steps
        this.fetchAiAnalysis(data.githubHandle);
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });

    this.loadActivityAndLanguage();
  }

  fetchAiAnalysis(username: string) {
    if (!username) {
        this.isLoading = false;
        this.cdr.detectChanges();
        return;
    }

    // Parallel fetch: Resume Analysis + AI Skill Gap
    forkJoin({
        resume: this.apiService.getResumeAnalysis().pipe(
            // If resume fails, return empty object instead of failing the whole request
            catchError(() => of({}))
        ),
        skillGap: this.apiService.getSkillGap(username, this.selectedRole)
    }).subscribe({
        next: (results: any) => {
            const gapData = results.skillGap;
            const resumeData = results.resume;

            console.log('=== SKILL GAP API RESPONSE ===');
            console.log('Full Gap Data:', JSON.stringify(gapData, null, 2));
            console.log('yourSkills:', gapData.yourSkills);
            console.log('missingSkills:', gapData.missingSkills);
            console.log('coverage:', gapData.coverage);
            
            // Handle different possible formats with better fallbacks
            if (gapData.yourSkills && Array.isArray(gapData.yourSkills)) {
                this.topSkills = gapData.yourSkills.map((s: any) => {
                    if (typeof s === 'string') return s;
                    if (s.name) return s.name;
                    if (s.skill) return s.skill;
                    return String(s);
                });
            } else {
                console.warn('yourSkills is not an array or is missing');
                this.topSkills = [];
            }
            
            if (gapData.missingSkills && Array.isArray(gapData.missingSkills)) {
                this.missingSkills = gapData.missingSkills.map((s: any) => {
                    if (typeof s === 'string') return s;
                    if (s.name) return s.name;
                    if (s.skill) return s.skill;
                    return String(s);
                });
            } else {
                console.warn('missingSkills is not an array or is missing');
                this.missingSkills = [];
            }

            console.log('=== PROCESSED SKILLS ===');
            console.log('Top Skills:', this.topSkills);
            console.log('Missing Skills:', this.missingSkills);

            const total = this.topSkills.length + this.missingSkills.length;
            this.coveragePercentage = gapData.coverage !== undefined 
                ? Number(gapData.coverage) 
                : (total > 0 ? Math.round((this.topSkills.length / total) * 100) : 0);
            
            console.log('Coverage Percentage:', this.coveragePercentage);

            this.apiService.getPortfolioScore(username, this.selectedRole, resumeData, gapData.githubStats).subscribe({
                next: (scoreResult) => {
                    this.developerScore = scoreResult.overallScore || 0;
                    
                    // Store breakdown for radar chart
                    if (scoreResult.breakdown) {
                        this.aiBreakdown = scoreResult.breakdown;
                    }
                    
                    if (this.viewInitialized) this.initRadarChart();
                    this.cdr.detectChanges();
                },
                error: (err) => {
                    console.error('Portfolio score error:', err);
                    this.cdr.detectChanges();
                }
            });

            this.apiService.getRecommendations(username, this.selectedRole, this.missingSkills).subscribe({
                next: (recResult) => {
                    this.recommendations = (recResult.projects || []).slice(0, 3).map((p: any) => ({
                        title: p.title,
                        priority: 'High',
                        category: (p.tech || []).slice(0, 2).join(', '),
                        priorityType: 'high',
                        icon: 'technology'
                    }));
                    this.cdr.detectChanges();
                },
                error: (err) => {
                    console.error('Recommendations error:', err);
                    this.cdr.detectChanges();
                }
            });

            this.isLoading = false;
            this.cdr.detectChanges();
        },
        error: (err) => {
            console.error('=== SKILL GAP ERROR ===');
            console.error('Error:', err);
            console.error('Error message:', err.message);
            console.error('Error status:', err.status);
            this.isLoading = false;
            this.cdr.detectChanges();
        }
    });
  }

  ngAfterViewInit() {
    this.viewInitialized = true;
    this.loadActivityAndLanguage();

    // If skills already loaded (API was faster than view init), draw radar now
    setTimeout(() => {
      this.initRadarChart();
      // Flush any pending chart data that arrived before the canvas was ready
      if (this.pendingActivityData) {
        this.initActivityChart(this.pendingActivityData);
        this.pendingActivityData = null;
      }
      if (this.pendingLanguageData) {
        this.initLanguageChart(this.pendingLanguageData);
        this.pendingLanguageData = null;
      }
      this.cdr.detectChanges();
    }, 50);
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
          if (this.viewInitialized && this.activityChart?.nativeElement) {
            this.initActivityChart(data);
          } else {
            this.pendingActivityData = data;
          }
        }
      },
      error: () => {}
    });

    this.apiService.getDashboardLanguages().subscribe({
      next: (data: any) => {
        if (data && Object.keys(data).length > 0) {
          if (this.viewInitialized && this.languageChart?.nativeElement) {
            this.initLanguageChart(data);
          } else {
            this.pendingLanguageData = data;
          }
        }
      },
      error: () => {}
    });
  }

  /* ── Charts ── */
  initRadarChart() {
    if (!this.skillRadar?.nativeElement) return;
    this.radarInstance?.destroy();

    let categories = ['Code Quality', 'Skill Coverage', 'Industry Readiness', 'Project Impact'];
    let dataPoints = [70, 70, 70, 70]; // Default fallbacks

    if (this.aiBreakdown) {
        dataPoints = [
            this.aiBreakdown.codeQuality || 70,
            this.aiBreakdown.skillCoverage || 70,
            this.aiBreakdown.industryReadiness || 70,
            this.aiBreakdown.projectImpact || 70
        ];
    } else if (this.topSkills.length > 0) {
        // Fallback to top skills if AI breakdown hasn't arrived yet
        categories = this.topSkills.slice(0, 6);
        dataPoints = categories.map(() => Math.round(50 + Math.random() * 40));
    }

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