import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { auditTime, filter, finalize, Observable, of, shareReplay, Subject, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { AuthService } from './auth.service';

export interface AppNotification {
  _id: string;
  userId: string;
  type:
    | 'profile_update'
    | 'resume_upload'
    | 'github_update'
    | 'low_score'
    | 'career_update'
    | 'system'
    | 'info'
    | 'warning'
    | 'success'
    | 'error';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
  security?: boolean;
  meta?: Record<string, unknown>;
}
export interface NotificationResponse {
  notifications: AppNotification[];
  unreadCount: number;
  filteredUnreadCount?: number;
  total?: number;
  page?: number;
  totalPages?: number;
  revision?: number;
  nextCursor?: string | null;
}
export interface NotificationQuery {
  page?: number;
  limit?: number;
  cursor?: string;
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
  private readonly cache = new Map<string, { value: NotificationResponse; expiresAt: number }>();
  private readonly inflight = new Map<string, Observable<NotificationResponse>>();
  private readonly events = new Subject<{ eventType: string }>();
  readonly streamEvents$ = this.events.pipe(auditTime(250));
  private epoch = 0;
  private identity = '';
  private stream: AbortController | null = null;
  private streamUser = '';
  private streamToken = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private cursor = '';

  constructor(
    private readonly http: HttpClient,
    cacheInvalidation: FrontendCacheInvalidationService,
    private readonly auth: AuthService,
  ) {
    cacheInvalidation.register('notifications', () => this.disconnectStream());
  }

  clearCache(): void {
    this.epoch++;
    this.cache.clear();
    this.inflight.clear();
  }

  private reconcile(eventType = 'updated'): void {
    this.clearCache();
    this.events.next({ eventType });
  }

  getNotifications(
    query: NotificationQuery = {},
    _profileSignature = '',
    forceRefresh = false,
  ): Observable<NotificationResponse> {
    const identity = `${String(this.auth.getCurrentUser()?._id || '')}:${this.auth.getToken() || ''}`;
    if (identity !== this.identity) {
      this.clearCache();
      this.identity = identity;
    }
    const normalized = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify(normalized);
    const cached = this.cache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return of(cached.value);
    // Force refresh bypasses persisted cache while still sharing in-flight work.
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const epoch = this.epoch;
    const params = new URLSearchParams(normalized.map(([name, value]) => [name, String(value)]));
    const request$ = this.http
      .get<NotificationResponse>(`${this.baseUrl}${params.size ? `?${params}` : ''}`)
      .pipe(
        filter(() => epoch === this.epoch && identity === this.identity),
        tap((value) => {
          this.cache.delete(key);
          this.cache.set(key, { value, expiresAt: Date.now() + 15000 });
          while (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
        }),
        finalize(() => {
          if (this.inflight.get(key) === request$) this.inflight.delete(key);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    this.inflight.set(key, request$);
    return request$;
  }

  markAsRead(
    id: string,
    params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {},
  ): Observable<{ message: string }> {
    return this.http
      .put<{ message: string }>(`${this.baseUrl}/${id}/read`, params)
      .pipe(tap(() => this.reconcile('read')));
  }
  markAllAsRead(
    params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {},
  ): Observable<{ message: string; remaining: number }> {
    return this.http
      .put<{ message: string; remaining: number }>(`${this.baseUrl}/read-all`, params)
      .pipe(tap(() => this.reconcile('read_all')));
  }
  deleteNotification(
    id: string,
    params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {},
  ): Observable<{ message: string }> {
    const query = new URLSearchParams(
      Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]),
    );
    return this.http
      .delete<{ message: string }>(`${this.baseUrl}/${id}${query.size ? `?${query}` : ''}`)
      .pipe(tap(() => this.reconcile('delete')));
  }
  bulkDelete(ids: string[]): Observable<{ message: string; deletedCount: number }> {
    return this.http
      .post<{ message: string; deletedCount: number }>(`${this.baseUrl}/bulk-delete`, { ids })
      .pipe(tap(() => this.reconcile('delete')));
  }

  connectStream(userSignature: string, token: string): void {
    if (!userSignature || !token) return;
    if (this.streamUser === userSignature && this.streamToken === token) return;
    this.disconnectStream();
    this.streamUser = userSignature;
    this.streamToken = token;
    this.reconcileTimer = setInterval(() => this.reconcile('periodic'), 60000);
    void this.openStream();
  }

  private async openStream(): Promise<void> {
    if (!this.streamUser || !this.streamToken) return;
    const controller = new AbortController();
    this.stream = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let retryAfter = 0;
    const startedAt = Date.now();
    const idle = () => setTimeout(() => controller.abort(), 45000);
    let idleTimer = idle();
    try {
      const response = await fetch(`${this.baseUrl}/stream`, {
        headers: {
          Authorization: `Bearer ${this.streamToken}`,
          Accept: 'text/event-stream',
          ...(this.cursor ? { 'Last-Event-ID': this.cursor } : {}),
        },
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) {
        this.disconnectStream();
        this.auth.logout();
        return;
      }
      retryAfter = Math.min(
        120000,
        Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000,
      );
      if (!response.ok || !response.body) throw new Error('Stream unavailable');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (this.stream === controller) {
        const chunk = await reader.read();
        if (chunk.done) break;
        clearTimeout(idleTimer);
        idleTimer = idle();
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 16384) throw new Error('Stream frame exceeds limit');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!frame.includes('data:')) continue;
          const id = /^id: (\d+)$/m.exec(frame)?.[1];
          if (id) this.cursor = id;
          if (Date.now() - startedAt >= 30000) this.reconnectAttempts = 0;
          this.reconcile('stream');
        }
      }
    } catch {
      /* Durable inbox reads and periodic reconciliation remain available. */
    } finally {
      clearTimeout(idleTimer);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      if (this.stream !== controller) return;
      this.stream = null;
      if (this.streamUser && this.reconnectAttempts < 8) {
        const delay = Math.max(
          retryAfter,
          Math.min(60000, 1000 * 2 ** this.reconnectAttempts++) * (0.75 + Math.random() * 0.5),
        );
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          void this.openStream();
        }, delay);
      }
    }
  }

  disconnectStream(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconnectTimer = null;
    this.reconcileTimer = null;
    this.stream?.abort();
    this.stream = null;
    this.streamUser = '';
    this.streamToken = '';
    this.cursor = '';
    this.reconnectAttempts = 0;
    this.identity = '';
    this.clearCache();
  }
}
