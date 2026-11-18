import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, filter, finalize, shareReplay, tap } from 'rxjs/operators';
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
  private cacheRevision = 0;
  private savedPreviewRevision = 0;
  private savedPreviewRequestOwner = '';
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

  clearCache(): void {
    this.cacheRevision += 1;
    this.inflight.clear();
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
    if (this.savedPreviewListRequest && this.savedPreviewRequestOwner === userId)
      return this.savedPreviewListRequest;
    const revision = this.savedPreviewRevision;

    let request$!: Observable<{ previews: SavedPreview[] }>;
    request$ = this.http
      .get<{ previews: SavedPreview[] }>(`${this.baseUrl}/recommendations/saved-previews`)
      .pipe(
        filter(
          () =>
            revision === this.savedPreviewRevision &&
            String(this.auth.getCurrentUser()?._id || '').trim() === userId,
        ),
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
    this.savedPreviewRequestOwner = userId;
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
    this.savedPreviewRevision += 1;
    this.savedPreviewRequestOwner = '';
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
    const revision = this.cacheRevision;
    const ownerId = this.auth.getCurrentUser()?._id || 'anonymous';
    // Browser age cannot establish that persisted source revisions still match.
    // Share pending reads below; let the server validate every completed read.

    const key = JSON.stringify([
      ownerId,
      username,
      careerStack,
      experienceLevel,
      isTemporary ? 'temporary' : 'saved',
      forceRefresh ? 'refresh' : 'normal',
      requestIdentity,
      (knownSkills || []).join(','),
      (missingSkills || []).join(','),
      previewResumeId || '',
      resumeHash
        ? `resume-${resumeHash}`
        : resumeText
          ? `inline-${this.inlineResumeIdentity(resumeText)}`
          : 'no-resume',
    ]);
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
    const isCurrent = () =>
      revision === this.cacheRevision &&
      (this.auth.getCurrentUser()?._id || 'anonymous') === ownerId;
    const profileUrl = `${this.baseUrl}/recommendations`;
    let request$!: Observable<RecommendationsResult>;
    request$ = this.http
      .post<RecommendationsResult>(isTemporary ? `${profileUrl}/generate` : profileUrl, payload)
      .pipe(
        catchError((error) => {
          if (!isCurrent()) return of();
          if (isTemporary || error.status !== 409) return throwError(() => error);
          // A second conflict is surfaced. Recovery only requests current deterministic evidence.
          return this.http.post<RecommendationsResult>(profileUrl, { forceRefresh: false });
        }),
        filter(isCurrent),
        tap((result) => {
          if (!isTemporary) {
            this.cacheInvalidation.clearScenarioCaches();
            this.cacheInvalidation.clearNewsCaches();
            this.cacheInvalidation.clearJobsCaches();
            this.cacheInvalidation.clearCoursesCaches();
            this.cacheInvalidation.clearDashboardCaches();
            this.cacheInvalidation.clearWeeklyReportCaches();
          }
        }),
        finalize(() => {
          if (this.inflight.get(key) === request$) this.inflight.delete(key);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.inflight.set(key, request$);
    return request$;
  }
}
