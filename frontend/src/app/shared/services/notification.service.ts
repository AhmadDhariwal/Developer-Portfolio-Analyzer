import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  auditTime,
  BehaviorSubject,
  filter,
  finalize,
  map,
  Observable,
  of,
  share,
  shareReplay,
  Subject,
  tap,
} from 'rxjs';
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
  private readonly summary = new BehaviorSubject<NotificationResponse | null>(null);
  readonly summary$ = this.summary.asObservable();
  private readonly events = new Subject<{
    eventType: string;
    session: number;
    revision?: number;
  }>();
  private pendingEvent: { eventType: string; session: number; revision?: number } | null = null;
  private session = 0;
  private appliedRevision = -1;
  private lastReadAt = 0;
  readonly streamConnected = signal(false);
  // Invalidation happens once per batch, after in-flight reads settle. Each active
  // query reconciles at most once per second; navbar state is published by the feed.
  readonly streamEvents$ = this.events.pipe(
    auditTime(1000),
    filter((event) => {
      if (event.session !== this.session) return false;
      if (event.revision !== undefined && event.revision <= this.appliedRevision) return false;
      if (this.inflight.size) {
        this.pendingEvent = event;
        return false;
      }
      return true;
    }),
    tap(() => this.clearCache()),
    map(({ eventType }) => ({ eventType })),
    share(),
  );
  hasUnscopedFeed = false;

  setInboxScope(query: Pick<NotificationQuery, 'organizationId' | 'teamId'> | null): void {
    this.hasUnscopedFeed = query !== null && !query.organizationId && !query.teamId;
  }

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

  private reconcile(eventType = 'updated', revision?: number): void {
    this.events.next({ eventType, session: this.session, revision });
  }

  private currentIdentity(): string {
    return `${String(this.auth.getCurrentUser()?._id || '')}:${this.auth.getToken() || ''}`;
  }

  private synchronizeIdentity(): string {
    const identity = this.currentIdentity();
    if (identity !== this.identity) {
      this.session++;
      this.clearCache();
      this.pendingEvent = null;
      this.summary.next(null);
      this.appliedRevision = -1;
      this.lastReadAt = 0;
      this.identity = identity;
    }
    return identity;
  }

  private isUnscoped(query: NotificationQuery): boolean {
    return !query.organizationId && !query.teamId && !query.userId;
  }

  private publish(query: NotificationQuery, value: NotificationResponse): void {
    if (!this.isUnscoped(query)) return;
    const firstPage = !query.cursor && (!query.page || query.page === 1);
    const unfiltered = !query.search && !query.from && !query.to && !query.type && !query.unread;
    if (firstPage && unfiltered) this.summary.next(value);
    else if (this.summary.value) {
      this.summary.next({ ...this.summary.value, unreadCount: value.unreadCount });
    }
  }

  private mutation<T>(
    request: Observable<T>,
    eventType: string,
    committed?: () => void,
  ): Observable<T> {
    const identity = this.currentIdentity();
    const session = this.session;
    return request.pipe(
      filter(() => session === this.session && identity === this.currentIdentity()),
      tap(() => {
        committed?.();
        this.reconcile(eventType);
      }),
    );
  }

  private patchRead(id: string): void {
    const knownUnread = [...this.cache.values()].some(({ value }) =>
      value.notifications.some((item) => item._id === id && !item.isRead),
    );
    const update = (value: NotificationResponse, globalCount: boolean): NotificationResponse => ({
      ...value,
      unreadCount: globalCount ? Math.max(0, value.unreadCount - 1) : value.unreadCount,
      notifications: value.notifications.map((item) =>
        item._id === id ? { ...item, isRead: true } : item,
      ),
    });
    if (!knownUnread) return;
    if (this.summary.value) this.summary.next(update(this.summary.value, true));
    for (const [key, cached] of this.cache) {
      const query = Object.fromEntries(JSON.parse(key)) as NotificationQuery;
      cached.value = update(cached.value, this.isUnscoped(query));
    }
  }

  getNotifications(
    query: NotificationQuery = {},
    _profileSignature = '',
    forceRefresh = false,
  ): Observable<NotificationResponse> {
    const identity = this.synchronizeIdentity();
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
        filter(
          () =>
            epoch === this.epoch &&
            identity === this.identity &&
            identity === this.currentIdentity(),
        ),
        tap((value) => {
          this.lastReadAt = Date.now();
          if (this.isUnscoped(query) && Number.isSafeInteger(value.revision))
            this.appliedRevision = Math.max(this.appliedRevision, value.revision!);
          this.publish(query, value);
          this.cache.delete(key);
          this.cache.set(key, { value, expiresAt: Date.now() + 15000 });
          while (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
        }),
        finalize(() => {
          if (this.inflight.get(key) === request$) this.inflight.delete(key);
          if (!this.inflight.size && this.pendingEvent) {
            const pending = this.pendingEvent;
            this.pendingEvent = null;
            this.events.next(pending);
          }
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
    return this.mutation(
      this.http.put<{ message: string }>(`${this.baseUrl}/${id}/read`, params),
      'read',
      () => this.patchRead(id),
    );
  }
  markAllAsRead(
    params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {},
  ): Observable<{ message: string; remaining: number }> {
    return this.mutation(
      this.http.put<{ message: string; remaining: number }>(`${this.baseUrl}/read-all`, params),
      'read_all',
    );
  }
  deleteNotification(
    id: string,
    params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {},
  ): Observable<{ message: string }> {
    const query = new URLSearchParams(
      Object.entries(params).filter((entry): entry is [string, string] => !!entry[1]),
    );
    return this.mutation(
      this.http.delete<{ message: string }>(
        `${this.baseUrl}/${id}${query.size ? `?${query}` : ''}`,
      ),
      'delete',
    );
  }
  bulkDelete(ids: string[]): Observable<{ message: string; deletedCount: number }> {
    return this.mutation(
      this.http.post<{ message: string; deletedCount: number }>(`${this.baseUrl}/bulk-delete`, {
        ids,
      }),
      'delete',
    );
  }

  connectStream(userSignature: string, token: string): void {
    if (!userSignature || !token) return;
    if (this.streamUser === userSignature && this.streamToken === token) return;
    if (this.streamUser || this.streamToken) this.disconnectStream();
    this.synchronizeIdentity();
    this.streamUser = userSignature;
    this.streamToken = token;
    this.reconcileTimer = setInterval(() => {
      if (!this.streamConnected() || Date.now() - this.lastReadAt >= 300000)
        this.reconcile('periodic');
    }, 60000);
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
      if (this.stream !== controller) return;
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
      this.streamConnected.set(true);
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
          const revision = id === undefined ? undefined : Number(id);
          if (revision !== undefined) {
            if (
              !Number.isSafeInteger(revision) ||
              revision < 0 ||
              (this.cursor !== '' && revision <= Number(this.cursor))
            )
              continue;
            this.cursor = id!;
          }
          if (Date.now() - startedAt >= 30000) this.reconnectAttempts = 0;
          this.reconcile('stream', revision);
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
      this.streamConnected.set(false);
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
    this.session++;
    this.pendingEvent = null;
    this.summary.next(null);
    this.appliedRevision = -1;
    this.lastReadAt = 0;
    this.streamConnected.set(false);
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
