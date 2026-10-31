import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { NotificationResponse, NotificationService } from './notification.service';

describe('NotificationService identity, reconciliation and streaming', () => {
  let service: NotificationService;
  let http: any;
  let auth: any;
  const response: NotificationResponse = { notifications: [], unreadCount: 3 };

  beforeEach(() => {
    vi.useFakeTimers();
    http = {
      get: vi.fn(() => of(response)),
      put: vi.fn(() => of({ message: 'Updated', remaining: 0 })),
      post: vi.fn(() => of({ deletedCount: 1 })),
      delete: vi.fn(() => of({})),
    };
    auth = {
      getCurrentUser: vi.fn(() => ({ _id: 'owner' })),
      getToken: vi.fn(() => 'session-a'),
      logout: vi.fn(),
    };
    service = new NotificationService(http, { register: vi.fn() } as any, auth);
  });
  afterEach(() => {
    service.disconnectStream();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shares concurrent requests and caches only within the current session', () => {
    const pending = new Subject<NotificationResponse>();
    http.get.mockReturnValue(pending);
    const one = vi.fn();
    const two = vi.fn();
    service.getNotifications({ limit: 5 }).subscribe(one);
    service.getNotifications({ limit: 5 }, '', true).subscribe(two);
    expect(http.get).toHaveBeenCalledTimes(1);
    pending.next(response);
    pending.complete();
    expect(one).toHaveBeenCalledWith(response);
    expect(two).toHaveBeenCalledWith(response);
    service.getNotifications({ limit: 5 }).subscribe();
    expect(http.get).toHaveBeenCalledTimes(1);
    auth.getToken.mockReturnValue('session-b');
    service.getNotifications({ limit: 5 }).subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('does not publish or cache late responses after logout or an identity switch', () => {
    const old = new Subject<NotificationResponse>();
    http.get.mockReturnValueOnce(old);
    const stale = vi.fn();
    service.getNotifications().subscribe(stale);
    service.disconnectStream();
    auth.getCurrentUser.mockReturnValue({ _id: 'another-owner' });
    auth.getToken.mockReturnValue('different-session');
    service.getNotifications().subscribe();
    old.next(response);
    old.complete();
    expect(stale).not.toHaveBeenCalled();
    service.getNotifications().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('invalidates navbar and page state after every mutation', async () => {
    const events = vi.fn();
    service.streamEvents$.subscribe(events);
    service.getNotifications().subscribe();
    service.markAsRead('notice').subscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveBeenCalledWith({ eventType: 'read' });
    service.getNotifications().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
    service.markAllAsRead().subscribe();
    service.deleteNotification('notice').subscribe();
    service.bulkDelete(['notice']).subscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toHaveBeenLastCalledWith({ eventType: 'delete' });
  });

  it('uses bearer headers, parses fragmented frames and cancels on logout', async () => {
    let enqueue!: (value: Uint8Array) => void;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue = (value) => controller.enqueue(value);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.fn();
    service.streamEvents$.subscribe(events);
    service.connectStream('owner', 'private-session-token');
    await vi.advanceTimersByTimeAsync(0);
    expect(service.streamConnected()).toBe(true);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/notifications\/stream$/);
    expect(url).not.toContain('token');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer private-session-token',
    );
    const encoder = new TextEncoder();
    enqueue(encoder.encode('id: 42\nevent: notifi'));
    enqueue(encoder.encode('cation\ndata: {"eventType":"reconcile"}\n\n'));
    await vi.advanceTimersByTimeAsync(1100);
    expect(events).toHaveBeenCalledWith({ eventType: 'stream' });
    service.disconnectStream();
    // Abort is handled by fetch in browsers; close this synthetic reader explicitly.
    enqueue(encoder.encode(': closed\n\n'));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.signal?.aborted).toBe(true);
    expect(service.streamConnected()).toBe(false);
    expect(cancelled).toBe(true);
  });

  it('preserves bounded inbox reconciliation when SSE repeatedly fails', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.fn();
    service.streamEvents$.subscribe(events);
    service.connectStream('owner', 'session');
    await vi.advanceTimersByTimeAsync(600000);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(9);
    expect(events).toHaveBeenCalledWith({ eventType: 'periodic' });
    service.disconnectStream();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('stops retrying revoked credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    service.connectStream('owner', 'revoked');
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
  it('publishes one shared inbox response to the navbar without another HTTP request', () => {
    const summary = vi.fn();
    service.summary$.subscribe(summary);
    service.getNotifications({ page: 1, limit: 10 }).subscribe();
    expect(summary).toHaveBeenLastCalledWith(response);
    service.getNotifications({ limit: 10, page: 1 }).subscribe();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('invalidates once for multiple listeners and coalesces a mutation burst', async () => {
    const one = vi.fn();
    const two = vi.fn();
    service.getNotifications().subscribe();
    service.streamEvents$.subscribe(one);
    service.streamEvents$.subscribe(two);
    service.markAsRead('one').subscribe();
    service.markAsRead('two').subscribe();
    service.deleteNotification('three').subscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    service.getNotifications().subscribe();
    service.getNotifications().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('lets pending reads complete before reconciling a newer mutation', async () => {
    const pending = new Subject<NotificationResponse>();
    http.get.mockReturnValueOnce(pending);
    const received = vi.fn();
    const updates = vi.fn();
    service.streamEvents$.subscribe(updates);
    service.getNotifications().subscribe(received);
    service.markAsRead('notice').subscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(updates).not.toHaveBeenCalled();
    pending.next(response);
    pending.complete();
    expect(received).toHaveBeenCalledWith(response);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it('updates unread summary locally without mutating the cached notification object', () => {
    const notice = { _id: 'notice', isRead: false } as any;
    http.get.mockReturnValueOnce(of({ notifications: [notice], unreadCount: 1, total: 1 }));
    const summary = vi.fn();
    service.summary$.subscribe(summary);
    service.getNotifications({ page: 1, limit: 10 }).subscribe();
    service.markAsRead('notice').subscribe();
    expect(summary).toHaveBeenLastCalledWith(expect.objectContaining({ unreadCount: 0 }));
    expect(notice.isRead).toBe(false);
    service.markAsRead('notice').subscribe();
    expect(summary).toHaveBeenLastCalledWith(expect.objectContaining({ unreadCount: 0 }));
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('does not publish scoped counts as a personal navbar summary', () => {
    const summary = vi.fn();
    service.summary$.subscribe(summary);
    service.getNotifications({ organizationId: 'organization' }).subscribe();
    expect(summary).toHaveBeenLastCalledWith(null);
  });

  it('rejects a late mutation response after account switching', async () => {
    const pending = new Subject<any>();
    http.put.mockReturnValueOnce(pending);
    const committed = vi.fn();
    const events = vi.fn();
    service.streamEvents$.subscribe(events);
    service.markAsRead('old-notice').subscribe(committed);
    service.disconnectStream();
    auth.getCurrentUser.mockReturnValue({ _id: 'another-owner' });
    pending.next({ message: 'Updated' });
    pending.complete();
    await vi.advanceTimersByTimeAsync(2000);
    expect(committed).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it('keeps a single stream and does not log out a newer session for an old 401', async () => {
    let finishOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => {
      finishOld = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    service.connectStream('owner', 'session-a');
    service.connectStream('owner', 'session-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    auth.getToken.mockReturnValue('session-b');
    service.connectStream('owner', 'session-b');
    finishOld(new Response('', { status: 401 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores duplicate/older SSE revisions and a connected snapshot already read by HTTP', async () => {
    let enqueue!: (value: Uint8Array) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue = (value) => controller.enqueue(value);
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    service.connectStream('owner', 'session-a');
    http.get.mockReturnValueOnce(of({ ...response, revision: 12 }));
    service.getNotifications().subscribe();
    const events = vi.fn();
    service.streamEvents$.subscribe(events);
    await vi.advanceTimersByTimeAsync(0);
    const encoder = new TextEncoder();
    for (const revision of [12, 12, 11]) enqueue(encoder.encode(`id: ${revision}\ndata: {}\n\n`));
    await vi.advanceTimersByTimeAsync(1100);
    expect(events).not.toHaveBeenCalled();
    for (const revision of [13, 14, 15]) enqueue(encoder.encode(`id: ${revision}\ndata: {}\n\n`));
    await vi.advanceTimersByTimeAsync(1100);
    expect(events).toHaveBeenCalledTimes(1);
    service.disconnectStream();
    enqueue(encoder.encode(': close\n\n'));
    await vi.advanceTimersByTimeAsync(0);
  });
  it('allows the navbar to reuse an unscoped feed but requires global counts for a scoped feed', () => {
    service.setInboxScope({});
    expect(service.hasUnscopedFeed).toBe(true);
    service.setInboxScope({ organizationId: 'organization' });
    expect(service.hasUnscopedFeed).toBe(false);
    service.setInboxScope(null);
    expect(service.hasUnscopedFeed).toBe(false);
  });
});
