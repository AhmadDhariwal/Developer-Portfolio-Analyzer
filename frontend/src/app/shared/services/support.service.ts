import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, shareReplay, tap } from 'rxjs/operators';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';

export interface SupportTicket {
  _id?: string;
  category: string;
  priority: string;
  subject: string;
  message: string;
  status?: string;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class SupportService {
  private cache = new Map<string, { obs: Observable<any>, expires: number }>();
  private readonly TTL = 60000;
  private readonly MAX_CACHE_ENTRIES = 20;

  constructor(
    private http: HttpClient,
    private cacheInvalidation: FrontendCacheInvalidationService
  ) {
    this.cacheInvalidation.register('support', () => this.clearCache());
  }

  createTicket(ticket: any): Observable<any> {
    return this.http.post(`${environment.apiBaseUrl}/support/tickets`, ticket).pipe(
      tap(() => this.clearCache())
    );
  }

  getMyTickets(page: number = 1, limit: number = 10): Observable<any> {
    const cacheKey = `my-tickets-${page}-${limit}`;
    return this.fetchWithCache(cacheKey, () => 
      this.http.get(`${environment.apiBaseUrl}/support/my-tickets?page=${page}&limit=${limit}`)
    );
  }

  clearCache(): void {
    this.cache.clear();
  }

  private fetchWithCache<T>(key: string, requestFactory: () => Observable<T>): Observable<T> {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expires > now) {
      return cached.obs;
    }

    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const obs = requestFactory().pipe(
      catchError(err => {
        this.cache.delete(key);
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.cache.set(key, { obs, expires: now + this.TTL });
    return obs;
  }
}
