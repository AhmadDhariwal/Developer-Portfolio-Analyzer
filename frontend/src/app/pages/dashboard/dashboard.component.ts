import {
  DashboardProgress,
  DashboardIntegrationConnectivity,
} from '../../shared/models/dashboard.model';
import { DashboardProgressComponent } from './components/dashboard-progress/dashboard-progress.component';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Chart, registerables } from 'chart.js';
import { Observable, Subject, Subscription, of } from 'rxjs';
import { distinctUntilChanged, finalize, shareReplay, skip, tap, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../shared/services/api.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  FrontendAnalysisCacheService,
  FrontendAnalysisCacheKey,
} from '../../shared/services/frontend-analysis-cache.service';
import {
  CAREER_STACKS,
  EXPERIENCE_LEVELS,
  CareerStack,
  ExperienceLevel,
  buildCareerProfileSignature,
} from '../../shared/models/career-profile.model';
import { ScoreMeterComponent } from '../../shared/components/score-meter/score-meter.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
import { DashboardLearningSummaryComponent } from './components/dashboard-learning-summary/dashboard-learning-summary.component';

Chart.register(...registerables);

export interface StatCard {
  label: string;
  value: number | null;
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
  trendAvailable: boolean;
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
  codeQuality: number | null;
  skillCoverage: number | null;
  industryReadiness: number | null;
  projectImpact: number | null;
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
  value: number | null;
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
  policy?: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    ScoreMeterComponent,
    UiBadgeComponent,
    DashboardLearningSummaryComponent,
    DashboardProgressComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('skillRadar') skillRadar!: ElementRef<HTMLCanvasElement>;
  @ViewChild('activityChart') activityChart!: ElementRef<HTMLCanvasElement>;
  @ViewChild('languageChart') languageChart!: ElementRef<HTMLCanvasElement>;

  developerScore = 0;
  readinessAvailable = false;
  readinessBasis = 'missing';
  private recordedWeights: Record<string, number> | null = null;
  progress: DashboardProgress | null = null;
  integrationConnectivity: DashboardIntegrationConnectivity | null = null;
  integrationHealthState: 'loading' | 'ready' | 'error' = 'loading';
  private hasSummaryCharts = false;
  private snapshotCareerStack: CareerStack | null = null;
  githubScore = 0;
  lastAnalyzed = 'Loading...';
  lastAnalyzedAt: string | null = null;
  githubHandle = '';
  isLoading = true;
  loadError = '';
  secondaryErrors: string[] = [];
  learningSnapshot: {
    totalTracked: number;
    savedCount: number;
    inProgressCount: number;
    completedCount: number;
  } | null = null;
  rateLimitWarning = false;
  noGithubUsername = false;
  scoreChangeFromLastMonth: number | null = null;

  readonly careerStacks: CareerStack[] = CAREER_STACKS;
  readonly experienceLevels: ExperienceLevel[] = EXPERIENCE_LEVELS;

  statCards: StatCard[] = [
    { label: 'Repositories', value: null, growth: '', iconType: 'repos' },
    { label: 'Total Stars', value: null, growth: '', iconType: 'stars' },
    { label: 'Total Forks', value: null, growth: '', iconType: 'forks' },
    { label: 'Followers', value: null, growth: '', iconType: 'followers' },
  ];

