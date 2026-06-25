import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Chart, registerables } from 'chart.js';
import { Observable, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, shareReplay, skip, tap } from 'rxjs/operators';
import { ApiService } from '../../shared/services/api.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { FrontendAnalysisCacheService, FrontendAnalysisCacheKey } from '../../shared/services/frontend-analysis-cache.service';
import { CAREER_STACKS, EXPERIENCE_LEVELS, CareerStack, ExperienceLevel, buildCareerProfileSignature } from '../../shared/models/career-profile.model';
import { ScoreMeterComponent } from '../../shared/components/score-meter/score-meter.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
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

export interface IntegrationAnalyticsCard {
  provider: string;
  activityScore: number;
  profileScore: number;
  confidence: number;
  trendDelta: number;
  successRate: number;
  syncCount: number;
  lastSyncedAt: string;
}

interface IntegrationInsightProvider {
  provider: string;
  profileScore: number;
  activityScore: number;
  confidence: number;
  inferredSkills: string[];
  normalized?: {
    profile?: {
      username?: string;
      name?: string;
      ranking?: number;
      reputation?: number;
      solvedProblems?: number;
    };
    activity?: {
      easy?: number;
      medium?: number;
      hard?: number;
      profileCompleteness?: number;
      accountTrust?: number;
      accountActivityProxy?: number;
    };
  };
  syncedAt?: string | null;
}

interface ScoreBreakdown {
  codeQuality: number;
  skillCoverage: number;
  industryReadiness: number;
  projectImpact: number;
}

interface DashboardSourcesUsed {
  github?: { connected?: boolean; available?: boolean; status?: string };
  resume?: { connected?: boolean; available?: boolean; status?: string };
  skillGap?: { connected?: boolean; available?: boolean; status?: string };
  recommendations?: { connected?: boolean; available?: boolean; status?: string };
  integrations?: { connected?: boolean; available?: boolean; status?: string };
}

interface ReadinessCenterItem {
  key: string;
  label: string;
  value: number;
  tone?: string;
}

interface CommandCenterAction {
  key: string;
  label: string;
  value: string;
  source: string;
  route: string;
}

interface SourceFreshnessEntry {
  key: string;
  label: string;
  lastUpdated: string | null;
  status: string;
  refreshRecommended: boolean;
  reason?: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, ScoreMeterComponent, UiBadgeComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('skillRadar') skillRadar!: ElementRef<HTMLCanvasElement>;
  @ViewChild('activityChart') activityChart!: ElementRef<HTMLCanvasElement>;
  @ViewChild('languageChart') languageChart!: ElementRef<HTMLCanvasElement>;

  developerScore = 0;
  githubScore = 0;
  lastAnalyzed = 'Loading...';
  lastAnalyzedAt: string | null = null;
  githubHandle = '';
  isLoading = true;
  rateLimitWarning = false;
  noGithubUsername = false;
  scoreChangeFromLastMonth: number | null = null;

  readonly careerStacks: CareerStack[] = CAREER_STACKS;
  readonly experienceLevels: ExperienceLevel[] = EXPERIENCE_LEVELS;

  statCards: StatCard[] = [
    { label: 'Repositories', value: 0, growth: '', iconType: 'repos' },
    { label: 'Total Stars', value: 0, growth: '', iconType: 'stars' },
    { label: 'Total Forks', value: 0, growth: '', iconType: 'forks' },
    { label: 'Followers', value: 0, growth: '', iconType: 'followers' }
  ];

