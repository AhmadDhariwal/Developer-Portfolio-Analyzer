import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { NewsFilters, NewsResponse } from '../models/news.model';

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly baseUrl = 'http://localhost:5000/api/news';

  constructor(private readonly http: HttpClient) {}

  getNews(filters: NewsFilters, page = 1, limit = 12): Observable<NewsResponse> {
    const params = new HttpParams()
      .set('tab', filters.tab)
      .set('category', filters.category)
      .set('source', filters.source)
      .set('date', filters.date)
      .set('search', filters.search || '')
      .set('popularity', filters.popularity)
      .set('page', String(page))
      .set('limit', String(limit));

    return this.http.get<NewsResponse>(this.baseUrl, { params });
  }
}
