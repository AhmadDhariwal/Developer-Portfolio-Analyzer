import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { AuthService } from './auth.service';

export interface RecommendedProject {
  id:             string;
  title:          string;
  description:    string;
  tech:           string[];
  newTech:        string[];   // subset of tech[] that are new to the user
  difficulty:     'Beginner' | 'Intermediate' | 'Advanced';
  estimatedWeeks: string;
  impact:         number;
  whyThisProject: string;     // explanation of level fit
  triggerSkills:  string[];
  startUrl?:      string;
  priority?: string;
  confidenceScore?: number;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number;
  estimatedEffort?: string;
}

export interface RecommendedTechnology {
  name:        string;
  category:    string;
  priority:    string;
  priorityRaw: 'High' | 'Medium' | 'Low';
  jobDemand:   number;
  description: string;
  confidenceScore?: number;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number;
  estimatedEffort?: string;
}

export interface CareerPath {
  id:              string;
  title:           string;
  salaryRange:     string;
  timeline:        string;
  description:     string;
  hiringCompanies: string[];
  actionItems:     string[];
  boostSkills:     string[];
  match:           number;
  exploreUrl?:     string;
  priority?: string;
  confidenceScore?: number;
  reason?: string;
  evidence?: string[];
  sourceSignalsUsed?: string[];
  estimatedImpact?: number;
  estimatedEffort?: string;
}

