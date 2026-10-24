import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { AuthService } from './auth.service';

export * from '../models/recommendations.model';
import { RecommendationsResult } from '../models/recommendations.model';

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
  private savedPreviewCache: { userId: string; previews: SavedPreview[]; cachedAt: number } | null =
    null;
  private savedPreviewListRequest?: Observable<{ previews: SavedPreview[] }>;
  private inlineResumeIdentity(resumeText: string): string {
    // Do not retain raw resume text in a client-side request/cache key.
    let first = 0x811c9dc5;
    let second = 0x01000193;
    for (let index = 0; index < resumeText.length; index += 1) {
      const code = resumeText.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${resumeText.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
  }

  constructor(
    private readonly http: HttpClient,
    private readonly cacheInvalidation: FrontendCacheInvalidationService,
    private readonly auth: AuthService,
  ) {
    this.cacheInvalidation.register('recommendations', () => this.clearCache());
    this.cacheInvalidation.register('saved-previews', () => this.clearSavedPreviewCache());
  }

  private getProfileCacheKey(
    username: string,
    careerStack: string,
    experienceLevel: string,
  ): string {
    const userId = this.auth.getCurrentUser()?._id || 'anonymous';
    const cleanUsername = String(username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.+-]+/g, '-');
    const cleanStack = String(careerStack || '')
      .trim()
      .toLowerCase();
    const cleanLevel = String(experienceLevel || '')
      .trim()
      .toLowerCase();
    return `recommendations:profile:${userId}:${cleanUsername}:${cleanStack}:${cleanLevel}`;
  }

  clearCache(): void {
    this.inflight.clear();
    this.profileCache = null;
    this.profileCacheKey = '';
  }

  savePreview(payload: {
    module: SavedPreview['module'];
    title?: string;
    githubUsername: string;
    careerStack: string;
    experienceLevel: string;
    resumeHash: string;
    result: unknown;
  }): Observable<{ preview: SavedPreview }> {
    return this.http.post<{ preview: SavedPreview }>(
      `${this.baseUrl}/recommendations/saved-previews`,
      payload,
    );
  }

  listSavedPreviews(forceRefresh = false): Observable<{ previews: SavedPreview[] }> {
    const userId = String(this.auth.getCurrentUser()?._id || '').trim();
    if (!userId) return of({ previews: [] });

    const cache = this.savedPreviewCache;
    if (
      !forceRefresh &&
      cache?.userId === userId &&
      Date.now() - cache.cachedAt < SAVED_PREVIEWS_CACHE_TTL_MS
    ) {
      return of({ previews: cache.previews });
    }
    if (this.savedPreviewListRequest) return this.savedPreviewListRequest;

    let request$!: Observable<{ previews: SavedPreview[] }>;
    request$ = this.http
      .get<{ previews: SavedPreview[] }>(`${this.baseUrl}/recommendations/saved-previews`)
      .pipe(
        tap(({ previews }) => {
          if (String(this.auth.getCurrentUser()?._id || '').trim() !== userId) return;
          this.savedPreviewCache = {
            userId,
            previews: Array.isArray(previews) ? previews : [],
            cachedAt: Date.now(),
          };
        }),
        finalize(() => {
          if (this.savedPreviewListRequest === request$) this.savedPreviewListRequest = undefined;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    this.savedPreviewListRequest = request$;
    return request$;
  }

  cacheSavedPreview(preview: SavedPreview): SavedPreview[] {
    const userId = String(this.auth.getCurrentUser()?._id || '').trim();
    if (!userId) return [];
    const existing =
      this.savedPreviewCache?.userId === userId ? this.savedPreviewCache.previews : [];
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
    return this.http.delete<void>(
      `${this.baseUrl}/recommendations/saved-previews/${encodeURIComponent(id)}`,
    );
  }

  handoffToSprint(
    id: string,
    signalHash: string,
  ): Observable<{ sprintId: string; alreadyAdded: boolean; route: string }> {
    return this.http
      .post<{
        sprintId: string;
        alreadyAdded: boolean;
        route: string;
      }>(`${this.baseUrl}/recommendations/${encodeURIComponent(id)}/career-sprint`, { signalHash })
      .pipe(
        tap(() => {
          this.cacheInvalidation.clearCareerSprintCaches();
          this.cacheInvalidation.clearDashboardCaches();
          this.cacheInvalidation.clearWeeklyReportCaches();
        }),
      );
  }

  getRecommendations(
    username: string,
    careerStack: string,
    experienceLevel: string,
    knownSkills?: string[],
    missingSkills?: string[],
    isTemporary = false,
    forceRefresh = false,
    requestIdentity = '',
    resumeText?: string,
    previewResumeId?: string,
    resumeHash?: string,
  ): Observable<RecommendationsResult> {
    const cacheKey = this.getProfileCacheKey(username, careerStack, experienceLevel);
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
      resumeHash
        ? `resume-${resumeHash}`
        : resumeText
          ? `inline-${this.inlineResumeIdentity(resumeText)}`
          : 'no-resume',
    ]
      .join(':')
      .toLowerCase();
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const payload = isTemporary
      ? {
          githubUsername: username,
          careerStack,
          experienceLevel,
          knownSkills,
          missingSkills,
          isTemporary: true,
          forceRefresh,
          resumeText,
          previewResumeId,
          resumeHash,
        }
      : { username, careerStack, experienceLevel, forceRefresh };
    const request$ = this.http
      .post<RecommendationsResult>(
        isTemporary
          ? `${this.baseUrl}/recommendations/generate`
          : `${this.baseUrl}/recommendations`,
        payload,
      )
      .pipe(
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
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.inflight.set(key, request$);
    return request$;
  }
}
