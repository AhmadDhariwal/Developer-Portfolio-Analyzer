import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  defer,
  distinctUntilChanged,
  finalize,
  map,
  of,
  shareReplay,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { AuthService } from './auth.service';
import {
  NewsFilters,
  NewsItem,
  NewsResponse,
  NewsSavedType,
  SavedNewsItem,
  SavedNewsResponse,
  normalizeNewsFilters,
} from '../models/news.model';
import {
  newsDate,
  normalizeSkillEvidence,
  reportedNumber,
  retryDeadline,
  safeNewsUrl,
} from '../utils/news-presentation';

type RequestKind = 'feed' | 'refresh' | 'mutation';
interface RequestEntry {
  stream: Observable<unknown>;
  value?: unknown;
  until: number;
}

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/news`;
  private readonly entries = new Map<string, RequestEntry>();
  private readonly cancelled = new Subject<void>();
  private readonly savedCancelled = new Subject<void>();
  private readonly invalidated = new Subject<void>();
  readonly invalidated$ = this.invalidated.asObservable();
  private readonly cooldowns = new Map<string, number>();
  private revision = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly invalidation: FrontendCacheInvalidationService,
    private readonly auth: AuthService,
  ) {
    this.invalidation.register('news', () => {
      this.clearCache();
      this.invalidated.next();
    });
    this.auth.currentUser$
      .pipe(
        map((user) =>
          JSON.stringify([
            user?._id,
            user?.activeGithubUsername,
            user?.['activeResumeFileId'],
            user?.activeCareerStack,
            user?.activeExperienceLevel,
          ]),
        ),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.clearCache());
  }

  clearCache(): void {
    this.revision++;
    this.cancelled.next();
    this.entries.clear();
  }

  retryAt(kind: RequestKind): number {
    return this.cooldowns.get(`${this.account()}:${kind}`) || 0;
  }

  getNews(
    filters: NewsFilters,
    page = 1,
    limit = 12,
    options: {
      refresh?: boolean;
      revalidate?: boolean;
      catalogOnly?: boolean;
      discover?: boolean;
    } = {},
  ): Observable<NewsResponse> {
    const normalized = normalizeNewsFilters(filters);
    let params = new HttpParams()
      .set('mode', normalized.mode || 'personalized')
      .set('tab', normalized.tab)
      .set('date', normalized.date)
      .set('popularity', normalized.popularity)
      .set('page', String(page))
      .set('limit', String(limit));
    const forYou = normalized.mode !== 'explore' && normalized.tab === 'for-you';
    if (!forYou && normalized.category !== 'All')
      params = params.set('category', normalized.category);
    if (normalized.source !== 'All') params = params.set('source', normalized.source);
    if (!forYou && normalized.search)
      params = params.set('search', normalized.search.toLowerCase());
    if (options.refresh) params = params.set('refresh', 'true');
    if (options.discover) params = params.set('discover', 'true');
    if (options.catalogOnly) params = params.set('bypassCache', 'true');
    return this.request(
      `feed:${params.toString()}`,
      this.http.get<NewsResponse>(this.baseUrl, { params }).pipe(
        map((response) => ({
          ...response,
          recommendedBasedOn: response.recommendedBasedOn
            ? {
                ...response.recommendedBasedOn,
                skillEvidence: normalizeSkillEvidence(response.recommendedBasedOn.skillEvidence),
              }
            : response.recommendedBasedOn,
          items: (Array.isArray(response.items) ? response.items : [])
            .map((item) => this.normalizeArticle(item))
            .filter((item): item is NewsItem => !!item),
          total: Number(response.total) || 0,
          limit: Number.isInteger(response.limit) && response.limit! > 0 ? response.limit : limit,
          totalPages: Math.max(1, Number(response.totalPages) || 1),
          trendingTopics: Array.isArray(response.trendingTopics) ? response.trendingTopics : [],
          sourceSummary: response.sourceSummary || {},
        })),
      ),
      options.refresh ? 'refresh' : 'feed',
      15000,
      options.revalidate || options.refresh,
    );
  }

  getSavedNewsByType(
    type: NewsSavedType,
    page = 1,
    revalidate = false,
  ): Observable<SavedNewsResponse> {
    const params = new HttpParams().set('type', type).set('page', String(page)).set('limit', '50');
    return this.request(
      `saved:${type}:${page}`,
      this.http.get<SavedNewsResponse>(`${this.baseUrl}/saved`, { params }).pipe(
        takeUntil(this.savedCancelled),
        map((response) => ({
          ...response,
          items: (response.items || [])
            .map((item) => this.normalizeSaved(item))
            .filter((item): item is SavedNewsItem => !!item),
        })),
      ),
      'feed',
      5000,
      revalidate,
    );
  }

  saveNews(
    article: Pick<
      NewsItem,
      'id' | 'title' | 'url' | 'source' | 'image' | 'publishedAt' | 'category'
    >,
    type: NewsSavedType,
  ): Observable<SavedNewsItem> {
    return this.mutate(
      `save:${type}:${article.url}`,
      this.http
        .post<{ item: SavedNewsItem }>(`${this.baseUrl}/save`, {
          articleId: article.id,
          title: article.title,
          url: article.url,
          source: article.source,
          image: article.image,
          publishedAt: article.publishedAt || null,
          category: article.category,
          type,
        })
        .pipe(map((response) => this.requireSaved(response.item))),
    );
  }

  removeSavedNews(id: string): Observable<{ id: string }> {
    return this.mutate(
      `remove:${id}`,
      this.http.delete<{ id: string }>(`${this.baseUrl}/save/${encodeURIComponent(id)}`),
    );
  }

  markSavedNewsAsRead(id: string, read = true): Observable<SavedNewsItem> {
    return this.mutate(
      `read:${id}:${read}`,
      this.http
        .patch<{
          item: SavedNewsItem;
        }>(`${this.baseUrl}/save/${encodeURIComponent(id)}/read`, { read })
        .pipe(
          map((response) => {
            const item = this.requireSaved(response.item);
            if (
              item.id !== id ||
              item.type !== 'read_later' ||
              !Object.hasOwn(response.item, 'readAt') ||
              !!item.readAt !== read
            )
              throw new Error(
                'The server did not confirm the requested reading status. Sync your library to reconcile.',
              );
            return item;
          }),
        ),
    );
  }

  private mutate<T>(key: string, source: Observable<T>): Observable<T> {
    return this.request(
      key,
      source.pipe(
        tap(() => {
          this.savedCancelled.next();
          for (const name of this.entries.keys())
            if (name.includes(':saved:')) this.entries.delete(name);
        }),
      ),
      'mutation',
      0,
    );
  }

  private request<T>(
    key: string,
    source: Observable<T>,
    kind: RequestKind,
    ttl: number,
    revalidate = false,
  ): Observable<T> {
    const scope = this.account();
    const revision = this.revision;
    const name = `${scope}:${revision}:${key}`;
    const previous = this.entries.get(name);
    if (previous && (!previous.value || (!revalidate && previous.until > Date.now()))) {
      return previous.value
        ? of(structuredClone(previous.value) as T)
        : (previous.stream as Observable<T>);
    }
    const entry: RequestEntry = { until: 0, stream: EMPTY };
    entry.stream = defer(() => {
      if (!scope || revision !== this.revision || scope !== this.account()) return EMPTY;
      const until = Math.max(this.retryAt(kind), kind === 'refresh' ? this.retryAt('feed') : 0);
      if (until > Date.now())
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 429,
              headers: new HttpHeaders({
                'Retry-After': String(Math.ceil((until - Date.now()) / 1000)),
              }),
            }),
        );
      return source;
    }).pipe(
      takeUntil(this.cancelled),
      tap((value) => {
        if (ttl && revision === this.revision) {
          entry.value = structuredClone(value);
          entry.until = Date.now() + ttl;
        }
      }),
      catchError((error: HttpErrorResponse) => {
        if ([429, 503].includes(error.status)) {
          const receivedAt = Date.now();
          const serverDate = Date.parse(error.headers?.get('Date') || '');
          const referenceTime = Number.isFinite(serverDate) ? serverDate : receivedAt;
          const until =
            receivedAt +
            Math.max(
              0,
              retryDeadline(
                error.headers?.get('Retry-After') || null,
                referenceTime,
                error.status === 503 ? 30 : 60,
              ) - referenceTime,
            );
          this.cooldowns.set(
            `${scope}:${kind}`,
            Math.max(until, this.cooldowns.get(`${scope}:${kind}`) || 0),
          );
          if (error.status === 503 && kind !== 'mutation')
            this.cooldowns.set(
              `${scope}:feed`,
              Math.max(until, this.cooldowns.get(`${scope}:feed`) || 0),
            );
          while (this.cooldowns.size > 30)
            this.cooldowns.delete(this.cooldowns.keys().next().value!);
        }
        return throwError(() => error);
      }),
      finalize(() => {
        if (!entry.value && this.entries.get(name) === entry) this.entries.delete(name);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.entries.delete(name);
    while (this.entries.size >= 30) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(name, entry);
    return entry.stream as Observable<T>;
  }

  private account(): string {
    return String(this.auth.getCurrentUser()?._id || '');
  }

  private normalizeArticle(item: NewsItem): NewsItem | null {
    const url = safeNewsUrl(item?.url);
    if (!item?.id || !item.title || !url) return null;
    return {
      ...item,
      url,
      image: safeNewsUrl(item.image),
      attributionUrl: safeNewsUrl(item.attributionUrl) || url,
      license: typeof item.license === 'string' ? item.license.slice(0, 120) : '',
      licenseUrl: safeNewsUrl(item.licenseUrl),
      publishedAt: newsDate(item.publishedAt),
      description: item.description || '',
      publisher: item.publisher || '',
      popularity: reportedNumber(item.popularity),
      rankScore: reportedNumber(item.rankScore, 100),
      relevanceScore: reportedNumber(item.relevanceScore, 100),
      tags: this.strings(item.tags),
      relevanceReasons: this.strings(item.relevanceReasons),
      relatedSkills: this.strings(item.relatedSkills),
      relatedSkillEvidence: normalizeSkillEvidence(item.relatedSkillEvidence),
      relatedSkillGaps: this.strings(item.relatedSkillGaps),
      demandTags: this.strings(item.demandTags),
    };
  }
  private strings(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [];
  }
  private normalizeSaved(item: SavedNewsItem): SavedNewsItem | null {
    const url = safeNewsUrl(item?.url);
    if (
      !item?.id ||
      !item.articleId ||
      !item.title ||
      !url ||
      !['bookmark', 'read_later'].includes(item.type)
    )
      return null;
    return {
      ...item,
      url,
      image: safeNewsUrl(item.image),
      publishedAt: newsDate(item.publishedAt) || null,
      createdAt: newsDate(item.createdAt) || null,
      readAt: newsDate(item.readAt) || null,
      firstReadAt: newsDate(item.firstReadAt) || null,
      lastReadAt: newsDate(item.lastReadAt) || null,
      readCount: Number.isInteger(item.readCount) ? reportedNumber(item.readCount) : null,
    };
  }
  private requireSaved(item: SavedNewsItem): SavedNewsItem {
    const normalized = this.normalizeSaved(item);
    if (!normalized)
      throw new Error(
        'The server did not confirm the saved article. Refresh your library to reconcile.',
      );
    return normalized;
  }
}