  totalActivity = 0;
  coveragePercentage = 0;
  topSkills: string[] = [];
  missingSkills: string[] = [];
  languageLegend: LanguageLegendItem[] = [];
  hasLanguageData = false;
  recommendations: RecommendationItem[] = [];
  aiBreakdown: ScoreBreakdown | null = null;
  confidenceScore = 0;
  scoreReasons: string[] = [];
  explainabilityBreakdown: { weights: Record<string, number>; featureScores: ScoreBreakdown } | null = null;
  integrationScore = 0;
  integrationAnalyticsCards: IntegrationAnalyticsCard[] = [];
  integrationInsightsByProvider: Record<string, IntegrationInsightProvider> = {};
  tenantOrgName = '';
  tenantTeamName = '';
  tenantTeamAnalytics: {
    totalMembers: number;
    averageReadinessScore: number;
    teamScore?: number;
    teamActivity?: number;
    recruiterEngagement?: number;
    hiringPerformance?: number;
  } | null = null;
  readinessCenter: ReadinessCenterItem[] = [];
  commandCenter: CommandCenterAction[] = [];
  sourceFreshnessRows: SourceFreshnessEntry[] = [];
  signalHash = '';
  contextVersion = '';
  dashboardStale = false;
  dashboardRefreshMessage = '';
  fromFrontendCache = false;
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
  private readonly subscriptions = new Subscription();
  private requestCycle = 0;
  private sourcesUsed: DashboardSourcesUsed = {};
  private languageSource = 'cached_snapshot';
  private readonly cacheVersion = 'dashboard-v3';
  private readonly activeRequests = new Map<string, Observable<any>>();

  readonly statIconHtml: Record<string, SafeHtml>;
  readonly recIconHtml: Record<string, SafeHtml>;

