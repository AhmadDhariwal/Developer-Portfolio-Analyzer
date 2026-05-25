import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
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
  private readonly baseUrl = 'http://localhost:5000/api/news';

  constructor(private readonly http: HttpClient) {}

  getNews(filters: NewsFilters, page = 1, limit = 12): Observable<NewsResponse> {
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

    return this.http.get<NewsResponse>(this.baseUrl, { params }).pipe(
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
          responseTimeMs: 0
        }
      }))
    );
  }

  getSavedNews(): Observable<SavedNewsItem[]> {
    return this.http.get<{ items?: SavedNewsItem[] }>(`${this.baseUrl}/saved`).pipe(
      map((response) => this.normalizeSavedItems(response?.items))
    );
  }

  getSavedNewsByType(type: NewsSavedType): Observable<SavedNewsItem[]> {
    return this.http.get<{ items?: SavedNewsItem[] }>(`${this.baseUrl}/saved?type=${encodeURIComponent(type)}`).pipe(
      map((response) => this.normalizeSavedItems(response?.items))
    );
  }

  saveNews(article: NewsItem, type: NewsSavedType): Observable<SavedNewsItem> {
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
    return this.http.delete<{ id?: string }>(`${this.baseUrl}/save/${savedId}`).pipe(
      map((response) => ({ id: String(response?.id || savedId) }))
    );
  }

  markSavedNewsAsRead(savedId: string): Observable<SavedNewsItem> {
    return this.http.patch<{ item?: SavedNewsItem }>(`${this.baseUrl}/save/${savedId}/read`, {}).pipe(
      map((response) => this.normalizeSavedItem(response?.item, '', 'read_later'))
    );
  }

  private normalizeItems(items: NewsItem[] | undefined, page: number): NewsItem[] {
    if (!Array.isArray(items)) return [];

    return items
      .filter((item) => item && item.title && item.url)
      .map((item, index) => ({
        id: item.id || item.url || `news-${page}-${index}`,
        title: item.title,
        description: item.description || '',
        source: item.source || 'Unknown',
        url: item.url,
        image: item.image || '',
        publishedAt: item.publishedAt || new Date().toISOString(),
        category: item.category || 'Backend',
        popularity: Number(item.popularity || 0),
        relevanceScore: Number(item.relevanceScore || 0),
        rankScore: Number(item.rankScore || item.relevanceScore || 0),
        tags: Array.isArray(item.tags) ? item.tags.filter(Boolean).slice(0, 4) : []
      }));
  }

  private normalizeSavedItems(items: SavedNewsItem[] | undefined): SavedNewsItem[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => this.normalizeSavedItem(item));
  }

  private normalizeSavedItem(item: Partial<SavedNewsItem> | undefined, fallbackArticleId = '', fallbackType: NewsSavedType = 'bookmark'): SavedNewsItem {
    return {
      id: String(item?.id || ''),
      articleId: String(item?.articleId || fallbackArticleId),
      title: String(item?.title || ''),
      url: String(item?.url || ''),
      source: String(item?.source || 'Unknown'),
      image: String(item?.image || ''),
      publishedAt: item?.publishedAt || null,
      category: String(item?.category || 'Backend'),
      type: item?.type === 'read_later' || item?.type === 'bookmark' ? item.type : fallbackType,
      createdAt: item?.createdAt || null,
      readAt: item?.readAt || null
    };
  }
}
