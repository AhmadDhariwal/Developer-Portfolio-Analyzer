import { Injectable } from '@angular/core';
import { finalize, forkJoin, map, Observable, of, shareReplay, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { FrontendAnalysisCacheService, FrontendAnalysisCacheKey } from './frontend-analysis-cache.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

export interface WeeklyReportDataSourceStatus {
  connected?: boolean;
  analyzed?: boolean;
  available?: boolean;
  lastAnalyzedAt: string | null;
  status: string;
}

export interface WeeklyReport {
  _id: string;
  weekStartDate: string;
  weekEndDate: string;
  score: number;
  progressSummary: string;
  insights: string[];
  recommendations: string[];
  topAchievements: string[];
  biggestRiskArea: string;
  predictedHiringReadiness: { score: number; reason: string };
  reportText: string;
  emailStatus: 'sent' | 'skipped' | 'failed';
  emailedAt: string | null;
  emailError: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  fromFrontendCache?: boolean;
  cachedAt?: number | null;
  cacheExpiresAt?: number | null;
  meta: {
    githubScore: number;
    resumeScore: number;
    skillFocus: string[];
    activity: {
      repositoriesTracked: number;
      activeRepositories: number;
      commits: number;
      weeklyCommitSignal: number;
      stars: number;
      forks: number;
    };
    sprint: {
      tasksCompleted: number;
      tasksTotal: number;
      completionRate: number;
      weeklyGoal: number;
      streak: number;
    };
    interview: {
      sessions: number;
      questionsGenerated: number;
    };
    comparisons: {
      scoreDelta: number;
      readinessDelta: number;
      githubDelta: number;
      resumeDelta: number;
      sprintCompletionDelta: number;
      tasksCompletedDelta: number;
      interviewSessionsDelta: number;
      interviewQuestionsDelta: number;
      activityCommitsDelta: number;
      activeReposDelta: number;
      missingSkillsDelta: number;
      coverageDelta: number;
    };
    dataSourcesUsed: {
      github: WeeklyReportDataSourceStatus;
      resume: WeeklyReportDataSourceStatus;
      skillGap: WeeklyReportDataSourceStatus;
      recommendations: WeeklyReportDataSourceStatus;
      careerSprint: WeeklyReportDataSourceStatus;
      interviewPrep: WeeklyReportDataSourceStatus;
      portfolio: WeeklyReportDataSourceStatus;
      integrations: WeeklyReportDataSourceStatus;
    };
    signalHash: string;
    reportHash: string;
    narrativeSource: 'ai-enhanced' | 'deterministic' | 'cached';
    scoreBreakdown: Record<string, { label: string; score: number; weight: number }>;
  };
}

export interface WeeklyReportDashboard {
  latest: WeeklyReport | null;
  history: WeeklyReport[];
  fromFrontendCache?: boolean;
  cachedAt?: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class WeeklyReportService {
  private readonly cacheVersion = 'weekly-report-v2';
  private dashboardRequests = new Map<string, Observable<WeeklyReportDashboard>>();

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly cacheInvalidation: FrontendCacheInvalidationService
  ) {
    this.cacheInvalidation.register('weekly-reports', () => this.clearCache());
  }

  clearCache(): void {
    this.dashboardRequests.clear();
    this.frontendCache.clearModule('weeklyReports');
    this.frontendCache.clearModule('weeklyReports:latest');
    this.frontendCache.clearModule('weeklyReports:history');
  }

  generateReport(forceRefresh = true): Observable<WeeklyReport> {
    const cachedHistory = this.frontendCache.get<{ reports: WeeklyReport[] }>(this.historyCacheKey(6));
    if (forceRefresh) this.frontendCache.clearModule('weeklyReports');
    return this.api.generateWeeklyReport(forceRefresh).pipe(
      map((report) => this.normalizeReport(report)),
      tap((report) => {
        this.cacheLatest(report);
        this.frontendCache.set(this.historyCacheKey(6), {
          reports: this.mergeHistory(report, cachedHistory?.reports || [])
        });
        this.dashboardRequests.clear();
      })
    );
  }

  getLatest(): Observable<WeeklyReport | null> {
    return this.api.getWeeklyReportLatest().pipe(
      map((report) => (report ? this.normalizeReport(report) : null))
    );
  }

  getHistory(limit = 6): Observable<{ reports: WeeklyReport[] }> {
    return this.api.getWeeklyReportHistory(limit).pipe(
      map((response) => ({
        reports: Array.isArray(response?.reports) ? response.reports.map((report: unknown) => this.normalizeReport(report)) : []
      }))
    );
  }

  getDashboard(limit = 6, forceRefresh = false): Observable<WeeklyReportDashboard> {
    const requestKey = `${limit}:${forceRefresh ? 'refresh' : 'cache'}`;
    if (!forceRefresh) {
      const cached = this.getCachedDashboard(limit);
      if (cached) return of(cached);

      const activeRequest = this.dashboardRequests.get(requestKey);
      if (activeRequest) return activeRequest;
    }

    const request$ = forkJoin({
      latest: this.getLatest(),
      history: this.getHistory(limit)
    }).pipe(
      map(({ latest, history }) => ({
        latest,
        history: history.reports,
        fromFrontendCache: false,
        cachedAt: null
      })),
      tap((dashboard) => this.cacheDashboard(dashboard, limit)),
      finalize(() => this.dashboardRequests.delete(requestKey)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    if (!forceRefresh) this.dashboardRequests.set(requestKey, request$);
    return request$;
  }

  private normalizeReport(raw: any): WeeklyReport {
    const comparisons = raw?.meta?.comparisons || {};
    const dataSources = raw?.meta?.dataSourcesUsed || {};

    return {
      _id: String(raw?._id || ''),
      weekStartDate: String(raw?.weekStartDate || ''),
      weekEndDate: String(raw?.weekEndDate || ''),
      score: this.clamp(raw?.score),
      progressSummary: String(raw?.progressSummary || 'Weekly insights are being prepared.'),
      insights: this.normalizeStrings(raw?.insights, 6),
      recommendations: this.normalizeStrings(raw?.recommendations, 6),
      topAchievements: this.normalizeStrings(raw?.topAchievements, 4),
      biggestRiskArea: String(raw?.biggestRiskArea || 'No major risk identified for this period.'),
      predictedHiringReadiness: {
        score: this.clamp(raw?.predictedHiringReadiness?.score),
        reason: String(
          raw?.predictedHiringReadiness?.reason || 'Hiring readiness remains stable based on the available weekly signals.'
        )
      },
      reportText: String(raw?.reportText || ''),
      emailStatus: ['sent', 'skipped', 'failed'].includes(String(raw?.emailStatus || ''))
        ? raw.emailStatus
        : 'skipped',
      emailedAt: raw?.emailedAt || null,
      emailError: String(raw?.emailError || ''),
      createdAt: raw?.createdAt || null,
      updatedAt: raw?.updatedAt || null,
      meta: {
        githubScore: this.clamp(raw?.meta?.githubScore),
        resumeScore: this.clamp(raw?.meta?.resumeScore),
        skillFocus: this.normalizeStrings(raw?.meta?.skillFocus, 8),
        activity: {
          repositoriesTracked: this.number(raw?.meta?.activity?.repositoriesTracked),
          activeRepositories: this.number(raw?.meta?.activity?.activeRepositories),
          commits: this.number(raw?.meta?.activity?.commits),
          weeklyCommitSignal: this.number(raw?.meta?.activity?.weeklyCommitSignal),
          stars: this.number(raw?.meta?.activity?.stars),
          forks: this.number(raw?.meta?.activity?.forks)
        },
        sprint: {
          tasksCompleted: this.number(raw?.meta?.sprint?.tasksCompleted),
          tasksTotal: this.number(raw?.meta?.sprint?.tasksTotal),
          completionRate: this.clamp(raw?.meta?.sprint?.completionRate),
          weeklyGoal: this.number(raw?.meta?.sprint?.weeklyGoal),
          streak: this.number(raw?.meta?.sprint?.streak)
        },
        interview: {
          sessions: this.number(raw?.meta?.interview?.sessions),
          questionsGenerated: this.number(raw?.meta?.interview?.questionsGenerated)
        },
        comparisons: {
          scoreDelta: this.number(comparisons.scoreDelta),
          readinessDelta: this.number(comparisons.readinessDelta),
          githubDelta: this.number(comparisons.githubDelta),
          resumeDelta: this.number(comparisons.resumeDelta),
          sprintCompletionDelta: this.number(comparisons.sprintCompletionDelta),
          tasksCompletedDelta: this.number(comparisons.tasksCompletedDelta),
          interviewSessionsDelta: this.number(comparisons.interviewSessionsDelta),
          interviewQuestionsDelta: this.number(comparisons.interviewQuestionsDelta),
          activityCommitsDelta: this.number(comparisons.activityCommitsDelta),
          activeReposDelta: this.number(comparisons.activeReposDelta),
          missingSkillsDelta: this.number(comparisons.missingSkillsDelta),
          coverageDelta: this.number(comparisons.coverageDelta)
        },
        dataSourcesUsed: {
          github: this.normalizeSourceStatus(dataSources.github, false, true),
          resume: this.normalizeSourceStatus(dataSources.resume, true, false),
          skillGap: this.normalizeSourceStatus(dataSources.skillGap, true, false),
          recommendations: this.normalizeSourceStatus(dataSources.recommendations, false, false),
          careerSprint: this.normalizeSourceStatus(dataSources.careerSprint, false, true),
          interviewPrep: this.normalizeSourceStatus(dataSources.interviewPrep, true, false),
          portfolio: this.normalizeSourceStatus(dataSources.portfolio, false, true),
          integrations: this.normalizeSourceStatus(dataSources.integrations, false, true)
        },
        signalHash: String(raw?.meta?.signalHash || ''),
        reportHash: String(raw?.meta?.reportHash || ''),
        narrativeSource: this.normalizeNarrativeSource(raw?.meta?.narrativeSource),
        scoreBreakdown: this.normalizeScoreBreakdown(raw?.meta?.scoreBreakdown)
      }
    };
  }

  private getCachedDashboard(limit: number): WeeklyReportDashboard | null {
    const latest = this.frontendCache.get<WeeklyReport>(this.latestCacheKey());
    const history = this.frontendCache.get<{ reports: WeeklyReport[]; cachedAt?: number | null }>(this.historyCacheKey(limit));
    if (!latest || !history?.reports) return null;

    return {
      latest,
      history: history.reports,
      fromFrontendCache: true,
      cachedAt: latest.cachedAt || history.cachedAt || null
    };
  }

  private cacheDashboard(dashboard: WeeklyReportDashboard, limit: number): void {
    if (dashboard.latest) this.cacheLatest(dashboard.latest);
    this.frontendCache.set(this.historyCacheKey(limit), { reports: dashboard.history });
  }

  private cacheLatest(report: WeeklyReport): void {
    this.frontendCache.set(this.latestCacheKey(report), report);
  }

  private mergeHistory(report: WeeklyReport, history: WeeklyReport[]): WeeklyReport[] {
    return [report, ...(Array.isArray(history) ? history : []).filter((entry) => entry._id !== report._id)]
      .sort((left, right) => new Date(right.weekEndDate).getTime() - new Date(left.weekEndDate).getTime())
      .slice(0, 6);
  }

  private latestCacheKey(report?: WeeklyReport | null): FrontendAnalysisCacheKey {
    const currentUser = this.auth.getCurrentUser();
    return {
      module: 'weeklyReports:latest',
      userId: currentUser?._id,
      githubUsername: currentUser?.activeGithubUsername || currentUser?.githubUsername,
      careerStack: currentUser?.activeCareerStack || currentUser?.careerStack,
      experienceLevel: currentUser?.activeExperienceLevel || currentUser?.experienceLevel,
      weekStartDate: this.weekStartDate(report?.weekStartDate),
      signalHash: report?.meta?.signalHash || undefined,
      version: this.cacheVersion
    };
  }

  private historyCacheKey(limit: number): FrontendAnalysisCacheKey {
    const currentUser = this.auth.getCurrentUser();
    return {
      module: 'weeklyReports:history',
      userId: currentUser?._id,
      limit,
      version: this.cacheVersion
    };
  }

  private weekStartDate(value?: string | null): string {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10);
  }

  private normalizeNarrativeSource(value: any): 'ai-enhanced' | 'deterministic' | 'cached' {
    const source = String(value || '').trim();
    return source === 'ai-enhanced' || source === 'cached' ? source : 'deterministic';
  }

  private normalizeScoreBreakdown(raw: any): Record<string, { label: string; score: number; weight: number }> {
    if (!raw || typeof raw !== 'object') return {};
    return Object.entries(raw).reduce((accumulator, [key, value]) => {
      const item = value as any;
      accumulator[key] = {
        label: String(item?.label || key),
        score: this.clamp(item?.score),
        weight: this.number(item?.weight)
      };
      return accumulator;
    }, {} as Record<string, { label: string; score: number; weight: number }>);
  }

  private normalizeSourceStatus(raw: any, analyzed = false, connected = false): WeeklyReportDataSourceStatus {
    return {
      connected: connected ? Boolean(raw?.connected) : undefined,
      analyzed: analyzed ? Boolean(raw?.analyzed) : undefined,
      available: !analyzed && !connected ? Boolean(raw?.available) : undefined,
      lastAnalyzedAt: raw?.lastAnalyzedAt || null,
      status: String(raw?.status || 'Unavailable')
    };
  }

  private normalizeStrings(values: any, limit: number): string[] {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  private clamp(value: any): number {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }

  private number(value: any): number {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }
}