export interface RecommendationCard {
  id: string;
  category: string;
  title: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low' | string;
  confidenceScore: number;
  reason: string;
  evidence: string[];
  sourceSignalsUsed: string[];
  estimatedImpact: number;
  estimatedEffort: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface RecommendationScores {
  readinessScore: number;
  portfolioScore: number;
  learningScore: number;
  interviewScore: number;
  marketReadinessScore: number;
  careerGrowthScore: number;
  overallRecommendationScore: number;
  explanation?: Record<string, string>;
}

export interface RecommendationRoadmap {
  immediateActions: RecommendationCard[];
  next30Days: RecommendationCard[];
  next60Days: RecommendationCard[];
  next90Days: RecommendationCard[];
  longTermGrowth: RecommendationCard[];
  suggestedProjects: RecommendedProject[];
  suggestedCertifications: RecommendationCard[];
  suggestedTechnologies: RecommendedTechnology[];
  suggestedLearningPath: string[];
  timeline?: Array<{ label: string; items: string[] }>;
}

export interface RecommendationCacheMetadata {
  loadedFromCache?: boolean;
  cacheKey?: {
    githubUsername?: string;
    careerStack?: string;
    experienceLevel?: string;
    resumeHash?: string;
    resumeAnalysisId?: string;
    signalHash?: string;
    analysisVersion?: string;
  };
  signalHash?: string;
  analysisVersion?: string;
  recommendationVersion?: string;
  temporary?: boolean;
  ttlHours?: number;
  cachedAt?: string | null;
}

export interface RecommendationSignalsUsed {
  github: {
    connected: boolean;
    username: string;
    repoCount: number;
    developerLevel: string;
  };
  resume: {
    analyzed: boolean;
    analysisId?: string;
    atsScore: number;
    experienceLevel: string;
    fileName?: string;
    lastAnalyzedAt?: string | null;
    extractedSkills?: string[];
    experienceKeywords?: string[];
    strengths?: string[];
    weaknesses?: string[];
    missingSections?: string[];
    statusMessage?: string;
  };
  portfolio: {
    present: boolean;
    completenessScore: number;
    projectCount: number;
    liveLinkCount: number;
  };
  integrations: {
    providers: string[];
    score: number;
    strongestProof: string[];
  };
  weeklyProgress: {
    status: string;
    score: number;
    trendDelta: number;
  };
  careerSprint: {
    consistencyScore: number;
    streak: number;
    activeLearningFocus: string;
  };
  skillGap?: {
    present: boolean;
    coverage: number;
    knownSkills: string[];
    missingSkills: string[];
    weakSkills: string[];
    highDemandSkills: Array<{ name: string; demandScore?: number; postings?: number }>;
    updatedAt?: string | null;
  };
  careerProfile?: {
    careerStack: string;
    experienceLevel: string;
    careerGoal: string;
  };
  jobsDemand?: {
    sampledJobs: number;
    topSkills: Array<{ name: string; demandScore: number; postings: number }>;
  };
}

export interface AnalysisBasedOn {
  githubUsername: string;
  resumeAnalyzed: boolean;
  resumeStatus: string;
  careerStack: string;
  experienceLevel: string;
  lastAnalyzedAt?: string | null;
}

export interface RecommendationDataQuality {
  hasGitHubData: boolean;
  hasResumeData: boolean;
  hasSkillGapData: boolean;
  hasPortfolioData: boolean;
  hasJobMarketData: boolean;
  dataCompleteness: number;
  scoreAvailability: Partial<Record<keyof RecommendationScores, boolean>>;
}

export interface RecommendationsResult {
  username:        string;
  careerStack:     string;
  experienceLevel: string;
  projects:        RecommendedProject[];
  technologies:    RecommendedTechnology[];
  careerPaths:     CareerPath[];
  analysisSummary?: string;
  portfolioRecommendations?: string[];
  resumeRecommendations?: string[];
  learningActions?: string[];
  interviewReadinessActions?: string[];
  signalsUsed?: RecommendationSignalsUsed;
  analysisBasedOn?: AnalysisBasedOn;
  resumeStatusMessage?: string;
  claimedButNotProvenSkills?: string[];
  githubSkills?: string[];
  resumeSkills?: string[];
  recommendationScores?: RecommendationScores;
  dataQuality?: RecommendationDataQuality;
  structuredRecommendations?: Record<string, RecommendationCard[]>;
  roadmap?: RecommendationRoadmap;
  recommendationSignals?: Record<string, unknown>;
  recommendationVersioning?: {
    currentRecommendation?: Record<string, unknown>;
    previousRecommendation?: Record<string, unknown> | null;
    delta?: Record<string, number>;
    newRecommendations?: RecommendationCard[];
    completedRecommendations?: RecommendationCard[];
    obsoleteRecommendations?: RecommendationCard[];
  };
  cacheMetadata?: RecommendationCacheMetadata;
  fromCache?: boolean;
  fromFrontendCache?: boolean;
  cacheState?: 'cache-hit' | 'refreshing' | 'loading' | 'error' | 'empty';
}

const SAVED_PREVIEWS_CACHE_TTL_MS = 7 * 60 * 1000;

export interface SavedPreview {
  _id: string;
  title: string;
  githubUsername: string;
  careerStack: string;
  experienceLevel: string;
  resumeHash: string;
  source: 'preview';
  module: 'skill-gap' | 'recommendations';
  resultSummary: Record<string, any>;
  createdAt: string;
}
@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly inflight = new Map<string, Observable<RecommendationsResult>>();
  private profileCache: { value: RecommendationsResult; cachedAt: number } | null = null;
  private profileCacheKey = '';
  private savedPreviewCache: { userId: string; previews: SavedPreview[]; cachedAt: number } | null = null;
  private savedPreviewListRequest?: Observable<{ previews: SavedPreview[] }>;

  constructor(
    private readonly http: HttpClient,
    private readonly cacheInvalidation: FrontendCacheInvalidationService,
    private readonly auth: AuthService
  ) {
    this.cacheInvalidation.register('recommendations', () => this.clearCache());
    this.cacheInvalidation.register('saved-previews', () => this.clearSavedPreviewCache());
  }