  totalActivity = 0;
  activityAvailable = false;
  coveragePercentage: number | null = null;
  topSkills: string[] = [];
  missingSkills: string[] = [];
  languageLegend: LanguageLegendItem[] = [];
  hasLanguageData = false;
  recommendations: RecommendationItem[] = [];
  aiBreakdown: ScoreBreakdown | null = null;
  scoreReasons: string[] = [];
  explainabilityBreakdown: {
    weights: Record<string, number>;
    featureScores: ScoreBreakdown;
  } | null = null;
  integrationScore = 0;
  integrationAnalyticsCards: IntegrationAnalyticsCard[] = [];
  integrationInsightsByProvider: Record<string, IntegrationInsightProvider> = {};
  readinessCenter: ReadinessCenterItem[] = [];
  commandCenter: CommandCenterAction[] = [];
  sourceFreshnessRows: SourceFreshnessEntry[] = [];
  signalHash = '';
  contextVersion = '';
  dashboardStale = false;
  dashboardRefreshMessage = '';
  fromFrontendCache = false;
  resumeMetrics: {
    atsScore: number | null;
    keywordDensity: number | null;
    formatScore: number | null;
    contentQuality: number | null;
  } = {
    atsScore: 0,
    keywordDensity: 0,
    formatScore: 0,
    contentQuality: 0,
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
  private readonly cacheVersion = 'dashboard-v5';
  private readonly requestCancelled = new Subject<void>();
  private destroyed = false;
  private themeObserver: MutationObserver | null = null;
  private readonly activeRequests = new Map<string, Observable<any>>();

  readonly statIconHtml: Record<string, SafeHtml>;
  readonly recIconHtml: Record<string, SafeHtml>;

  constructor(
    private readonly apiService: ApiService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly sanitizer: DomSanitizer,
  ) {
    const statIcons: Record<string, string> = {
      repos: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
      stars: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      forks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>`,
      followers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    };

    const recIcons: Record<string, string> = {
      project: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
      certification: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`,
      opensource: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
      technology: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    };

    this.statIconHtml = Object.fromEntries(
      Object.entries(statIcons).map(([key, svg]) => [
        key,
        this.sanitizer.bypassSecurityTrustHtml(svg),
      ]),
    );
    this.recIconHtml = Object.fromEntries(
      Object.entries(recIcons).map(([key, svg]) => [
        key,
        this.sanitizer.bypassSecurityTrustHtml(svg),
      ]),
    );
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          skip(1),
          distinctUntilChanged(
            (a, b) => buildCareerProfileSignature(a) === buildCareerProfileSignature(b),
          ),
        )
        .subscribe(() => {
          this.clearDashboardCache();
          this.loadDashboardData();
        }),
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
    this.careerProfileService
      .setActiveCareerProfile(stack, this.careerProfileService.experienceLevel)
      .subscribe();
  }

  onExperienceLevelChange(level: ExperienceLevel): void {
    this.careerProfileService
      .setActiveCareerProfile(this.careerProfileService.careerStack, level)
      .subscribe();
  }

  reanalyze(): void {
    this.clearDashboardCache();
    this.loadDashboardData(true);
  }

