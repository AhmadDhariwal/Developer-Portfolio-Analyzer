import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, shareReplay, tap } from 'rxjs/operators';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';

export interface SupportReply {
  _id?: string;
  authorId: string;
  authorRole: 'user' | 'admin';
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  _id?: string;
  userId?: string;
  name?: string;
  email?: string;
  category: string;
  priority: string;
  subject: string;
  message: string;
  status?: string;
  replyToEmail?: string;
  replies?: SupportReply[];
  lastReplyAt?: string;
  createdAt?: string;
  updatedAt?: string;
  sourcePage?: string;
  browserInfo?: string;
}

export interface AdminTicketQuery {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sort?: string;
}

@Injectable({ providedIn: 'root' })
export class SupportService {
  private cache = new Map<string, { obs: Observable<any>; expires: number }>();
  private readonly TTL = 60000;
  private readonly MAX_CACHE_ENTRIES = 20;

  constructor(
    private http: HttpClient,
    private cacheInvalidation: FrontendCacheInvalidationService,
  ) {
    this.cacheInvalidation.register('support', () => this.clearCache());
  }

  createTicket(ticket: any): Observable<any> {
    return this.http
      .post(`${environment.apiBaseUrl}/support/tickets`, ticket)
      .pipe(tap(() => this.clearCache()));
  }

  getMyTickets(page: number = 1, limit: number = 10): Observable<any> {
    const cacheKey = `my-tickets-${page}-${limit}`;
    return this.fetchWithCache(cacheKey, () =>
      this.http.get(`${environment.apiBaseUrl}/support/my-tickets?page=${page}&limit=${limit}`),
    );
  }

  deleteTicket(id: string): Observable<any> {
    return this.http
      .delete(`${environment.apiBaseUrl}/support/tickets/${id}`)
      .pipe(tap(() => this.clearCache()));
  }

  addReply(id: string, body: string): Observable<any> {
    return this.http
      .post(`${environment.apiBaseUrl}/support/tickets/${id}/replies`, { body })
      .pipe(tap(() => this.clearCache()));
  }

  adminGetTickets(params: AdminTicketQuery = {}): Observable<any> {
    let httpParams = new HttpParams();
    (Object.keys(params) as (keyof AdminTicketQuery)[]).forEach((key) => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    });
    const cacheKey = `admin-tickets-${httpParams.toString()}`;
    return this.fetchWithCache(cacheKey, () =>
      this.http.get(`${environment.apiBaseUrl}/support/admin/tickets`, { params: httpParams }),
    );
  }

  adminGetTicket(id: string): Observable<any> {
    const cacheKey = `admin-ticket-${id}`;
    return this.fetchWithCache(cacheKey, () =>
      this.http.get(`${environment.apiBaseUrl}/support/admin/tickets/${id}`),
    );
  }

  adminUpdateStatus(id: string, status: string, expectedUpdatedAt?: string): Observable<any> {
    return this.http
      .put(`${environment.apiBaseUrl}/support/admin/tickets/${id}/status`, {
        status,
        expectedUpdatedAt,
      })
      .pipe(tap(() => this.clearCache()));
  }

  adminReply(id: string, body: string): Observable<any> {
    return this.http
      .post(`${environment.apiBaseUrl}/support/admin/tickets/${id}/replies`, { body })
      .pipe(tap(() => this.clearCache()));
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
      catchError((err) => {
        this.cache.delete(key);
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.cache.set(key, { obs, expires: now + this.TTL });
    return obs;
  }
}