  private getProfileCacheKey(username: string): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_.+-]+/g, '-');
    return `recommendations:profile:${userId}:${cleanUsername}`;
  }

  clearCache(): void {
    this.inflight.clear();
    this.profileCache = null;
    this.profileCacheKey = '';
  }

  savePreview(payload: { module: SavedPreview['module']; title?: string; githubUsername: string; careerStack: string; experienceLevel: string; resumeHash: string; result: unknown }): Observable<{ preview: SavedPreview }> {
    return this.http.post<{ preview: SavedPreview }>(`${this.baseUrl}/recommendations/saved-previews`, payload);
  }

  listSavedPreviews(forceRefresh = false): Observable<{ previews: SavedPreview[] }> {
    const userId = String(this.auth.getCurrentUser()?._id || '').trim();
    if (!userId) return of({ previews: [] });

    const cache = this.savedPreviewCache;
    if (!forceRefresh && cache?.userId === userId && Date.now() - cache.cachedAt < SAVED_PREVIEWS_CACHE_TTL_MS) {
      return of({ previews: cache.previews });
    }
    if (this.savedPreviewListRequest) return this.savedPreviewListRequest;

    let request$!: Observable<{ previews: SavedPreview[] }>;
    request$ = this.http.get<{ previews: SavedPreview[] }>(`${this.baseUrl}/recommendations/saved-previews`).pipe(
      tap(({ previews }) => {
        if (String(this.auth.getCurrentUser()?._id || '').trim() !== userId) return;
        this.savedPreviewCache = {
          userId,
          previews: Array.isArray(previews) ? previews : [],
          cachedAt: Date.now()
        };
      }),
      finalize(() => {
        if (this.savedPreviewListRequest === request$) this.savedPreviewListRequest = undefined;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.savedPreviewListRequest = request$;
    return request$;
  }

  cacheSavedPreview(preview: SavedPreview): SavedPreview[] {
    const userId = String(this.auth.getCurrentUser()?._id || '').trim();
    if (!userId) return [];
    const existing = this.savedPreviewCache?.userId === userId ? this.savedPreviewCache.previews : [];
    const previews = [preview, ...existing.filter((item) => item._id !== preview._id)];
    this.savedPreviewCache = { userId, previews, cachedAt: Date.now() };
    return previews;
  }

  removeSavedPreviewFromCache(id: string): SavedPreview[] {
    const userId = String(this.auth.getCurrentUser()?._id || '').trim();
    if (!userId || this.savedPreviewCache?.userId !== userId) return [];
    const previews = this.savedPreviewCache.previews.filter((item) => item._id !== id);
    this.savedPreviewCache = { userId, previews, cachedAt: Date.now() };
    return previews;
  }

  clearSavedPreviewCache(): void {
    this.savedPreviewCache = null;
    this.savedPreviewListRequest = undefined;
  }

  deleteSavedPreview(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/recommendations/saved-previews/${encodeURIComponent(id)}`);
  }

  getRecommendations(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    knownSkills?:    string[],
    missingSkills?:  string[],
    isTemporary = false,
    forceRefresh = false,
    requestIdentity = '',
    resumeText?:     string,
    previewResumeId?: string,
    resumeHash?: string
  ): Observable<RecommendationsResult> {
    const cacheKey = this.getProfileCacheKey(username);
    const ttlMs = 15 * 60 * 1000; // 15 minutes TTL
    if (!isTemporary && !forceRefresh && this.profileCache && this.profileCacheKey === cacheKey) {
      const age = Date.now() - this.profileCache.cachedAt;
      if (age < ttlMs) {
        return of(this.profileCache.value);
      }
    }

    const key = [
      username,
      careerStack,
      experienceLevel,
      isTemporary ? 'temporary' : 'saved',
      forceRefresh ? 'refresh' : 'normal',
      requestIdentity,
      (knownSkills || []).join(','),
      (missingSkills || []).join(','),
      resumeHash ? `resume-${resumeHash}` : (resumeText ? `inline-${resumeText.length}` : 'no-resume')
    ].join(':').toLowerCase();
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const payload = isTemporary
      ? { githubUsername: username, careerStack, experienceLevel, knownSkills, missingSkills, isTemporary: true, forceRefresh, resumeText, previewResumeId, resumeHash }
      : { username, careerStack, experienceLevel, forceRefresh };
    const request$ = this.http.post<RecommendationsResult>(
      isTemporary ? `${this.baseUrl}/recommendations/generate` : `${this.baseUrl}/recommendations`,
      payload
    ).pipe(
      tap((result) => {
        if (!isTemporary) {
          this.profileCache = { value: result, cachedAt: Date.now() };
          this.profileCacheKey = cacheKey;

          this.cacheInvalidation.clearScenarioCaches();
          this.cacheInvalidation.clearNewsCaches();
          this.cacheInvalidation.clearJobsCaches();
          this.cacheInvalidation.clearCoursesCaches();
          this.cacheInvalidation.clearDashboardCaches();
          this.cacheInvalidation.clearWeeklyReportCaches();
        }
      }),
      finalize(() => this.inflight.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inflight.set(key, request$);
    return request$;
  }
}
