import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SupportService } from './support.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';

describe('SupportService', () => {
  let service: SupportService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SupportService,
        FrontendCacheInvalidationService,
      ],
    });
    service = TestBed.inject(SupportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function flushMyTickets() {
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/support/my-tickets?page=1&limit=5`);
    req.flush({ tickets: [], pagination: { page: 1, limit: 5, total: 0, pages: 1 } });
  }

  it('caches getMyTickets responses within the TTL', () => {
    service.getMyTickets(1, 5).subscribe();
    service.getMyTickets(1, 5).subscribe();
    // Only one HTTP call because the second is served from cache.
    flushMyTickets();
  });

  it('clears the cache when a reply is posted (mutation invalidates cache)', () => {
    service.getMyTickets(1, 5).subscribe();
    flushMyTickets();

    service.addReply('abc', 'hello').subscribe();
    const replyReq = httpMock.expectOne(`${environment.apiBaseUrl}/support/tickets/abc/replies`);
    expect(replyReq.request.body).toEqual({ body: 'hello' });
    replyReq.flush({ message: 'ok', ticket: {} });

    // Cache was cleared, so a fresh request hits the network again.
    service.getMyTickets(1, 5).subscribe();
    flushMyTickets();
  });

  it('builds admin ticket queries omitting empty params', () => {
    service.adminGetTickets({ page: 2, status: 'open', search: '' }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiBaseUrl}/support/admin/tickets`,
    );
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('status')).toBe('open');
    expect(req.request.params.has('search')).toBe(false);
    req.flush({ tickets: [], pagination: { page: 2, limit: 10, total: 0, pages: 1 } });
  });

  it('sends expectedUpdatedAt on admin status update and clears cache', () => {
    service.adminUpdateStatus('t1', 'resolved', '2026-01-01T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/support/admin/tickets/t1/status`);
    expect(req.request.body).toEqual({
      status: 'resolved',
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    req.flush({ message: 'ok', ticket: {} });
  });
});
