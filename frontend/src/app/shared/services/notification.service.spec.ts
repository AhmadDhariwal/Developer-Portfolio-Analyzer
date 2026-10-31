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
    await vi.advanceTimersByTimeAsync(250);
    expect(events).toHaveBeenCalledWith({ eventType: 'read' });
    service.getNotifications().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
    service.markAllAsRead().subscribe();
    service.deleteNotification('notice').subscribe();
    service.bulkDelete(['notice']).subscribe();
    await vi.advanceTimersByTimeAsync(250);
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
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/notifications\/stream$/);
    expect(url).not.toContain('token');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer private-session-token',
    );
    const encoder = new TextEncoder();
    enqueue(encoder.encode('id: 42\nevent: notifi'));
    enqueue(encoder.encode('cation\ndata: {"eventType":"reconcile"}\n\n'));
    await vi.advanceTimersByTimeAsync(300);
    expect(events).toHaveBeenCalledWith({ eventType: 'stream' });
    service.disconnectStream();
    // Abort is handled by fetch in browsers; close this synthetic reader explicitly.
    enqueue(encoder.encode(': closed\n\n'));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.signal?.aborted).toBe(true);
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
});
