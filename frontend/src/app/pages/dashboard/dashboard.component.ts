import { Component, OnInit, ElementRef, ViewChild, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';
import { ApiService } from '../../shared/services/api.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { CAREER_STACKS, EXPERIENCE_LEVELS, CareerStack, ExperienceLevel } from '../../shared/models/career-profile.model';
import { ScoreMeterComponent } from '../../shared/components/score-meter/score-meter.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged } from 'rxjs/operators';
import { TenantContextService } from '../../shared/services/tenant-context.service';

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

  /* State */
  developerScore = 0;
  githubScore = 0;
  lastAnalyzed = 'Loading...';
  lastAnalyzedAt: string | null = null;
  githubHandle = '';
  isLoading = true;
  rateLimitWarning = false;
  noGithubUsername = false;

  readonly careerStacks:     CareerStack[]     = CAREER_STACKS;
  readonly experienceLevels: ExperienceLevel[] = EXPERIENCE_LEVELS;

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
  tenantOrgName = '';
  tenantTeamName = '';
  tenantTeamAnalytics: { totalMembers: number; averageReadinessScore: number } | null = null;
  resumeMetrics = {
    atsScore: 0,
    keywordDensity: 0,
    formatScore: 0,
    contentQuality: 0
  };

  private radarInstance: Chart | null = null;
  private viewInitialized = false;
  private activityInstance: Chart | null = null;
  private languageInstance: Chart | null = null;

  private pendingActivityData: { month: string; count: number }[] | null = null;
  private pendingLanguageData: Record<string, number> | null = null;
  private readonly subscriptions: Subscription = new Subscription();

  constructor(
    private readonly apiService:           ApiService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr:                  ChangeDetectorRef,
    private readonly tenantContext:        TenantContextService
  ) {}

  ngOnInit() {
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged((a, b) =>
          a.careerStack === b.careerStack && a.experienceLevel === b.experienceLevel
        )
      ).subscribe(() => {
        this.loadDashboardData();
      })
    );

    this.subscriptions.add(
      this.tenantContext.state$.pipe(
        distinctUntilChanged((a, b) =>
          a.organizationId === b.organizationId && a.teamId === b.teamId && a.organizationName === b.organizationName && a.teamName === b.teamName
        )
      ).subscribe((ctx) => {
        this.tenantOrgName = ctx.organizationName || '';
        this.tenantTeamName = ctx.teamName || '';

        if (ctx.teamId) {
          this.apiService.getTeamAnalytics(ctx.teamId).pipe(catchError(() => of(null))).subscribe((res: any) => {
            this.tenantTeamAnalytics = res
              ? {
                  totalMembers: Number(res.totalMembers || 0),
                  averageReadinessScore: Number(res.averageReadinessScore || 0)
                }
              : null;
            this.cdr.detectChanges();
          });
        } else {
          this.tenantTeamAnalytics = null;
          this.cdr.detectChanges();
        }
      })
    );
  }

  get selectedCareerStack(): CareerStack       { return this.careerProfileService.careerStack; }
  get selectedExperienceLevel(): ExperienceLevel { return this.careerProfileService.experienceLevel; }

  onCareerStackChange(stack: CareerStack): void {
    this.careerProfileService.setActiveCareerProfile(
      stack,
      this.careerProfileService.experienceLevel
    ).subscribe();
  }

  onExperienceLevelChange(level: ExperienceLevel): void {
    this.careerProfileService.setActiveCareerProfile(
      this.careerProfileService.careerStack,
      level
    ).subscribe();
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
        this.lastAnalyzedAt   = data.lastAnalyzedAt || null;
        this.lastAnalyzed     = this.formatLastAnalyzed(this.lastAnalyzedAt);
        this.rateLimitWarning = data.rateLimited  === true;
        this.noGithubUsername = data.noUsername   === true;
        this.githubScore = Number(data.score || 0);

        const summaryReadiness = Number(data.readinessScore || 0);
        if (summaryReadiness > 0 && this.developerScore === 0) {
          this.developerScore = summaryReadiness;
        }

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

    const { careerStack, experienceLevel } = this.careerProfileService.snapshot;

    // Parallel fetch: Resume Analysis + AI Skill Gap
    forkJoin({
        resume: this.apiService.getResumeAnalysis().pipe(
            catchError(() => of({}))
        ),
        skillGap: this.apiService.getSkillGap(username, careerStack, experienceLevel)
    }).subscribe({
        next: (results: any) => {
            const gapData    = results.skillGap;
            const resumeData = results.resume;

            this.resumeMetrics = {
              atsScore: Number(resumeData?.atsScore || 0),
              keywordDensity: Number(resumeData?.keywordDensity || 0),
              formatScore: Number(resumeData?.formatScore || 0),
              contentQuality: Number(resumeData?.contentQuality || 0)
            };

            if (gapData.yourSkills && Array.isArray(gapData.yourSkills)) {
                this.topSkills = gapData.yourSkills.map((s: any) => {
                    if (typeof s === 'string') return s;
                    if (s.name)  return s.name;
                    if (s.skill) return s.skill;
                    return String(s);
                });
            } else {
                this.topSkills = [];
            }

            if (gapData.missingSkills && Array.isArray(gapData.missingSkills)) {
                this.missingSkills = gapData.missingSkills.map((s: any) => {
                    if (typeof s === 'string') return s;
                    if (s.name)  return s.name;
                    if (s.skill) return s.skill;
                    return String(s);
                });
            } else {
                this.missingSkills = [];
            }

            const total = this.topSkills.length + this.missingSkills.length;
            const hasCoverage = gapData.coverage !== undefined;
            const derivedCoverage = total > 0 ? Math.round((this.topSkills.length / total) * 100) : 0;
            this.coveragePercentage = hasCoverage
              ? Math.max(0, Math.min(100, Number(gapData.coverage)))
              : derivedCoverage;

            this.apiService.getPortfolioScore(username, careerStack, experienceLevel, resumeData, gapData.githubStats).subscribe({
                next: (scoreResult) => {
                  this.developerScore = Number(scoreResult.overallScore || this.developerScore || 0);
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

            this.apiService.getRecommendations(username, careerStack, experienceLevel, this.topSkills, this.missingSkills).subscribe({
                next: (recResult) => {
                    this.recommendations = (recResult.projects || []).slice(0, 3).map((p: any) => ({
                        title:        p.title,
                        priority:     'High',
                        category:     (p.tech || []).slice(0, 2).join(', '),
                        priorityType: 'high',
                        icon:         'technology'
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
            console.error('Skill gap error:', err);
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
    this.subscriptions.unsubscribe();
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

    const categories = ['Code Quality', 'Skill Coverage', 'Industry Readiness', 'Project Impact'];
    let dataPoints = [
      Math.max(0, Math.min(100, this.githubScore || 0)),
      Math.max(0, Math.min(100, this.coveragePercentage || 0)),
      Math.max(0, Math.min(100, Math.round((this.resumeMetrics.atsScore + this.resumeMetrics.keywordDensity + this.resumeMetrics.contentQuality) / 3) || this.developerScore || 0)),
      Math.max(0, Math.min(100, Math.round((this.statCards[1]?.value > 0 ? 70 : 50) + (this.statCards[0]?.value > 0 ? 10 : 0))))
    ];

    if (this.aiBreakdown) {
        dataPoints = [
            this.aiBreakdown.codeQuality || 70,
            this.aiBreakdown.skillCoverage || 70,
            this.aiBreakdown.industryReadiness || 70,
            this.aiBreakdown.projectImpact || 70
        ];
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

  get scoreBreakdownRows(): { label: string; value: number }[] {
    const src = this.aiBreakdown || {};
    return [
      { label: 'Code Quality', value: Math.max(0, Math.min(100, Number(src.codeQuality ?? this.githubScore ?? 0))) },
      { label: 'Skill Coverage', value: Math.max(0, Math.min(100, Number(src.skillCoverage ?? this.coveragePercentage ?? 0))) },
      { label: 'Industry Readiness', value: Math.max(0, Math.min(100, Number(src.industryReadiness ?? this.developerScore ?? 0))) },
      { label: 'Project Impact', value: Math.max(0, Math.min(100, Number(src.projectImpact ?? this.developerScore ?? 0))) }
    ];
  }

  get profileSignalRows(): { label: string; value: number }[] {
    return [
      { label: 'GitHub Strength', value: Math.max(0, Math.min(100, Number(this.githubScore || 0))) },
      { label: 'Resume ATS', value: Math.max(0, Math.min(100, Number(this.resumeMetrics.atsScore || 0))) },
      { label: 'Keyword Density', value: Math.max(0, Math.min(100, Number(this.resumeMetrics.keywordDensity || 0))) },
      { label: 'Skill Coverage', value: Math.max(0, Math.min(100, Number(this.coveragePercentage || 0))) }
    ];
  }

  get dashboardIdentityLine(): string {
    const handle = this.githubHandle || 'Not connected';
    const orgPart = this.tenantOrgName ? ` | Org: ${this.tenantOrgName}` : '';
    const teamPart = this.tenantTeamName ? ` | Team: ${this.tenantTeamName}` : '';
    return `Last analyzed: ${this.lastAnalyzed} | GitHub: ${handle}${orgPart}${teamPart}`;
  }

  get dashboardScoreLine(): string {
    return `Readiness Score: ${Math.round(this.developerScore)} | GitHub Score: ${Math.round(this.githubScore)}`;
  }

  private formatLastAnalyzed(value: string | null): string {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';

    const diffMs = Date.now() - date.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return `${min} min ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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