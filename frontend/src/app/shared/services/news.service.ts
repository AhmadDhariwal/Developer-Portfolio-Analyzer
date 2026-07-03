import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { finalize, map, Observable, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import {
  NewsFilters,
  NewsItem,
  NewsResponse,
  NewsSavedType,
  SavedNewsItem,
  normalizeNewsFilters
} from '../models/news.model';

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/news`;
  private readonly pendingRequests = new Map<string, Observable<unknown>>();

  constructor(private readonly http: HttpClient, private readonly cacheInvalidation: FrontendCacheInvalidationService) {
    this.cacheInvalidation.register('news', () => this.clearCache());
  }

  clearCache(): void {
    this.pendingRequests.clear();
  }

  getNews(filters: NewsFilters, page = 1, limit = 12, options: { refresh?: boolean } = {}): Observable<NewsResponse> {
    const normalizedFilters = normalizeNewsFilters(filters);
    let params = new HttpParams()
      .set('tab', normalizedFilters.tab)
      .set('date', normalizedFilters.date)
      .set('popularity', normalizedFilters.popularity)
      .set('page', String(page))
      .set('limit', String(limit));

    if (normalizedFilters.category !== 'All') params = params.set('category', normalizedFilters.category);
    if (normalizedFilters.source !== 'All') params = params.set('source', normalizedFilters.source);
    if (normalizedFilters.search) params = params.set('search', normalizedFilters.search);
    if (options.refresh) params = params.set('refresh', 'true');

    const key = `feed:${params.toString()}`;
    const existing = this.pendingRequests.get(key) as Observable<NewsResponse> | undefined;
    if (existing) return existing;

    const request$ = this.http.get<NewsResponse>(this.baseUrl, { params }).pipe(
      map((response) => ({
        items: this.normalizeItems(response?.items, page),
        total: Number(response?.total || 0),
        page: Number(response?.page || page),
        totalPages: Math.max(1, Number(response?.totalPages || 1)),
        hasMore: Boolean(response?.hasMore),
        sourceSummary: response?.sourceSummary || {},
        trendingTopics: Array.isArray(response?.trendingTopics) ? response.trendingTopics : [],
        activeTab: response?.activeTab || normalizedFilters.tab,
        fromCache: Boolean(response?.fromCache),
        recommendedBasedOn: response?.recommendedBasedOn || null,
        telemetry: response?.telemetry || {
          cacheHit: false,
          providerFailureCount: 0,
          providerUsed: [],
          providerDiagnostics: [],
          signalHash: '',
          responseTimeMs: 0
        }
      })),
      finalize(() => this.pendingRequests.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.pendingRequests.set(key, request$);
    return request$;
  }

  getSavedNews(): Observable<SavedNewsItem[]> {
    return this.dedupe(`saved:all`, this.http.get<{ items?: SavedNewsItem[] }>(`${this.baseUrl}/saved`).pipe(
      map((response) => this.normalizeSavedItems(response?.items))
    ));
  }

  getSavedNewsByType(type: NewsSavedType): Observable<SavedNewsItem[]> {
    return this.dedupe(`saved:${type}`, this.http.get<{ items?: SavedNewsItem[] }>(`${this.baseUrl}/saved?type=${encodeURIComponent(type)}`).pipe(
      map((response) => this.normalizeSavedItems(response?.items))
    ));
  }

  saveNews(article: NewsItem, type: NewsSavedType): Observable<SavedNewsItem> {
    this.clearSavedPending();
    return this.http
      .post<{ item?: SavedNewsItem }>(`${this.baseUrl}/save`, {
        articleId: article.id,
        title: article.title,
        url: article.url,
        source: article.source,
        image: article.image,
        publishedAt: article.publishedAt,
        category: article.category,
        type
      })
      .pipe(map((response) => this.normalizeSavedItem(response?.item, article.id, type)));
  }

  removeSavedNews(savedId: string): Observable<{ id: string }> {
    this.clearSavedPending();
    return this.http.delete<{ id?: string }>(`${this.baseUrl}/save/${savedId}`).pipe(
      map((response) => ({ id: String(response?.id || savedId) }))
    );
  }

  markSavedNewsAsRead(savedId: string): Observable<SavedNewsItem> {
    this.clearSavedPending();
    return this.http.patch<{ item?: SavedNewsItem }>(`${this.baseUrl}/save/${savedId}/read`, {}).pipe(
      map((response) => this.normalizeSavedItem(response?.item, '', 'read_later'))
    );
  }

  private normalizeItems(items: NewsItem[] | undefined, page: number): NewsItem[] {
    if (!Array.isArray(items)) return [];

    return items
      .filter((item) => item && item.title && item.url)
      .map((item, index) => ({
        id: item.id || item.url,
        title: item.title,
        description: item.description || '',
        source: item.source || '',
        url: item.url,
        image: item.image || '',
        publishedAt: item.publishedAt || '',
        category: item.category || '',
        popularity: Number(item.popularity || 0),
        relevanceScore: Number(item.relevanceScore || 0),
        rankScore: Number(item.rankScore || item.relevanceScore || 0),
        tags: Array.isArray(item.tags) ? item.tags.filter(Boolean).slice(0, 4) : [],
        relevanceReasons: Array.isArray(item.relevanceReasons) ? item.relevanceReasons.filter(Boolean).slice(0, 3) : [],
        relatedSkills: Array.isArray(item.relatedSkills) ? item.relatedSkills.filter(Boolean).slice(0, 5) : [],
        relatedSkillGaps: Array.isArray(item.relatedSkillGaps) ? item.relatedSkillGaps.filter(Boolean).slice(0, 4) : [],
        relatedCareerGoals: Array.isArray(item.relatedCareerGoals) ? item.relatedCareerGoals.filter(Boolean).slice(0, 3) : [],
        demandTags: Array.isArray(item.demandTags) ? item.demandTags.filter(Boolean).slice(0, 4) : []
      }));
  }

  private normalizeSavedItems(items: SavedNewsItem[] | undefined): SavedNewsItem[] {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => Boolean(item?.title && item?.url && item?.articleId))
      .map((item) => this.normalizeSavedItem(item));
  }

  private normalizeSavedItem(item: Partial<SavedNewsItem> | undefined, fallbackArticleId = '', fallbackType: NewsSavedType = 'bookmark'): SavedNewsItem {
    return {
      id: String(item?.id || ''),
      articleId: String(item?.articleId || fallbackArticleId),
      title: String(item?.title || ''),
      url: String(item?.url || ''),
      source: String(item?.source || ''),
      image: String(item?.image || ''),
      publishedAt: item?.publishedAt || null,
      category: String(item?.category || ''),
      type: item?.type === 'read_later' || item?.type === 'bookmark' ? item.type : fallbackType,
      createdAt: item?.createdAt || null,
      readAt: item?.readAt || null
    };
  }

  private dedupe<T>(key: string, source$: Observable<T>): Observable<T> {
    const existing = this.pendingRequests.get(key) as Observable<T> | undefined;
    if (existing) return existing;
    const request$ = source$.pipe(
      finalize(() => this.pendingRequests.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.pendingRequests.set(key, request$);
    return request$;
  }

  private clearSavedPending(): void {
    Array.from(this.pendingRequests.keys())
      .filter((key) => key.startsWith('saved:'))
      .forEach((key) => this.pendingRequests.delete(key));
  }
}