  constructor(
    private readonly apiService: ApiService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef,
    private readonly tenantContext: TenantContextService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly sanitizer: DomSanitizer
  ) {
    const statIcons: Record<string, string> = {
      repos: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
      stars: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      forks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>`,
      followers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    };

    const recIcons: Record<string, string> = {
      project: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
      certification: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`,
      opensource: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
      technology: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
    };

    this.statIconHtml = Object.fromEntries(
      Object.entries(statIcons).map(([key, svg]) => [key, this.sanitizer.bypassSecurityTrustHtml(svg)])
    );
    this.recIconHtml = Object.fromEntries(
      Object.entries(recIcons).map(([key, svg]) => [key, this.sanitizer.bypassSecurityTrustHtml(svg)])
    );
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        skip(1),
        debounceTime(250),
        distinctUntilChanged((a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b))
      ).subscribe(() => {
        this.clearDashboardCache();
        this.loadDashboardData();
      })
    );

    this.subscriptions.add(
      this.tenantContext.state$.pipe(
        distinctUntilChanged((a, b) =>
          a.organizationId === b.organizationId &&
          a.teamId === b.teamId &&
          a.organizationName === b.organizationName &&
          a.teamName === b.teamName
        )
      ).subscribe((ctx) => {
        this.tenantOrgName = ctx.organizationName || '';
        this.tenantTeamName = ctx.teamName || '';

        if (ctx.teamId) {
          this.apiService.getTeamAnalytics(ctx.teamId).pipe(
            catchError(() => of(null))
          ).subscribe((res: any) => {
            this.tenantTeamAnalytics = res ? {
              totalMembers: Number(res.totalMembers || 0),
              averageReadinessScore: Number(res.averageReadinessScore || 0),
              teamScore: Number(res.teamScore || res.averageReadinessScore || 0),
              teamActivity: Number(res.teamActivity || 0),
              recruiterEngagement: Number(res.recruiterEngagement || 0),
              hiringPerformance: Number(res.hiringPerformance || 0)
            } : null;
            this.cdr.detectChanges();
          });
        } else {
          this.tenantTeamAnalytics = null;
          this.cdr.detectChanges();
        }
      })
    );

    this.loadDashboardData();
  }

  get selectedCareerStack(): CareerStack {
    return this.careerProfileService.careerStack;
  }

  get selectedExperienceLevel(): ExperienceLevel {
    return this.careerProfileService.experienceLevel;
  }

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

  reanalyze(): void {
    this.clearDashboardCache();
    this.loadDashboardData(true);
  }

  loadDashboardData(forceRefresh = false): void {
    const cycle = ++this.requestCycle;
    this.isLoading = true;
    this.fromFrontendCache = false;
    this.cdr.detectChanges();

    if (!forceRefresh) {
      const cached = this.frontendCache.get<any>(this.dashboardCacheKey('dashboardSummary'));
      if (cached) {
        this.fromFrontendCache = true;
        this.applyDashboardSummary(cached, cycle);
        this.loadSecondaryDashboardData(false, cycle);
        return;
      }
    }

    this.cachedDashboardRequest(
      'dashboardSummary',
      () => this.apiService.getDashboardSummary(forceRefresh),
      forceRefresh
    ).subscribe({
      next: (data: any) => {
        if (!this.isActiveCycle(cycle)) return;
        this.applyDashboardSummary(data, cycle);
        setTimeout(() => this.loadSecondaryDashboardData(forceRefresh, cycle), 0);
      },
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private applyDashboardSummary(data: any, cycle: number): void {
    if (!this.isActiveCycle(cycle)) return;

    const context = data?.dashboardContext || data?.signalMetadata || {};
    this.signalHash = String(context.signalHash || data?.signalHash || '');
    const dependencySignalHash = String(context.dependencySignalHash || data?.dependencySignalHash || '');
    this.contextVersion = String(context.contextVersion || '');
    this.dashboardStale = Boolean(context.stale || context.refreshRecommended || data?.signalMetadata?.staleSources?.length);
    this.dashboardRefreshMessage = this.dashboardStale ? 'Analysis refresh recommended' : '';
    if (dependencySignalHash) {
      this.frontendCache.setCurrentSignalHash({
        module: 'developer-signals',
        careerStack: String(context.careerStack || this.selectedCareerStack || ''),
        experienceLevel: String(context.experienceLevel || this.selectedExperienceLevel || '')
      }, dependencySignalHash);
    }

    this.githubHandle = data.githubHandle ? `@${data.githubHandle}` : '';
    this.lastAnalyzedAt = data.lastAnalyzedAt || context.lastUpdated || null;
    this.lastAnalyzed = this.formatLastAnalyzed(this.lastAnalyzedAt);
    this.rateLimitWarning = data.rateLimited === true || data.syncStatus === 'rate_limited';
    this.noGithubUsername = data.noUsername === true;
    this.githubScore = Number(data.score || 0);
    this.scoreChangeFromLastMonth = data.scoreChangeFromLastMonth ?? null;
    this.developerScore = Number(data.readinessScore || 0);
    this.integrationScore = Number(data?.integration?.score || 0);
    this.sourcesUsed = data?.sourcesUsed || {};
    this.languageSource = String(data?.languageSource || 'cached_snapshot');

    this.resumeMetrics = {
      atsScore: Number(data?.resume?.atsScore || 0),
      keywordDensity: Number(data?.resume?.keywordDensity || 0),
      formatScore: Number(data?.resume?.formatScore || 0),
      contentQuality: Number(data?.resume?.contentQuality || 0)
    };

    this.aiBreakdown = this.normalizeBreakdown(data?.readinessBreakdown);
    this.readinessCenter = this.normalizeReadinessCenter(data?.readinessCenter);
    this.commandCenter = this.normalizeCommandCenter(data?.commandCenter);
    this.sourceFreshnessRows = this.normalizeSourceFreshness(data?.sourceFreshness || data?.signalMetadata?.sourceFreshness);
    this.explainabilityBreakdown = {
      weights: this.getBreakdownWeights(),
      featureScores: this.aiBreakdown
    };
    this.confidenceScore = this.buildConfidenceScore();
    this.scoreReasons = this.buildScoreReasons();

    this.statCards = [
      { label: 'Repositories', value: Number(data.repositories || 0), growth: '', iconType: 'repos' },
      { label: 'Total Stars', value: Number(data.stars || 0), growth: '', iconType: 'stars' },
      { label: 'Total Forks', value: Number(data.forks || 0), growth: '', iconType: 'forks' },
      { label: 'Followers', value: Number(data.followers || 0), growth: '', iconType: 'followers' }
    ];

    this.applySkillsSnapshot(data?.skillsSnapshot);
    this.applyRecommendationsSnapshot(data?.recommendationSnapshot);

    if (this.viewInitialized) {
      this.initRadarChart();
    }

    this.isLoading = false;
    this.cdr.detectChanges();
  }

  private loadSecondaryDashboardData(forceRefresh: boolean, cycle: number): void {
    if (!this.isActiveCycle(cycle)) return;
    this.loadActivityAndLanguage(forceRefresh, cycle);
    this.loadSkills(forceRefresh, cycle);
    this.loadIntegrationAnalytics(cycle, forceRefresh);
  }

  loadActivityAndLanguage(forceRefresh = false, cycle = this.requestCycle): void {
    this.cachedDashboardRequest('dashboardContributions', () => this.apiService.getDashboardContributions(forceRefresh), forceRefresh).subscribe({
      next: (payload: any) => {
        if (!this.isActiveCycle(cycle)) return;
        const data = Array.isArray(payload?.data) ? payload.data : [];
        if (data.length > 0) {
          if (this.viewInitialized && this.activityChart?.nativeElement) {
            this.initActivityChart(data);
          } else {
            this.pendingActivityData = data;
          }
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });

    this.cachedDashboardRequest('dashboardLanguages', () => this.apiService.getDashboardLanguages(forceRefresh), forceRefresh).subscribe({
      next: (payload: any) => {
        if (!this.isActiveCycle(cycle)) return;
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
        this.languageSource = String(payload?.source || this.languageSource);
        if (Object.keys(data).length > 0) {
          this.hasLanguageData = true;
          if (this.viewInitialized && this.languageChart?.nativeElement) {
            this.initLanguageChart(data);
          } else {
            this.pendingLanguageData = data;
          }
        } else {
          this.hasLanguageData = false;
          this.pendingLanguageData = null;
          this.languageLegend = [];
          this.languageInstance?.destroy();
          this.languageInstance = null;
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  loadSkills(forceRefresh = false, cycle = this.requestCycle): void {
    this.cachedDashboardRequest('dashboardSkills', () => this.apiService.getDashboardSkills(forceRefresh), forceRefresh).subscribe({
      next: (payload: any) => {
        if (!this.isActiveCycle(cycle)) return;

        this.applySkillsSnapshot(payload);
        this.aiBreakdown = this.buildRadarBreakdown();
        this.explainabilityBreakdown = {
          weights: this.getBreakdownWeights(),
          featureScores: this.aiBreakdown
        };
        this.scoreReasons = this.buildScoreReasons();

        if (this.viewInitialized) {
          this.initRadarChart();
        }

        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.topSkills = [];
        this.missingSkills = [];
        this.coveragePercentage = 0;
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadIntegrationAnalytics(cycle = this.requestCycle, forceRefresh = false): void {
    this.cachedDashboardRequest('dashboardIntegrationAnalytics', () => this.apiService.getDashboardIntegrationAnalytics(7), forceRefresh, { limit: 7 }).subscribe({
      next: (payload: any) => {
        if (!this.isActiveCycle(cycle)) return;

        this.integrationAnalyticsCards = Array.isArray(payload?.cards)
          ? payload.cards.map((card: any) => ({
              provider: String(card.provider || '').toLowerCase(),
              activityScore: Number(card.activityScore || 0),
              profileScore: Number(card.profileScore || 0),
              confidence: Number(card.confidence || 0),
              trendDelta: Number(card.trendDelta || 0),
              successRate: Number(card.successRate || 0),
              syncCount: Number(card.syncCount || 0),
              lastSyncedAt: String(card.lastSyncedAt || '')
            }))
          : [];
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.integrationAnalyticsCards = [];
        this.cdr.detectChanges();
      }
    });
  }

  private applySkillsSnapshot(payload: any): void {
    if (!payload) return;
    this.topSkills = Array.isArray(payload?.topSkills) ? payload.topSkills : this.topSkills;
    this.missingSkills = Array.isArray(payload?.missingSkills) ? payload.missingSkills : this.missingSkills;
    this.coveragePercentage = Math.max(0, Math.min(100, Number(payload?.coveragePercentage ?? this.coveragePercentage ?? 0)));
    if (payload?.stale) {
      this.dashboardStale = true;
      this.dashboardRefreshMessage = 'Analysis refresh recommended';
    }
  }

  private applyRecommendationsSnapshot(payload: any): void {
    if (!payload) return;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    this.recommendations = items.slice(0, 4).map((item: any) => ({
      title: String(item?.title || 'Recommendation'),
      priority: item?.priority === 'Low' || item?.priority === 'Medium' ? item.priority : 'High',
      category: String(item?.category || 'Technology'),
      priorityType: item?.priorityType === 'low' || item?.priorityType === 'medium' ? item.priorityType : 'high',
      icon: this.iconForCategory(item?.category)
    }));
    if (payload?.stale) {
      this.dashboardStale = true;
      this.dashboardRefreshMessage = 'Analysis refresh recommended';
    }
  }

  private cachedDashboardRequest<T>(
    module: string,
    producer: () => Observable<T>,
    forceRefresh = false,
    extra: Partial<FrontendAnalysisCacheKey> = {}
  ): Observable<T> {
    const key = this.dashboardCacheKey(module, extra);
    const requestKey = `${module}:${key.signalHash || 'latest'}:${key.careerStack}:${key.experienceLevel}:${forceRefresh ? 'refresh' : 'cache'}:${key.limit || ''}`;

    if (!forceRefresh) {
      const cached = this.frontendCache.get<T>(key);
      if (cached) return of(cached);
      const active = this.activeRequests.get(requestKey);
      if (active) return active as Observable<T>;
    }

    const request$ = producer().pipe(
      tap((payload: any) => {
        const payloadSignalHash = payload?.dashboardContext?.signalHash
          || payload?.signalMetadata?.signalHash
          || payload?.signalHash
          || this.signalHash
          || key.signalHash;
        this.frontendCache.set({
          ...key,
          signalHash: payloadSignalHash || 'no-signals',
          version: this.dashboardCacheVersion(module, payloadSignalHash)
        }, payload);
      }),
      finalize(() => this.activeRequests.delete(requestKey)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    if (!forceRefresh) this.activeRequests.set(requestKey, request$);
    return request$;
  }

  private dashboardCacheKey(module: string, extra: Partial<FrontendAnalysisCacheKey> = {}): FrontendAnalysisCacheKey {
    return {
      module,
      careerStack: this.selectedCareerStack,
      experienceLevel: this.selectedExperienceLevel,
      signalHash: extra.signalHash || this.signalHash || '',
      version: extra.version || this.dashboardCacheVersion(module, extra.signalHash || this.signalHash),
      ...extra
    };
  }

  private dashboardCacheVersion(module: string, signalHash?: string): string {
    return `${this.cacheVersion}:${module}`;
  }

  private clearDashboardCache(): void {
    [
      'dashboardSummary',
      'dashboardContributions',
      'dashboardLanguages',
      'dashboardSkills',
      'dashboardRecommendations',
      'dashboardIntegrationAnalytics'
    ].forEach((module) => this.frontendCache.clearModule(module));
    this.activeRequests.clear();
  }

  private normalizeReadinessCenter(raw: any): ReadinessCenterItem[] {
    const items = Array.isArray(raw) ? raw : [];
    if (items.length) {
      return items.map((item) => ({
        key: String(item?.key || item?.label || ''),
        label: String(item?.label || 'Readiness'),
        value: this.normalizePercent(Number(item?.value || 0)),
        tone: String(item?.tone || 'primary')
      }));
    }

    return [
      { key: 'overall', label: 'Overall Readiness', value: this.normalizePercent(this.developerScore), tone: 'primary' },
      { key: 'resume', label: 'Resume Readiness', value: this.normalizePercent(this.resumeMetrics.atsScore), tone: 'blue' },
      { key: 'portfolio', label: 'Portfolio Readiness', value: this.normalizePercent(this.aiBreakdown?.projectImpact || 0), tone: 'green' },
      { key: 'interview', label: 'Interview Readiness', value: this.normalizePercent(this.aiBreakdown?.industryReadiness || 0), tone: 'amber' },
      { key: 'market', label: 'Market Readiness', value: this.normalizePercent(this.coveragePercentage), tone: 'cyan' },
      { key: 'integration', label: 'Integration Readiness', value: this.normalizePercent(this.integrationScore), tone: 'violet' }
    ];
  }

  private normalizeCommandCenter(raw: any): CommandCenterAction[] {
    const items = Array.isArray(raw) ? raw : [];
    return items.map((item) => ({
      key: String(item?.key || item?.label || ''),
      label: String(item?.label || 'Priority'),
      value: String(item?.value || 'Not available yet'),
      source: String(item?.source || 'Dashboard'),
      route: String(item?.route || '/app/dashboard')
    })).slice(0, 6);
  }

  private normalizeSourceFreshness(raw: any): SourceFreshnessEntry[] {
    const labels: Record<string, string> = {
      github: 'GitHub',
      resume: 'Resume',
      skillGap: 'Skill Gap',
      recommendations: 'Recommendations',
      weeklyReports: 'Weekly Reports',
      jobs: 'Jobs',
      news: 'News'
    };
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.keys(labels).map((key) => {
      const item = source[key] || source[key === 'weeklyReports' ? 'weekly' : key] || {};
      const status = String(item.status || 'missing');
      return {
        key,
        label: labels[key],
        lastUpdated: item.lastUpdated || item.updatedAt || null,
        status,
        refreshRecommended: Boolean(item.refreshRecommended ?? status !== 'fresh'),
        reason: String(item.reason || '')
      };
    });
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    setTimeout(() => {
      this.initRadarChart();
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

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.radarInstance?.destroy();
    this.activityInstance?.destroy();
    this.languageInstance?.destroy();
  }

  providerName(provider: string): string {
    const map: Record<string, string> = {
      github: 'GitHub',
      linkedin: 'LinkedIn',
      leetcode: 'LeetCode',
      kaggle: 'Kaggle'
    };
    return map[String(provider || '').toLowerCase()] || provider;
  }

  integrationInsight(provider: string): IntegrationInsightProvider | null {
    return this.integrationInsightsByProvider[String(provider || '').toLowerCase()] || null;
  }

  initRadarChart(): void {
    if (!this.skillRadar?.nativeElement) return;
    this.radarInstance?.destroy();

    const breakdown = this.buildRadarBreakdown();
    this.radarInstance = new Chart(this.skillRadar.nativeElement, {
      type: 'radar',
      data: {
        labels: ['Code Quality', 'Skill Coverage', 'Industry Readiness', 'Project Impact'],
        datasets: [{
          label: 'Your Skills',
          data: [
            breakdown.codeQuality,
            breakdown.skillCoverage,
            breakdown.industryReadiness,
            breakdown.projectImpact
          ],
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99, 102, 241, 0.12)',
          borderWidth: 2,
          pointBackgroundColor: '#6366F1',
          pointBorderColor: '#1E293B',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
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

  get scoreTrendLabel(): string {
    if (this.scoreChangeFromLastMonth === null) return 'No prior data yet';
    if (this.scoreChangeFromLastMonth === 0) return 'No change from last month';
    const sign = this.scoreChangeFromLastMonth > 0 ? '+' : '';
    return `${sign}${this.scoreChangeFromLastMonth} pts from last month`;
  }

  get scoreTrendUp(): boolean {
    return (this.scoreChangeFromLastMonth ?? 0) >= 0;
  }

  get percentileLabel(): string {
    const score = Math.round(this.developerScore);
    if (score >= 90) return 'top 5%';
    if (score >= 80) return 'top 15%';
    if (score >= 70) return 'top 30%';
    if (score >= 60) return 'top 50%';
    if (score >= 50) return 'top 65%';
    return 'bottom 35%';
  }

  get scoreBreakdownRows(): { label: string; value: number }[] {
    const src = this.buildRadarBreakdown();
    return [
      { label: 'Code Quality', value: src.codeQuality },
      { label: 'Skill Coverage', value: src.skillCoverage },
      { label: 'Industry Readiness', value: src.industryReadiness },
      { label: 'Project Impact', value: src.projectImpact }
    ];
  }

  get profileSignalRows(): { label: string; value: number }[] {
    return [
      { label: 'GitHub Strength', value: this.normalizePercent(this.githubScore) },
      { label: 'Resume ATS', value: this.normalizePercent(this.resumeMetrics.atsScore) },
      { label: 'Keyword Density', value: this.normalizePercent(this.resumeMetrics.keywordDensity) },
      { label: 'Skill Coverage', value: this.normalizePercent(this.coveragePercentage) }
    ];
  }

  get explainabilityRows(): { label: string; value: number; weight: number }[] {
    const scores = this.buildRadarBreakdown();
    const weights = this.getBreakdownWeights();
    return [
      { label: 'Code Quality', value: scores.codeQuality, weight: Math.round(weights['codeQuality'] * 100) },
      { label: 'Skill Coverage', value: scores.skillCoverage, weight: Math.round(weights['skillCoverage'] * 100) },
      { label: 'Industry Readiness', value: scores.industryReadiness, weight: Math.round(weights['industryReadiness'] * 100) },
      { label: 'Project Impact', value: scores.projectImpact, weight: Math.round(weights['projectImpact'] * 100) }
    ];
  }

  get dashboardIdentityLine(): string {
    const handle = this.githubHandle || 'Not connected';
    const orgPart = this.tenantOrgName ? ` | Org: ${this.tenantOrgName}` : '';
    const teamPart = this.tenantTeamName ? ` | Team: ${this.tenantTeamName}` : '';
    return `Default profile source | Last analyzed: ${this.lastAnalyzed} | GitHub: ${handle}${orgPart}${teamPart}`;
  }

  get dashboardScoreLine(): string {
    return `Readiness Score: ${Math.round(this.developerScore)} | GitHub Score: ${Math.round(this.githubScore)} | Integration Score: ${Math.round(this.integrationScore)}`;
  }

  get sourceHealthLine(): string {
    const githubStatus = this.sourcesUsed.github?.status || 'missing';
    const resumeStatus = this.sourcesUsed.resume?.status || 'missing';
    const recommendationStatus = this.sourcesUsed.recommendations?.status || 'missing';
    return `Source health | GitHub: ${githubStatus} | Resume: ${resumeStatus} | Recommendations: ${recommendationStatus}`;
  }

  formatIntegrationDate(value: string | null): string {
    if (!value) return 'Not synced yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not synced yet';
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private formatLastAnalyzed(value: string | null): string {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  initActivityChart(activityData: { month: string; count: number }[]): void {
    if (!this.activityChart?.nativeElement) return;
    this.activityInstance?.destroy();

    this.totalActivity = activityData.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const labels = activityData.map((item) => item.month);
    const data = activityData.map((item) => Number(item.count || 0));
    const maxVal = Math.max(...data, 1);

    const ctx = this.activityChart.nativeElement.getContext('2d') as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

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
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} commit${ctx.parsed.y !== 1 ? 's' : ''}`
            }
          }
        },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#64748B', font: { size: 11 } }
          },
          y: {
            display: true,
            min: 0,
            suggestedMax: Math.ceil(maxVal * 1.2),
            grid: { color: 'rgba(255,255,255,0.05)' },
            border: { display: false },
            ticks: {
              color: '#64748B',
              font: { size: 10 },
              maxTicksLimit: 5,
              precision: 0
            }
          }
        },
        layout: { padding: { top: 10, bottom: 10 } }
      }
    });
    this.cdr.detectChanges();
  }

  initLanguageChart(langData: Record<string, number>): void {
    if (!this.languageChart?.nativeElement) return;
    this.languageInstance?.destroy();

    const keys = Object.keys(langData).sort((left, right) => Number(langData[right] || 0) - Number(langData[left] || 0));
    const total = keys.reduce((sum, key) => sum + Number(langData[key] || 0), 0);
    const top = keys.slice(0, 4);
    const other = keys.slice(4).reduce((sum, key) => sum + Number(langData[key] || 0), 0);
    const labels = [...top, ...(other > 0 ? ['Other'] : [])];
    const values = [...top.map((key) => Number(langData[key] || 0)), ...(other > 0 ? [other] : [])];
    const colors = ['#6366F1', '#8B5CF6', '#22C55E', '#F59E0B', '#64748B'];
    this.hasLanguageData = values.length > 0 && total > 0;

    this.languageLegend = labels.map((label, index) => ({
      label,
      percentage: total > 0 ? Math.round((values[index] / total) * 100) : 0,
      color: colors[index]
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

  private buildRadarBreakdown(): ScoreBreakdown {
    if (this.aiBreakdown) {
      return this.normalizeBreakdown(this.aiBreakdown);
    }

    const repoCount = Number(this.statCards[0]?.value || 0);
    const starCount = Number(this.statCards[1]?.value || 0);
    const repoSignal = this.normalizePercent((repoCount / 18) * 100);
    const starSignal = this.normalizePercent((Math.log10(starCount + 1) / 2.2) * 100);
    const industryReadiness = this.normalizePercent(
      (this.resumeMetrics.atsScore + this.resumeMetrics.keywordDensity + this.resumeMetrics.contentQuality + this.resumeMetrics.formatScore) / 4 ||
      this.developerScore
    );

    return {
      codeQuality: this.normalizePercent(this.githubScore),
      skillCoverage: this.normalizePercent(this.coveragePercentage),
      industryReadiness,
      projectImpact: this.normalizePercent((starSignal * 0.55) + (repoSignal * 0.25) + (this.integrationScore * 0.2))
    };
  }

  private normalizeBreakdown(value: any): ScoreBreakdown {
    return {
      codeQuality: this.normalizePercent(value?.codeQuality || 0),
      skillCoverage: this.normalizePercent(value?.skillCoverage || 0),
      industryReadiness: this.normalizePercent(value?.industryReadiness || 0),
      projectImpact: this.normalizePercent(value?.projectImpact || 0)
    };
  }

  private getBreakdownWeights(): Record<string, number> {
    if (this.selectedCareerStack === 'Frontend') {
      return { codeQuality: 0.30, skillCoverage: 0.34, industryReadiness: 0.20, projectImpact: 0.16 };
    }
    if (this.selectedCareerStack === 'Backend') {
      return { codeQuality: 0.36, skillCoverage: 0.24, industryReadiness: 0.22, projectImpact: 0.18 };
    }
    if (this.selectedCareerStack === 'AI/ML') {
      return { codeQuality: 0.28, skillCoverage: 0.24, industryReadiness: 0.28, projectImpact: 0.20 };
    }
    return { codeQuality: 0.32, skillCoverage: 0.28, industryReadiness: 0.22, projectImpact: 0.18 };
  }

  private buildConfidenceScore(): number {
    const checks = [
      Boolean(this.sourcesUsed.github?.available),
      Boolean(this.sourcesUsed.resume?.available),
      Boolean(this.sourcesUsed.skillGap?.available),
      Boolean(this.sourcesUsed.recommendations?.available),
      Boolean(this.sourcesUsed.integrations?.available)
    ];
    const ratio = checks.filter(Boolean).length / checks.length;
    return this.normalizePercent(40 + (ratio * 60));
  }

  private buildScoreReasons(): string[] {
    const weights = this.getBreakdownWeights();
    const breakdown = this.buildRadarBreakdown();
    const reasons = [
      `Code quality contributes ${Math.round(weights['codeQuality'] * 100)}% weight and is currently ${breakdown.codeQuality}%.`,
      `Skill coverage contributes ${Math.round(weights['skillCoverage'] * 100)}% weight and is currently ${breakdown.skillCoverage}%.`,
      `Industry readiness contributes ${Math.round(weights['industryReadiness'] * 100)}% weight and is currently ${breakdown.industryReadiness}%.`,
      `Project impact contributes ${Math.round(weights['projectImpact'] * 100)}% weight and is currently ${breakdown.projectImpact}%.`
    ];

    if (this.languageSource === 'language_bytes') {
      reasons.push('Language distribution is based on real GitHub language-byte data across repositories.');
    } else if (this.languageSource === 'primary_language') {
      reasons.push('Language distribution is currently based on primary repo languages because byte data was unavailable.');
    }

    if (this.rateLimitWarning) {
      reasons.push('GitHub was rate limited, so cached analysis is being used for stability.');
    }

    return reasons;
  }

  private iconForCategory(category: string): string {
    const value = String(category || '').toLowerCase();
    if (value.includes('cert')) return 'certification';
    if (value.includes('open')) return 'opensource';
    if (value.includes('project')) return 'project';
    return 'technology';
  }

  private normalizePercent(value: number): number {
    const numeric = Number(value || 0);
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  private isActiveCycle(cycle: number): boolean {
    return this.requestCycle === cycle;
  }
}
