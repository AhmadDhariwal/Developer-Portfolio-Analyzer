import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, finalize, map, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import {
  Course,
  CourseProgressUpdate,
  CourseSprintResponse,
  LearningStatus,
  MyLearningResponse,
  UserCourseProgress,
  CourseFilters,
  CoursePlatform,
  CoursesResponse,
  normalizeCourseFilters,
} from '../models/course.model';

interface CourseCacheEntry {
  observable: Observable<CoursesResponse>;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class CourseService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly cache = new Map<string, CourseCacheEntry>();
  // Share only pending HTTP requests. Backend source identity must be rechecked on every later read.
  private readonly cacheTtlMs = 60 * 1000;
  private readonly maxCacheEntries = 50;

  constructor(
    private readonly http: HttpClient,
    private readonly cacheInvalidation: FrontendCacheInvalidationService,
  ) {
    this.cacheInvalidation.register('courses', () => this.clearCache());
  }

  getCourses(
    filters: Partial<CourseFilters> = {},
    page = 1,
    limit = 10,
    options: { refresh?: boolean } = {},
  ): Observable<CoursesResponse> {
    const normalizedFilters = normalizeCourseFilters(filters);
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(20, limit));
    const cacheKey = this.buildKey('courses', {
      ...normalizedFilters,
      page: safePage,
      limit: safeLimit,
      refresh: options.refresh || false,
    });
    let params = new HttpParams().set('page', String(safePage)).set('limit', String(safeLimit));

    if (options.refresh) params = params.set('refresh', 'true');
    if (normalizedFilters.platform !== 'All')
      params = params.set('platform', normalizedFilters.platform);
    if (normalizedFilters.rating) params = params.set('rating', normalizedFilters.rating);
    if (normalizedFilters.level !== 'All') params = params.set('level', normalizedFilters.level);
    if (normalizedFilters.duration !== 'All')
      params = params.set('duration', normalizedFilters.duration);
    if (normalizedFilters.topic) params = params.set('topic', normalizedFilters.topic);

