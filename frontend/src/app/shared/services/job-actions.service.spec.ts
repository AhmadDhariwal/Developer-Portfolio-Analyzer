import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { JobActionsService } from './job-actions.service';
import { AuthService } from './auth.service';
import { JobService } from './job.service';
import { Job } from '../models/job.model';

describe('persistent job actions', () => {
  let actions: JobActionsService;
  let http: HttpTestingController;
  let user: BehaviorSubject<any>;
  const key = 'devinsight_public_jobs_state:owner-a';
  beforeEach(() => {
    localStorage.clear();
    user = new BehaviorSubject({ _id: 'owner-a' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        JobActionsService,
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value },
        },
        {
          provide: JobService,
          useValue: { clearCache: () => {}, getJobById: vi.fn((id: string) => of({ id })) },
        },
      ],
    });
    actions = TestBed.inject(JobActionsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    localStorage.clear();
  });

  it('waits for server acknowledgement and sends only an allowlisted patch', async () => {
    const result = firstValueFrom(actions.update('job/1', { saved: true }));
    expect(actions.state('job/1').saved).toBe(false);
    expect(actions.isBusy('job/1')).toBe(true);
    const request = http.expectOne((request) => request.url.endsWith('/jobs/job%2F1/actions'));
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ saved: true });
    request.flush({ action: { jobId: 'job/1', saved: true, applied: false, hidden: false } });
    await result;
    expect(actions.state('job/1').saved).toBe(true);
    expect(actions.isBusy('job/1')).toBe(false);
  });
  it('keeps state unchanged on Redis/service failure', async () => {
    const result = firstValueFrom(actions.update('x', { applied: true })).catch(
      (error) => error.status,
    );
    http
      .expectOne((request) => request.url.endsWith('/x/actions'))
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(await result).toBe(503);
    expect(actions.state('x').applied).toBe(false);
  });
  it('honors Retry-After and prevents another mutation during the cooldown', async () => {
    const result = firstValueFrom(actions.update('x', { saved: true })).catch(() => {});
    http
      .expectOne((request) => request.url.endsWith('/x/actions'))
      .flush({}, { status: 429, statusText: 'Limited', headers: { 'Retry-After': '120' } });
    await result;
    expect(actions.retryAt).toBeGreaterThan(Date.now() + 110000);
    await expect(firstValueFrom(actions.update('y', { saved: true }))).rejects.toThrow();
    http.expectNone((request) => request.method === 'PUT');
  });
  it('clears owner state and cancels in-flight writes on account switch', () => {
    actions.update('x', { saved: true }).subscribe();
    const request = http.expectOne((request) => request.method === 'PUT');
    user.next({ _id: 'owner-b' });
    expect(request.cancelled).toBe(true);
    expect(actions.state('x').saved).toBe(false);
  });
  it('never imports anonymous or other-account legacy state', () => {
    localStorage.setItem(
      'devinsight_public_jobs_state:anonymous',
      JSON.stringify({ x: { saved: true } }),
    );
    localStorage.setItem(
      'devinsight_public_jobs_state:owner-b',
      JSON.stringify({ y: { applied: true } }),
    );
    expect(actions.legacy()).toEqual({});
  });
  it('reconciles server records without reviving stale flags and imports absent records once', async () => {
    localStorage.setItem(
      key,
      JSON.stringify({ old: { saved: true }, next: { saved: true, applied: true } }),
    );
    const result = actions.importLegacy();
    http
      .expectOne((request) => request.url.endsWith('/actions') && request.method === 'GET')
      .flush({
        actions: [{ jobId: 'old', saved: false, applied: false, hidden: false }],
        hasMore: false,
        page: 1,
      });
    await Promise.resolve();
    await Promise.resolve();
    const request = await vi.waitFor(() => http.expectOne((request) => request.method === 'PUT'));
    expect(request.request.body).toEqual({ saved: true, applied: true });
    request.flush({ action: { jobId: 'next', saved: true, applied: true, hidden: false } });
    expect((await result).imported).toBe(1);
    expect(actions.state('old').saved).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({});
  });
  it('preserves local records when their source listing has expired', async () => {
    localStorage.setItem(key, JSON.stringify({ expired: { saved: true } }));
    const result = actions.importLegacy();
    http
      .expectOne((request) => request.method === 'GET')
      .flush({ actions: [], page: 1, hasMore: false });
    await Promise.resolve();
    await Promise.resolve();
    (await vi.waitFor(() => http.expectOne((request) => request.method === 'PUT'))).flush(
      {},
      { status: 404, statusText: 'Gone' },
    );
    expect((await result).unavailable).toBe(1);
    expect(localStorage.getItem(key)).toContain('expired');
  });
  it('reconciles external aliases against canonical history without reviving a false flag', async () => {
    vi.spyOn(TestBed.inject(JobService), 'getJobById').mockReturnValue(
      of({ id: 'canonical' } as Job),
    );
    localStorage.setItem(key, JSON.stringify({ alias: { saved: true } }));
    const result = actions.importLegacy();
    http
      .expectOne((request) => request.method === 'GET')
      .flush({
        actions: [{ jobId: 'canonical', saved: false, applied: false, hidden: false }],
        page: 1,
        hasMore: false,
      });
    expect((await result).reconciled).toBe(1);
    http.expectNone((request) => request.method === 'PUT');
    expect(actions.state('canonical').saved).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({});
  });
  it('imports two aliases of the same listing only once', async () => {
    vi.spyOn(TestBed.inject(JobService), 'getJobById').mockReturnValue(
      of({ id: 'canonical' } as Job),
    );
    localStorage.setItem(
      key,
      JSON.stringify({ firstAlias: { saved: true }, secondAlias: { saved: true } }),
    );
    const result = actions.importLegacy();
    http
      .expectOne((request) => request.method === 'GET')
      .flush({ actions: [], page: 1, hasMore: false });
    const request = await vi.waitFor(() => http.expectOne((request) => request.method === 'PUT'));
    expect(request.request.url).toContain('/canonical/actions');
    request.flush({ action: { jobId: 'canonical', saved: true, applied: false, hidden: false } });
    expect(await result).toEqual({ imported: 1, reconciled: 1, unavailable: 0 });
    http.expectNone((request) => request.method === 'PUT');
  });
});
