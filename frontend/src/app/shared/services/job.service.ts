import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  of,
  Subject,
  catchError,
  finalize,
  map,
  takeUntil,
  tap,
  throwError,
  distinctUntilChanged,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { safeJobUrl } from '../utils/job-presentation';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { Job, JobFilters, JobsResponse, normalizeJobFilters } from '../models/job.model';

@Injectable({ providedIn: 'root' })
export class JobService {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly cacheTtlMs = 30 * 1000;
  private readonly maxCacheEntries = 20;
  private readonly cache = new Map<
    string,
    { value$: Observable<unknown>; expiresAt: number; value?: unknown }
  >();

  private readonly cancelled = new Subject<void>();
  constructor(
    private readonly http: HttpClient,
    private readonly cacheInvalidation: FrontendCacheInvalidationService,
    private readonly auth: AuthService,
  ) {
    this.cacheInvalidation.register('jobs', () => this.clearCache());
    this.auth.currentUser$
      .pipe(
        map(() => this.contextKey()),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.clearCache());
  }

  getJobs(filters: Partial<JobFilters> = {}, page = 1, limit = 10): Observable<JobsResponse> {
    const normalizedFilters = normalizeJobFilters(filters);
    const cacheKey = this.buildKey('jobs', {
      ...normalizedFilters,
      page: Math.max(1, page),
      limit: Math.min(20, Math.max(1, limit)),
    });
    let params = new HttpParams()
      .set('page', String(Math.max(1, page)))
      .set('limit', String(Math.min(20, Math.max(1, limit))));

    if (normalizedFilters.platform !== 'All') {
      params = params.set('platform', normalizedFilters.platform);
    }
    if (normalizedFilters.location !== 'All') {
      params = params.set('location', normalizedFilters.location);
    }
    if (normalizedFilters.skills) {
      params = params.set('skills', normalizedFilters.skills);
    }
    if (normalizedFilters.jobType !== 'All') {
      params = params.set('jobType', normalizedFilters.jobType);
    }
    if (normalizedFilters.experienceLevel !== 'All') {
      params = params.set('expLevel', normalizedFilters.experienceLevel);
    }

    return this.once(
      cacheKey,
      this.http
        .get<JobsResponse>(`${this.baseUrl}/jobs`, { params })
        .pipe(map((response) => this.normalizeResponse(response, normalizedFilters, page))),
    );
  }

  getJobById(id: string): Observable<Job> {
    return this.once(
      this.buildKey('job-detail', { id: String(id || '').trim() }),
      this.http
        .get<{ job?: Partial<Job> }>(`${this.baseUrl}/jobs/${encodeURIComponent(id)}`)
        .pipe(map((response) => this.normalizeJob(response?.job, 0))),
    );
  }

  clearCache(): void {
    this.cancelled.next();
    this.cache.clear();
  }

  invalidate(prefixes: string[] = ['jobs', 'job-detail']): void {
    for (const [key] of this.cache) {
      if (prefixes.some((prefix) => key.startsWith(`${prefix}:`))) {
        this.cache.delete(key);
      }
    }
  }

  private buildKey(prefix: string, params: Record<string, unknown>): string {
    const normalized = Object.entries({ ...params, context: this.contextKey() })
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
      .join('&');

    return `${prefix}:${normalized}`;
  }

  private once<T>(key: string, source$: Observable<T>): Observable<T> {
    const now = Date.now();
    this.pruneCache(now);
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > now) {
      this.cache.delete(key);
      this.cache.set(key, existing);
      if (existing.value !== undefined)
        return of(this.markFrontendCacheHit(structuredClone(existing.value as T)));
      return (existing.value$ as Observable<T>).pipe(
        map((value) => this.markFrontendCacheHit(value)),
      );
    }