  loadDashboardData(forceRefresh = false): void {
    const cycle = ++this.requestCycle;
    this.requestCancelled.next();
    this.loadError = '';
    this.secondaryErrors = [];
    this.isLoading = true;
    this.fromFrontendCache = false;
    this.cdr.detectChanges();

    // Always validate the summary against durable evidence on entry/refresh.
    // A local signal hash cannot detect writes from another tab or API replica.
    this.cachedDashboardRequest(
      'dashboardSummary',
      () => this.apiService.getDashboardSummary(forceRefresh),
      true,
    ).subscribe({
      next: (data: any) => {
        if (!this.isActiveCycle(cycle)) return;
        this.applyDashboardSummary(data, cycle);
        this.loadSecondaryDashboardData(true, cycle);
      },
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.isLoading = false;
        this.loadError =
          'Dashboard could not be refreshed. Previously displayed values may be out of date.';
        this.cdr.detectChanges();
      },
    });
  }

  private applyDashboardSummary(data: any, cycle: number): void {
    if (!this.isActiveCycle(cycle)) return;

    const context = data?.dashboardContext || data?.signalMetadata || {};
    this.snapshotCareerStack = CAREER_STACKS.includes(context.careerStack)
      ? context.careerStack
      : null;
    this.signalHash = String(context.signalHash || data?.signalHash || '');
    const dependencySignalHash = String(
      context.dependencySignalHash || data?.dependencySignalHash || '',
    );
    this.contextVersion = String(context.contextVersion || '');
    this.dashboardStale = Boolean(
      context.stale || context.refreshRecommended || data?.signalMetadata?.staleSources?.length,
    );
    this.dashboardRefreshMessage = this.dashboardStale ? 'Analysis refresh recommended' : '';
    if (dependencySignalHash && !context.sourceRevisionPolicy) {
      try {
        this.frontendCache.setCurrentSignalHash(
          {
            module: 'developer-signals',
            careerStack: String(context.careerStack || this.selectedCareerStack || ''),
            experienceLevel: String(context.experienceLevel || this.selectedExperienceLevel || ''),
          },
          dependencySignalHash,
        );
      } catch {
        /* Evidence remains usable when browser storage is unavailable. */
      }
    }

    this.githubHandle = data.githubHandle ? `@${data.githubHandle}` : '';
    this.lastAnalyzedAt = data.lastAnalyzedAt || context.lastUpdated || null;
    this.lastAnalyzed = this.formatLastAnalyzed(this.lastAnalyzedAt);
    this.rateLimitWarning = data.rateLimited === true || data.syncStatus === 'rate_limited';
    this.noGithubUsername = data.noUsername === true;
    this.githubScore = Number(data.score || 0);
    this.scoreChangeFromLastMonth = data.scoreChangeFromLastMonth ?? null;
    this.readinessBasis = data.readinessMeasurement?.basis || 'legacy';
    this.readinessAvailable = data.readinessMeasurement
      ? data.readinessMeasurement.value !== null
      : true;
    this.developerScore = Number(data.readinessScore || 0);
    this.progress = data.progress || null;
    this.hasSummaryCharts = Boolean(data.activitySnapshot && data.languageSnapshot);
    if (this.hasSummaryCharts) {
      this.activityAvailable = data.activitySnapshot.available === true;
      this.pendingActivityData = data.activitySnapshot.data || [];
      this.pendingLanguageData = data.languageSnapshot.data || {};
      this.totalActivity = this.pendingActivityData!.reduce((sum, item) => sum + item.count, 0);
      this.hasLanguageData = Object.keys(this.pendingLanguageData!).length > 0;
      if (this.viewInitialized) {
        this.initActivityChart(this.pendingActivityData!);
        this.initLanguageChart(this.pendingLanguageData!);
      }
    }
    this.integrationScore = Number(data?.integration?.score || 0);
    this.sourcesUsed = data?.sourcesUsed || {};
    this.languageSource = String(data?.languageSource || 'cached_snapshot');

    this.resumeMetrics = {
      atsScore: this.normalizeCoverage(data?.resume?.atsScore),
      keywordDensity: this.normalizeCoverage(data?.resume?.keywordDensity),
      formatScore: this.normalizeCoverage(data?.resume?.formatScore),
      contentQuality: this.normalizeCoverage(data?.resume?.contentQuality),
    };

    this.recordedWeights =
      data.readinessModel?.basis === 'recorded' ? data.readinessModel.weights : null;
    this.aiBreakdown = this.normalizeBreakdown(data?.readinessBreakdown);
    this.readinessCenter = this.normalizeReadinessCenter(data?.readinessCenter);
    this.commandCenter = this.normalizeCommandCenter(data?.commandCenter);
    this.sourceFreshnessRows = this.normalizeSourceFreshness(
      data?.sourceFreshness || data?.signalMetadata?.sourceFreshness,
    );
    this.explainabilityBreakdown = {
      weights: this.getBreakdownWeights(),
      featureScores: this.aiBreakdown,
    };
    this.scoreReasons = this.buildScoreReasons();

    this.statCards = [
      {
        label: 'Repositories',
        value: this.sourcesUsed.github?.available ? Number(data.repositories ?? 0) : null,
        growth: '',
        iconType: 'repos',
      },
      {
        label: 'Total Stars',
        value: this.sourcesUsed.github?.available ? Number(data.stars ?? 0) : null,
        growth: '',
        iconType: 'stars',
      },
      {
        label: 'Total Forks',
        value: this.sourcesUsed.github?.available ? Number(data.forks ?? 0) : null,
        growth: '',
        iconType: 'forks',
      },
      {
        label: 'Followers',
        value: this.sourcesUsed.github?.available ? Number(data.followers ?? 0) : null,
        growth: '',
        iconType: 'followers',
      },
    ];

    this.learningSnapshot = data?.learningSnapshot || null;
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
    if (!this.hasSummaryCharts) this.loadActivityAndLanguage(forceRefresh, cycle);
    this.loadIntegrationAnalytics(cycle, forceRefresh);
  }

  loadActivityAndLanguage(forceRefresh = false, cycle = this.requestCycle): void {
    this.cachedDashboardRequest(
      'dashboardContributions',
      () => this.apiService.getDashboardContributions(forceRefresh),
      forceRefresh,
    ).subscribe({
      next: (payload: any) => {
        if (!this.isActiveCycle(cycle)) return;
        const data = Array.isArray(payload?.data) ? payload.data : [];
        this.totalActivity = data.reduce(
          (sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0),
          0,
        );
        if (this.viewInitialized && this.activityChart?.nativeElement) {
          this.initActivityChart(data);
        } else {
          this.pendingActivityData = data;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.secondaryErrors.push('Contribution activity');
        this.cdr.detectChanges();
      },
    });

    this.cachedDashboardRequest(
      'dashboardLanguages',
      () => this.apiService.getDashboardLanguages(forceRefresh),
      forceRefresh,
    ).subscribe({
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
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.secondaryErrors.push('Language distribution');
        this.cdr.detectChanges();
      },
    });
  }

  loadIntegrationAnalytics(cycle = this.requestCycle, forceRefresh = false): void {
    this.integrationHealthState = 'loading';
    this.cachedDashboardRequest(
      'dashboardIntegrationAnalytics',
      () => this.apiService.getDashboardIntegrationAnalytics(7),
      forceRefresh,
      { limit: 7 },
    ).subscribe({
      next: (payload: any) => {
        if (!this.isActiveCycle(cycle)) return;

        this.integrationConnectivity = payload.connectivity || null;
        this.integrationHealthState = 'ready';
        this.integrationAnalyticsCards = Array.isArray(payload?.cards)
          ? payload.cards.map((card: any) => ({
              provider: String(card.provider || '').toLowerCase(),
              activityScore: Number(card.activityScore || 0),
              profileScore: Number(card.profileScore || 0),
              confidence: Number(card.confidence || 0),
              trendDelta: Number(card.trendDelta || 0),
              trendAvailable: card.trendAvailable ?? card.syncCount >= 2,
              successRate: Number(card.successRate || 0),
              syncCount: Number(card.syncCount || 0),
              lastSyncedAt: String(card.lastSyncedAt || ''),
            }))
          : [];
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.isActiveCycle(cycle)) return;
        this.integrationAnalyticsCards = [];
        this.integrationHealthState = 'error';
        this.integrationConnectivity = null;
        this.secondaryErrors.push('Integration trends');
        this.cdr.detectChanges();
      },
    });
  }

  private applySkillsSnapshot(payload: any): void {
    if (!payload) return;
    this.topSkills = Array.isArray(payload?.topSkills) ? payload.topSkills : this.topSkills;
    this.missingSkills = Array.isArray(payload?.missingSkills)
      ? payload.missingSkills
      : this.missingSkills;
    if (Object.hasOwn(payload, 'coveragePercentage')) {
      this.coveragePercentage = this.normalizeCoverage(payload.coveragePercentage);
    }
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
      priorityType:
        item?.priorityType === 'low' || item?.priorityType === 'medium'
          ? item.priorityType
          : 'high',
      icon: this.iconForCategory(item?.category),
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
    extra: Partial<FrontendAnalysisCacheKey> = {},
  ): Observable<T> {
    const key = this.dashboardCacheKey(module, extra);
    const requestKey = `${module}:${key.signalHash || 'latest'}:${key.careerStack}:${key.experienceLevel}:${forceRefresh ? 'refresh' : 'cache'}:${key.limit || ''}`;

    if (!forceRefresh) {
      try {
        const cached = this.frontendCache.get<T>(key);
        if (cached) return of(cached);
      } catch {
        /* Continue with an authenticated read if storage is unavailable. */
      }
      const active = this.activeRequests.get(requestKey);
      if (active) return active as Observable<T>;
    }

    const cycle = this.requestCycle;
    const request$ = producer().pipe(
      takeUntil(this.requestCancelled),
      tap((payload: any) => {
        if (!this.isActiveCycle(cycle)) return;
        const payloadSignalHash =
          payload?.dashboardContext?.signalHash ||
          payload?.signalMetadata?.signalHash ||
          payload?.signalHash ||
          this.signalHash ||
          key.signalHash;
        try {
          this.frontendCache.set(
            {
              ...key,
              signalHash: payloadSignalHash || 'no-signals',
              version: this.dashboardCacheVersion(module, payloadSignalHash),
            },
            payload,
          );
        } catch {
          // Storage denial/quota must not hide successfully fetched evidence.
        }
      }),
      finalize(() => this.activeRequests.delete(requestKey)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    if (!forceRefresh) this.activeRequests.set(requestKey, request$);
    return request$;
  }

  private dashboardCacheKey(
    module: string,
    extra: Partial<FrontendAnalysisCacheKey> = {},
  ): FrontendAnalysisCacheKey {
    return {
      module,
      careerStack: this.selectedCareerStack,
      experienceLevel: this.selectedExperienceLevel,
      signalHash: extra.signalHash || this.signalHash || '',
      ttlMs: 60_000,
      version:
        extra.version || this.dashboardCacheVersion(module, extra.signalHash || this.signalHash),
      ...extra,
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
      'dashboardIntegrationAnalytics',
    ].forEach((module) => {
      try {
        this.frontendCache.clearModule(module);
      } catch {
        /* Refresh still bypasses storage. */
      }
    });
    this.activeRequests.clear();
  }

  private normalizeReadinessCenter(raw: any): ReadinessCenterItem[] {
    const items = Array.isArray(raw) ? raw : [];
    if (items.length) {
      return items.map((item) => ({
        key: String(item?.key || item?.label || ''),
        label: String(item?.label || 'Readiness'),
        value: this.normalizeCoverage(item?.value),
        tone: String(item?.tone || 'primary'),
      }));
    }

    return [];
  }

  private normalizeCommandCenter(raw: any): CommandCenterAction[] {
    const items = Array.isArray(raw) ? raw : [];
    return items
      .map((item) => ({
        key: String(item?.key || item?.label || ''),
        label: String(item?.label || 'Priority'),
        value: String(item?.value || 'Not available yet'),
        source: String(item?.source || 'Dashboard'),
        route: String(item?.route || '/app/dashboard'),
      }))
      .slice(0, 6);
  }

  private normalizeSourceFreshness(raw: any): SourceFreshnessEntry[] {
    const labels: Record<string, string> = {
      github: 'GitHub',
      resume: 'Resume',
      skillGap: 'Skill Gap',
      recommendations: 'Recommendations',
      weeklyReports: 'Weekly Reports',
      jobs: 'Jobs',
      news: 'News',
      careerSprint: 'Career Sprint',
      learning: 'Learning Hub',
      integrations: 'Integrations',
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
        policy: item.policy,
        refreshRecommended: Boolean(item.refreshRecommended ?? status !== 'fresh'),
        reason: String(item.reason || ''),
      };
    });
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.themeObserver = new MutationObserver(() => this.refreshChartTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    setTimeout(() => {
      if (this.destroyed) return;
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
    this.destroyed = true;
    this.requestCycle += 1;
    this.requestCancelled.next();
    this.requestCancelled.complete();
    this.themeObserver?.disconnect();
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
      kaggle: 'Kaggle',
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
    const gridStroke = this.chartGridColor();
    const labelColor = this.chartColor('--text-secondary');

    this.radarInstance = new Chart(this.skillRadar.nativeElement, {
      type: 'radar',
      data: {
        labels: [
          ['Code', 'Quality'],
          ['Skill', 'Coverage'],
          ['Industry', 'Readiness'],
          ['Project', 'Impact'],
        ],
        datasets: [
          {
            label: 'Your Skills',
            data: [
              breakdown.codeQuality,
              breakdown.skillCoverage,
              breakdown.industryReadiness,
              breakdown.projectImpact,
            ],
            borderColor: '#4F46E5',
            backgroundColor: 'rgba(99, 102, 241, 0.16)',
            borderWidth: 2.25,
            pointBackgroundColor: '#4F46E5',
            pointBorderColor: this.chartColor('--bg-card'),
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#8B5CF6',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 4, right: 8, bottom: 4, left: 8 },
        },
        plugins: {
          legend: { display: false },
          tooltip: this.buildChartTooltipOptions(),
        },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { display: false, stepSize: 25 },
            grid: { color: gridStroke },
            angleLines: { color: gridStroke },
            pointLabels: {
              color: labelColor,
              font: { size: 10.5, weight: 600, family: 'Manrope, Inter, sans-serif' },
            },
          },
        },
      },
    });
  }

  readinessStatusLabel(value: number | null): string {
    if (value === null || Number.isNaN(value)) return 'Unavailable';
    if (value >= 80) return 'Strong';
    if (value >= 60) return 'On Track';
    return 'Building';
  }

  readinessToneClass(value: number | null): string {
    if (value === null || Number.isNaN(value)) return 'pill-muted';
    if (value >= 80) return 'pill-success';
    if (value >= 60) return 'pill-indigo';
    return 'pill-warning';
  }

  statStatusLabel(card: StatCard): string {
    if (this.isLoading) return 'Syncing';
    return card.value === null ? 'Unavailable' : 'Measured';
  }

  statSparkPath(iconType: StatCard['iconType']): string {
    switch (iconType) {
      case 'repos':
        return 'M2 24 C18 24, 24 14, 38 16 C50 18, 56 8, 72 11 C84 13, 94 20, 118 6';
      case 'stars':
        return 'M2 26 C20 22, 32 10, 48 15 C64 20, 74 12, 92 9 C104 7, 110 14, 118 8';
      case 'forks':
        return 'M2 22 C16 26, 30 12, 44 18 C58 24, 72 7, 88 12 C100 16, 108 9, 118 5';
      case 'followers':
      default:
        return 'M2 24 C20 18, 34 22, 50 13 C66 4, 80 17, 96 11 C106 7, 112 10, 118 7';
    }
  }

  freshnessStatusLabel(source: SourceFreshnessEntry): string {
    if (source.status === 'fresh') {
      return source.policy === 'durable-record' ? 'Saved' : 'Fresh';
    }
    if (source.status === 'missing') return 'No evidence';
    return 'Stale';
  }

  freshnessPillClass(status: string): string {
    if (status === 'fresh') return 'pill-success';
    if (status === 'missing') return 'pill-muted';
    if (status === 'incompatible') return 'pill-danger';
    return 'pill-warning';
  }

  get scoreTrendLabel(): string {
    if (this.scoreChangeFromLastMonth === null)
      return this.progress?.history.status === 'available'
        ? 'Comparable portfolio history below'
        : 'No comparable history';
    if (this.scoreChangeFromLastMonth === 0) return 'Portfolio unchanged from prior snapshot';
    const sign = this.scoreChangeFromLastMonth > 0 ? '+' : '';
    return `${sign}${this.scoreChangeFromLastMonth} portfolio pts vs prior snapshot`;
  }

  get scoreTrendUp(): boolean {
    return (this.scoreChangeFromLastMonth ?? 0) >= 0;
  }

  get scoreBreakdownRows(): { label: string; value: number | null }[] {
    const src = this.buildRadarBreakdown();
    return [
      { label: 'Code Quality', value: src.codeQuality },
      { label: 'Skill Coverage', value: src.skillCoverage },
      { label: 'Industry Readiness', value: src.industryReadiness },
      { label: 'Project Impact', value: src.projectImpact },
    ];
  }

  get profileSignalRows(): { label: string; value: number | null }[] {
    return [
      {
        label: 'GitHub Strength',
        value: this.sourcesUsed.github?.available ? this.normalizePercent(this.githubScore) : null,
      },
      {
        label: 'Resume ATS',
        value: this.sourcesUsed.resume?.available
          ? this.normalizeCoverage(this.resumeMetrics.atsScore)
          : null,
      },
      {
        label: 'Keyword Density',
        value: this.sourcesUsed.resume?.available
          ? this.normalizeCoverage(this.resumeMetrics.keywordDensity)
          : null,
      },
      { label: 'Skill Coverage', value: this.normalizeCoverage(this.coveragePercentage) },
    ];
  }

  get explainabilityRows(): { label: string; value: number | null; weight: number }[] {
    const scores = this.buildRadarBreakdown();
    const weights = this.getBreakdownWeights();
    return [
      {
        label: 'Code Quality',
        value: scores.codeQuality,
        weight: Math.round(weights['codeQuality'] * 100),
      },
      {
        label: 'Skill Coverage',
        value: scores.skillCoverage,
        weight: Math.round(weights['skillCoverage'] * 100),
      },
      {
        label: 'Industry Readiness',
        value: scores.industryReadiness,
        weight: Math.round(weights['industryReadiness'] * 100),
      },
      {
        label: 'Project Impact',
        value: scores.projectImpact,
        weight: Math.round(weights['projectImpact'] * 100),
      },
    ];
  }

  get dashboardIdentityLine(): string {
    const handle = this.githubHandle || 'Not connected';
    return `Active personal profile | Latest evidence: ${this.lastAnalyzed} | GitHub: ${handle}`;
  }

  get dashboardScoreLine(): string {
    if (this.isLoading) return 'Loading dashboard evidence…';
    return `Readiness Score: ${this.readinessAvailable ? Math.round(this.developerScore) : 'Unavailable'} | GitHub Score: ${this.sourcesUsed.github?.available ? Math.round(this.githubScore) : 'Unavailable'} | Integration Score: ${this.sourcesUsed.integrations?.available ? Math.round(this.integrationScore) : 'Unavailable'}`;
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
    gradient.addColorStop(0, 'rgba(79, 70, 229, 0.28)');
    gradient.addColorStop(0.55, 'rgba(99, 102, 241, 0.10)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

    this.activityInstance = new Chart(this.activityChart.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: '#4F46E5',
            backgroundColor: gradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.42,
            pointBackgroundColor: '#4F46E5',
            pointBorderColor: this.chartColor('--bg-card'),
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#8B5CF6',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...this.buildChartTooltipOptions(),
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} commit${ctx.parsed.y !== 1 ? 's' : ''}`,
            },
          },
        },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: this.chartColor('--text-secondary'),
              font: { size: 11, family: 'Manrope, Inter, sans-serif' },
            },
          },
          y: {
            display: true,
            min: 0,
            suggestedMax: Math.ceil(maxVal * 1.2),
            grid: { color: this.chartGridColor() },
            border: { display: false },
            ticks: {
              color: this.chartColor('--text-secondary'),
              font: { size: 10, family: 'Inter, sans-serif' },
              maxTicksLimit: 5,
              precision: 0,
            },
          },
        },
        layout: { padding: { top: 8, bottom: 4, left: 2, right: 6 } },
      },
    });
    this.cdr.detectChanges();
  }

  initLanguageChart(langData: Record<string, number>): void {
    if (!this.languageChart?.nativeElement) return;
    this.languageInstance?.destroy();

    const keys = Object.keys(langData).sort(
      (left, right) => Number(langData[right] || 0) - Number(langData[left] || 0),
    );
    const total = keys.reduce((sum, key) => sum + Number(langData[key] || 0), 0);
    const top = keys.slice(0, 4);
    const other = keys.slice(4).reduce((sum, key) => sum + Number(langData[key] || 0), 0);
    const labels = [...top, ...(other > 0 ? ['Other'] : [])];
    const values = [...top.map((key) => Number(langData[key] || 0)), ...(other > 0 ? [other] : [])];
    const colors = ['#4F46E5', '#8B5CF6', '#10B981', '#0EA5E9', '#64748B'];
    this.hasLanguageData = values.length > 0 && total > 0;

    this.languageLegend = labels.map((label, index) => ({
      label,
      percentage: total > 0 ? Math.round((values[index] / total) * 100) : 0,
      color: colors[index],
    }));

    this.languageInstance = new Chart(this.languageChart.nativeElement, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: 2,
            borderRadius: 4,
            spacing: 2,
            borderColor: this.chartColor('--bg-card'),
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: this.buildChartTooltipOptions(),
        },
      },
    });
  }

  private isDarkTheme(): boolean {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  private chartGridColor(): string {
    return this.isDarkTheme() ? 'rgba(148, 163, 184, 0.14)' : 'rgba(203, 213, 225, 0.55)';
  }

  private buildChartTooltipOptions() {
    const dark = this.isDarkTheme();
    return {
      backgroundColor: dark ? '#0F172A' : '#0F172A',
      titleColor: '#F8FAFC',
      bodyColor: '#E2E8F0',
      borderColor: dark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(15, 23, 42, 0.12)',
      borderWidth: 1,
      cornerRadius: 10,
      padding: 10,
      displayColors: true,
    };
  }

  private chartColor(token: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#64748b';
  }

  private refreshChartTheme(): void {
    const text = this.chartColor('--text-secondary');
    const gridStroke = this.chartGridColor();
    const cardBg = this.chartColor('--bg-card');
    const tooltipOpts = this.buildChartTooltipOptions();

    for (const chart of [this.radarInstance, this.activityInstance, this.languageInstance]) {
      if (!chart) continue;
      if (chart.options.plugins?.tooltip) {
        Object.assign(chart.options.plugins.tooltip, tooltipOpts);
      }
      for (const scale of Object.values(chart.options.scales || {})) {
        if (!scale) continue;
        if (scale.ticks) scale.ticks.color = text;
        if (scale.grid) scale.grid.color = gridStroke;
        if ('angleLines' in scale && scale.angleLines) scale.angleLines.color = gridStroke;
        if ('pointLabels' in scale && scale.pointLabels) scale.pointLabels.color = text;
      }
      const ds = chart.data.datasets[0] as unknown as Record<string, unknown>;
      if (ds) {
        if (chart === this.languageInstance) ds['borderColor'] = cardBg;
        if (chart === this.activityInstance || chart === this.radarInstance) {
          ds['pointBorderColor'] = cardBg;
        }
      }
      chart.update('none');
    }
  }

  private buildRadarBreakdown(): ScoreBreakdown {
    if (this.aiBreakdown) {
      return this.normalizeBreakdown(this.aiBreakdown);
    }

    return { codeQuality: null, skillCoverage: null, industryReadiness: null, projectImpact: null };
  }

  private normalizeBreakdown(value: any): ScoreBreakdown {
    return {
      codeQuality: this.normalizeCoverage(value?.codeQuality),
      skillCoverage: this.normalizeCoverage(value?.skillCoverage),
      industryReadiness: this.normalizeCoverage(value?.industryReadiness),
      projectImpact: this.normalizeCoverage(value?.projectImpact),
    };
  }

  private getBreakdownWeights(): Record<string, number> {
    if (this.recordedWeights) return this.recordedWeights;
    if ((this.snapshotCareerStack || this.selectedCareerStack) === 'Frontend') {
      return { codeQuality: 0.3, skillCoverage: 0.34, industryReadiness: 0.2, projectImpact: 0.16 };
    }
    if ((this.snapshotCareerStack || this.selectedCareerStack) === 'Backend') {
      return {
        codeQuality: 0.36,
        skillCoverage: 0.24,
        industryReadiness: 0.22,
        projectImpact: 0.18,
      };
    }
    if ((this.snapshotCareerStack || this.selectedCareerStack) === 'AI/ML') {
      return {
        codeQuality: 0.28,
        skillCoverage: 0.24,
        industryReadiness: 0.28,
        projectImpact: 0.2,
      };
    }
    return { codeQuality: 0.32, skillCoverage: 0.28, industryReadiness: 0.22, projectImpact: 0.18 };
  }

  private buildScoreReasons(): string[] {
    const reasons = this.explainabilityRows.map((row) =>
      row.value === null
        ? `${row.label} is unavailable; missing evidence does not establish zero.`
        : `${row.label}: ${row.weight}% portfolio weight; saved dimension ${row.value}%.`,
    );
    reasons.push(
      'Overall readiness uses the saved base score with an 85/15 integration blend when the integration score is positive.',
    );

    if (this.languageSource === 'language_bytes') {
      reasons.push(
        'Language distribution is based on real GitHub language-byte data across repositories.',
      );
    } else if (this.languageSource === 'primary_language') {
      reasons.push(
        'Language distribution is currently based on primary repo languages because byte data was unavailable.',
      );
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

  private normalizeCoverage(value: unknown): number | null {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '')
      return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? this.normalizePercent(parsed) : null;
  }

  private normalizePercent(value: number): number {
    const numeric = Number(value || 0);
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  private isActiveCycle(cycle: number): boolean {
    return !this.destroyed && this.requestCycle === cycle;
  }
}