    return this.once(
      cacheKey,
      this.http
        .get<CoursesResponse>(`${this.baseUrl}/courses`, { params })
        .pipe(map((response) => this.normalizeResponse(response, normalizedFilters, safePage))),
    );
  }

  getMyLearning(status?: LearningStatus, page = 1, limit = 50): Observable<MyLearningResponse> {
    let params = new HttpParams()
      .set('page', String(Math.max(1, page)))
      .set('limit', String(Math.max(1, Math.min(50, limit))));
    if (status) params = params.set('status', status);
    return this.http.get<MyLearningResponse>(`${this.baseUrl}/courses/my-learning`, { params });
  }

  saveProgress(courseId: string, update: CourseProgressUpdate): Observable<UserCourseProgress> {
    // Never send provider metadata or ownership fields to the progress endpoint.
    const body: CourseProgressUpdate = { status: update.status };
    if (update.notes !== undefined) body.notes = update.notes;
    if (update.progressPercent !== undefined) body.progressPercent = update.progressPercent;
    return this.http.put<UserCourseProgress>(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/progress`,
      body,
    );
  }

  removeProgress(courseId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/progress`,
    );
  }

  addToSprint(courseId: string): Observable<CourseSprintResponse> {
    return this.http
      .post<CourseSprintResponse>(
        `${this.baseUrl}/courses/${encodeURIComponent(courseId)}/career-sprint`,
        {},
      )
      .pipe(tap(() => this.cacheInvalidation.clearCareerSprintCaches()));
  }

  clearCache(): void {
    this.cache.clear();
  }

  invalidate(prefixes: string[] = ['courses']): void {
    for (const key of this.cache.keys()) {
      if (prefixes.some((prefix) => key.startsWith(`${prefix}:`))) this.cache.delete(key);
    }
  }

  private buildKey(prefix: string, params: Record<string, unknown>): string {
    const normalized = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
      .join('&');

    return `${prefix}:${normalized}`;
  }

  private once(key: string, source$: Observable<CoursesResponse>): Observable<CoursesResponse> {
    const now = Date.now();
    const existing = this.cache.get(key);

    if (existing && existing.expiresAt > now) {
      this.cache.delete(key);
      this.cache.set(key, existing);
      return existing.observable.pipe(
        map((response) => ({ ...response, fromFrontendCache: false })),
      );
    }
    if (existing) this.cache.delete(key);

    const shared$ = source$.pipe(
      catchError((error) => {
        if (this.cache.get(key)?.observable === shared$) this.cache.delete(key);
        return throwError(() => error);
      }),
      finalize(() => {
        if (this.cache.get(key)?.observable === shared$) this.cache.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.cache.set(key, { observable: shared$, expiresAt: now + this.cacheTtlMs });
    while (this.cache.size > this.maxCacheEntries) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return shared$;
  }

  private normalizeResponse(
    response: CoursesResponse | null | undefined,
    filters: CourseFilters,
    requestedPage: number,
  ): CoursesResponse {
    const seen = new Set<string>();
    const courses = (Array.isArray(response?.courses) ? response.courses : [])
      .map((course) => this.normalizeCourse(course))
      .filter((course): course is Course => Boolean(course))
      .filter((course) => {
        const key = `${course.id}|${course.url}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const total = Math.max(0, Number(response?.total ?? courses.length) || 0);
    const totalPages = Math.max(1, Number(response?.totalPages ?? 1) || 1);
    const page = Math.min(
      Math.max(1, Number(response?.page ?? requestedPage) || requestedPage),
      totalPages,
    );

    return {
      personalization: response?.personalization,
      requestedSkills: response?.requestedSkills,
      cacheMetadata: response?.cacheMetadata,
      courses,
      total,
      page,
      totalPages,
      hasMore: Boolean(response?.hasMore ?? page < totalPages),
      fromCache: Boolean(response?.fromCache),
      fromFrontendCache: false,
      recommendedBasedOn: response?.recommendedBasedOn
        ? {
            ...response.recommendedBasedOn,
            activeFilters: normalizeCourseFilters(
              response.recommendedBasedOn.activeFilters || filters,
            ),
            skillGapsUsed: Array.isArray(response.recommendedBasedOn.skillGapsUsed)
              ? response.recommendedBasedOn.skillGapsUsed
                  .map((value) => String(value || '').trim())
                  .filter(Boolean)
              : [],
            summary: String(response.recommendedBasedOn.summary || '').trim(),
            sourceMessage: String(response.recommendedBasedOn.sourceMessage || '').trim(),
          }
        : null,
    };
  }

  private normalizeCourse(course: Partial<Course> | null | undefined): Course | null {
    const id = String(course?.id || '').trim();
    const title = String(course?.title || '').trim();
    const platform = String(course?.platform || '').trim() as CoursePlatform;
    const url = String(course?.url || '').trim();
    const validPlatforms: CoursePlatform[] = [
      'Udemy',
      'Coursera',
      'YouTube',
      'edX',
      'freeCodeCamp',
    ];

    if (!id || !title || !validPlatforms.includes(platform) || !/^https?:\/\//i.test(url))
      return null;

    const topics = Array.isArray(course?.topics)
      ? [...new Set(course.topics.map((topic) => String(topic || '').trim()).filter(Boolean))]
      : [];
    const numeric = (value: unknown): number | null | undefined => {
      if (value === null) return null;
      if (value === undefined || value === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };

    const rating = numeric(course?.rating);

    return {
      id,
      title,
      platform,
      url,
      topics,
      description: String(course?.description || '').trim() || undefined,
      instructor: String(course?.instructor || '').trim() || undefined,
      rating,
      reviewCount: numeric(course?.reviewCount),
      duration: String(course?.duration || '').trim() || undefined,
      durationHours: numeric(course?.durationHours),
      level: course?.level,
      thumbnail: String(course?.thumbnail || '').trim() || undefined,
      popularity: numeric(course?.popularity),
      relevanceScore: numeric(course?.relevanceScore) ?? undefined,
      finalScore: numeric(course?.finalScore) ?? undefined,
      whyRecommended: String(course?.whyRecommended || '').trim() || undefined,
      platformColor: course?.platformColor,
      provenance: course?.provenance,
      engagementScore: numeric(course?.engagementScore),
      viewCount: numeric(course?.viewCount),
      likeCount: numeric(course?.likeCount),
      matchedRequiredTargets: course?.matchedRequiredTargets,
      matchedTargets: course?.matchedTargets,
      matchedCareerSkills: course?.matchedCareerSkills,
    };
  }
}