    let completed = false;
    const shared$ = source$.pipe(
      tap({
        next: () => {
          completed = true;
        },
      }),
      catchError((error) => {
        this.cache.delete(key);
        return throwError(() => error);
      }),
      takeUntil(this.cancelled),
      tap((value) => {
        const entry = this.cache.get(key);
        if (entry) {
          entry.expiresAt = Date.now() + this.cacheTtlMs;
          entry.value = structuredClone(value);
        }
      }),
      finalize(() => {
        if (!completed && this.cache.get(key)?.value$ === shared$) this.cache.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.cache.set(key, { value$: shared$, expiresAt: now + this.cacheTtlMs });
    this.pruneCache(now);
    return shared$.pipe(map((value) => structuredClone(value)));
  }

  private pruneCache(now = Date.now()): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private markFrontendCacheHit<T>(value: T): T {
    if (value && typeof value === 'object' && 'jobs' in (value as object)) {
      return { ...structuredClone(value as object), frontendCached: true } as T;
    }
    return structuredClone(value);
  }

  private contextKey(): string {
    const user = this.auth.getCurrentUser() as unknown as Record<string, unknown> | null;
    return JSON.stringify([
      user?.['_id'] || user?.['id'] || '',
      user?.['activeGithubUsername'],
      user?.['activeCareerStack'] || user?.['careerStack'],
      user?.['activeExperienceLevel'] || user?.['experienceLevel'],
      user?.['activeResumeFileId'] || user?.['defaultResumeFileId'],
      user?.['updatedAt'],
    ]);
  }

  private normalizeResponse(
    response: JobsResponse | null | undefined,
    filters: JobFilters,
    requestedPage: number,
  ): JobsResponse {
    const jobs = Array.isArray(response?.jobs)
      ? response!.jobs.map((job, index) => this.normalizeJob(job, index))
      : [];
    const total = Number(response?.total ?? jobs.length) || 0;
    const totalPages = Math.max(1, Number(response?.totalPages ?? 1) || 1);
    const page = Math.min(
      Math.max(1, Number(response?.page ?? requestedPage) || requestedPage),
      totalPages,
    );

    return {
      ...response,
      jobs,
      total,
      page,
      totalPages,
      hasMore: Boolean(response?.hasMore ?? page < totalPages),
      fromCache: Boolean(response?.fromCache),
      sourceMessage: String(response?.sourceMessage || '').trim(),
      primarySource: String(response?.primarySource || '').trim(),
      sourceSummary: response?.sourceSummary || {},
      sourceFailures: Array.isArray(response?.sourceFailures) ? response.sourceFailures : [],
      cacheCount: Number(response?.cacheCount ?? 0) || 0,
      warning: String(response?.warning || '').trim(),
      jsearchConfigured: response?.jsearchConfigured,
      joobleConfigured: response?.joobleConfigured,
      diagnostics: response?.diagnostics,
      recommendedBasedOn: response?.recommendedBasedOn
        ? {
            ...response.recommendedBasedOn,
            activeFilters: {
              platform: response.recommendedBasedOn.activeFilters?.platform || filters.platform,
              location: response.recommendedBasedOn.activeFilters?.location || filters.location,
              skills: String(
                response.recommendedBasedOn.activeFilters?.skills || filters.skills || '',
              ).trim(),
              jobType: response.recommendedBasedOn.activeFilters?.jobType || filters.jobType,
              experienceLevel:
                response.recommendedBasedOn.activeFilters?.experienceLevel ||
                filters.experienceLevel,
            },
            knownSkills: Array.isArray(response.recommendedBasedOn.knownSkills)
              ? response.recommendedBasedOn.knownSkills
              : [],
            skillGaps: Array.isArray(response.recommendedBasedOn.skillGaps)
              ? response.recommendedBasedOn.skillGaps
              : [],
            resumeSkills: Array.isArray(response.recommendedBasedOn.resumeSkills)
              ? response.recommendedBasedOn.resumeSkills
              : [],
            githubSkills: Array.isArray(response.recommendedBasedOn.githubSkills)
              ? response.recommendedBasedOn.githubSkills
              : [],
            summary: String(response.recommendedBasedOn.summary || '').trim(),
          }
        : null,
    };
  }

  private normalizeJob(job: Partial<Job> | null | undefined, _index: number): Job {
    const url = safeJobUrl(job?.url);
    const applyUrl = safeJobUrl(job?.applyUrl) || url;
    const recommendedCourse = job?.recommendedCourse
      ? {
          title: String(job.recommendedCourse.title || '').trim(),
          platform: String(job.recommendedCourse.platform || '').trim(),
          url: safeJobUrl(job.recommendedCourse.url),
          whyRecommended: String(job.recommendedCourse.whyRecommended || '').trim(),
        }
      : null;
    const recommendedSprintTask = job?.recommendedSprintTask
      ? {
          title: String(job.recommendedSprintTask.title || '').trim(),
          description: String(job.recommendedSprintTask.description || '').trim(),
          category: String(job.recommendedSprintTask.category || '').trim(),
          priority: String(job.recommendedSprintTask.priority || '').trim(),
          points: Number(job.recommendedSprintTask.points || 0),
        }
      : null;

    return {
      ...job,
      id: String(job?.id || job?.externalJobId || job?.applyUrl || job?.url || '').trim(),
      externalJobId: String(job?.externalJobId || '').trim(),
      title: String(job?.title || '').trim(),
      company: String(job?.company || '').trim(),
      companyLogo: String(job?.companyLogo || '').trim(),
      location: String(job?.location || '').trim(),
      salary: String(job?.salary || '').trim(),
      jobType: String(job?.jobType || '').trim(),
      skills: Array.isArray(job?.skills)
        ? job!.skills
            .map((skill) => String(skill || '').trim())
            .filter(Boolean)
            .slice(0, 8)
        : [],
      postedDate: String(job?.postedDate || '').trim(),
      description: String(job?.description || '').trim(),
      requirements: Array.isArray(job?.requirements)
        ? job!.requirements
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 14)
        : [],
      benefits: Array.isArray(job?.benefits)
        ? job!.benefits
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 10)
        : [],
      platform: (job?.platform || '') as Job['platform'],
      url,
      applyUrl,
      experienceLevel: String(job?.experienceLevel || '').trim(),
      source: String(job?.source || '').trim(),
      score: Number(job?.score ?? 0) || 0,
      matchScore:
        typeof job?.matchScore === 'number' && Number.isFinite(job.matchScore)
          ? job.matchScore
          : undefined,
      experienceMatch: Number(job?.experienceMatch ?? 0) || 0,
      skillMatch: Number(job?.skillMatch ?? 0) || 0,
      missingSkills: Array.isArray(job?.missingSkills)
        ? job!.missingSkills
            .map((skill) => String(skill || '').trim())
            .filter(Boolean)
            .slice(0, 5)
        : [],
      whyMatched: String(job?.whyMatched || '').trim(),
      recommendedCourse,
      recommendedSprintTask,
      platformColor: job?.platformColor,
    };
  }
}
