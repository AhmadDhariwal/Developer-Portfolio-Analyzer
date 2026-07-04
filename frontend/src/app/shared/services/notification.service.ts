import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize, Observable, of, shareReplay, Subject, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

export interface AppNotification {
  _id: string;
  userId: string;
  type: 'profile_update' | 'resume_upload' | 'github_update' | 'low_score' | 'career_update' | 'system' | 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface NotificationResponse {
  notifications: AppNotification[];
  unreadCount: number;
  total?: number;
  page?: number;
  totalPages?: number;
}

export interface NotificationQuery {
  page?: number;
  limit?: number;
  search?: string;
  from?: string;
  to?: string;
  userId?: string;
  organizationId?: string;
  teamId?: string;
  role?: string;
  type?: string;
  unread?: boolean;
  includeAllOrgs?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly baseUrl = `${environment.apiBaseUrl}/notifications`;
  private readonly cacheTtlMs = 45_000;
  private readonly maxCacheEntries = 50;
  private readonly cache = new Map<string, { value: NotificationResponse; expiresAt: number }>();
  private readonly inflight = new Map<string, Observable<NotificationResponse>>();
  private readonly streamEventsSubject = new Subject<{ eventType: string }>();
  readonly streamEvents$ = this.streamEventsSubject.asObservable();
  private stream: EventSource | null = null;
  private streamUser = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  constructor(private readonly http: HttpClient, cacheInvalidation: FrontendCacheInvalidationService) {
    cacheInvalidation.register('notifications', () => this.disconnectStream());
  }

  private cacheKey(query: NotificationQuery, profileSignature = ''): string {
    const normalized = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify([profileSignature || 'current-user', normalized]);
  }

  clearCache(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  private writeCache(key: string, value: NotificationResponse): void {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }

  getNotifications(query: NotificationQuery = {}, profileSignature = '', forceRefresh = false): Observable<NotificationResponse> {
    const key = this.cacheKey(query, profileSignature);
    const cached = this.cache.get(key);
    if (!forceRefresh && cached?.expiresAt && cached.expiresAt > Date.now()) return of(cached.value);
    if (!forceRefresh && this.inflight.has(key)) return this.inflight.get(key)!;

    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.set(key, String(value));
    });
    const suffix = params.toString();
    const endpoint = suffix ? `${this.baseUrl}?${suffix}` : this.baseUrl;
    const request$ = this.http.get<NotificationResponse>(endpoint).pipe(
      tap((value) => this.writeCache(key, value)),
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => this.inflight.delete(key))
    );
    if (!forceRefresh) this.inflight.set(key, request$);
    return request$;
  }

  markAsRead(notificationId: string, params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {}): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/${notificationId}/read`, params).pipe(tap(() => this.clearCache()));
  }

  markAllAsRead(): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/read-all`, {}).pipe(tap(() => this.clearCache()));
  }

  deleteNotification(notificationId: string, params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {}): Observable<{ message: string }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (!value) return;
      query.set(key, String(value));
    });
    const suffix = query.toString();
    const endpoint = suffix ? `${this.baseUrl}/${notificationId}?${suffix}` : `${this.baseUrl}/${notificationId}`;
    return this.http.delete<{ message: string }>(endpoint).pipe(tap(() => this.clearCache()));
  }

  connectStream(userSignature: string, token: string): void {
    if (!userSignature || !token) return;
    if (this.stream && this.streamUser === userSignature) return;
    this.disconnectStream();
    this.streamUser = userSignature;
    const source = new EventSource(`${this.baseUrl}/stream?token=${encodeURIComponent(token)}`);
    this.stream = source;
    source.addEventListener('notification', (event) => {
      this.reconnectAttempts = 0;
      this.clearCache();
      try {
        const payload = JSON.parse((event as MessageEvent).data || '{}');
        this.streamEventsSubject.next({ eventType: String(payload?.eventType || 'updated') });
      } catch {
        this.streamEventsSubject.next({ eventType: 'updated' });
      }
    });
    source.onerror = () => {
      source.close();
      if (this.stream === source) this.stream = null;
      if (!this.streamUser || this.reconnectTimer) return;
      const delay = Math.min(30_000, 2_000 * (2 ** this.reconnectAttempts++));
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.streamUser === userSignature) this.connectStream(userSignature, token);
      }, delay);
    };
  }

  disconnectStream(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stream?.close();
    this.stream = null;
    this.streamUser = '';
    this.reconnectAttempts = 0;
    this.clearCache();
  }
}
