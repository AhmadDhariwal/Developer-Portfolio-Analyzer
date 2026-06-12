import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';

export interface LanguageDistribution {
  language: string;
  percentage: number;
  bytes?: number;
}

export interface TechnologySignal {
  name: string;
  category: string;
  confidence: number;
  sources?: string[];
}

export interface TechnologyDistribution {
  technology: string;
  category: string;
  percentage: number;
  confidence: number;
}

export interface RepositoryActivity {
  repo: string;
  commits: number;
}

export interface Repository {
  name: string;
  description?: string;
  language: string;
  stars: number;
  forks: number;
  commits?: number;
  activityScore: number;
  qualityScore?: number;
  category?: string;
  technologies?: string[];
  hasReadme?: boolean;
  readmeQuality?: number;
  updatedAt?: string | null;
  pushedAt?: string | null;
}

export interface GitHubAnalysisResult {
  analysisVersion?: string;
  repoCount: number;
  totalStars: number;
  totalForks: number;
  followers?: number;
  activityScore: number;
  githubHealthScore?: number;
  developerLevel?: string;
  strengths?: string[];
  weakAreas?: string[];
  summary?: string;
  explanation?: string;
  cache?: {
    source: 'cache' | 'fresh' | 'stale-cache' | string;
    hit: boolean;
    expiresAt?: string | null;
    cachedAt?: string | null;
  };
  analysisHistory?: Array<Record<string, unknown>>;
  comparison?: Record<string, number | string | null> | null;
  rawLanguageBytes?: Record<string, number>;
  languageDistributionSource?: 'language_bytes' | 'primary_language';
  languageDistribution: LanguageDistribution[];
  mainLanguageDistribution?: LanguageDistribution[];
  supportLanguageDistribution?: LanguageDistribution[];
  technologies?: TechnologySignal[];
  technologyDistribution?: TechnologyDistribution[];
  technologyCategories?: Record<string, TechnologySignal[]>;
  repositoryActivity: RepositoryActivity[];
  repositories: Repository[];
  repositoryQuality?: Repository[];
  recruiterInsights?: {
    headline?: string;
    proofPoints?: string[];
    recruiterSummary?: string;
    interviewTalkingPoints?: string[];
  };
  githubSignals?: {
    analyzedAt?: string;
    [key: string]: unknown;
  };
  warning?: string;
  rateLimited?: boolean;
}

export interface ActiveUsername {
  username: string;
  isDefault: boolean;
  activeUsername?: string;
}

@Injectable({ providedIn: 'root' })
export class GithubService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly ttlMs = 24 * 60 * 60 * 1000;
  private readonly memoryCache = new Map<string, { result: GitHubAnalysisResult; expiresAt: number }>();
  private readonly inflight = new Map<string, Observable<GitHubAnalysisResult>>();

  constructor(
    private readonly http: HttpClient,
    private readonly frontendCache: FrontendAnalysisCacheService
  ) {}

  getCachedAnalysis(username: string, mode: 'public' | 'save'): GitHubAnalysisResult | null {
    const entry = this.memoryCache.get(this.cacheKey(username, mode));
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.result;
  }

  analyzeProfile(username: string, forceRefresh = false): Observable<GitHubAnalysisResult> {
    return this.cachedRequest('public', username, forceRefresh, () => this.http.post<GitHubAnalysisResult>(
      `${this.baseUrl}/github/analyze`,
      { username, forceRefresh }
    ));
  }

  analyzeAndSave(username: string, forceRefresh = false): Observable<GitHubAnalysisResult> {
    this.frontendCache.clearCurrentSignalHash();
    return this.cachedRequest('save', username, forceRefresh, () => this.http.post<GitHubAnalysisResult>(
      `${this.baseUrl}/github/analyze-save`,
      { username, forceRefresh }
    ));
  }

  getActiveUsername(): Observable<ActiveUsername> {
    return this.http.get<ActiveUsername>(`${this.baseUrl}/github/active-username`);
  }

  private cachedRequest(
    mode: 'public' | 'save',
    username: string,
    forceRefresh: boolean,
    requestFactory: () => Observable<GitHubAnalysisResult>
  ): Observable<GitHubAnalysisResult> {
    const key = this.cacheKey(username, mode);
    const cached = !forceRefresh ? this.memoryCache.get(key) : null;
    if (cached && cached.expiresAt > Date.now()) return of(cached.result);

    const inflightKey = `${key}:${forceRefresh ? 'refresh' : 'normal'}`;
    const existing = this.inflight.get(inflightKey);
    if (existing) return existing;

    const request$ = requestFactory().pipe(
      tap((result) => {
        this.memoryCache.set(key, {
          result,
          expiresAt: Date.now() + this.ttlMs
        });
      }),
      finalize(() => this.inflight.delete(inflightKey)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inflight.set(inflightKey, request$);
    return request$;
  }

  private cacheKey(username: string, mode: 'public' | 'save'): string {
    return `${mode}:${String(username || '').trim().replace(/^@/, '').toLowerCase()}`;
  }
}
