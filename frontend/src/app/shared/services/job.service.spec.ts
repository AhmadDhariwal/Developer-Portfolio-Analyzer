import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';
import { JobService } from './job.service';

describe('JobService caching', () => {
  let service: JobService;
  let httpMock: HttpTestingController;
  let user: BehaviorSubject<any>;

  beforeEach(() => {
    user = new BehaviorSubject({ _id: 'owner-a', activeCareerStack: 'Backend' });
    TestBed.configureTestingModule({
      providers: [
        JobService,
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value },
        },
        { provide: FrontendCacheInvalidationService, useValue: { register: () => {} } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(JobService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify({ ignoreCancelled: true });
    vi.restoreAllMocks();
  });

  it('shares one request for repeated getJobs subscriptions with the same params', async () => {
    const firstPromise = firstValueFrom(service.getJobs({ skills: 'Angular' }, 1, 10));
    const secondPromise = firstValueFrom(service.getJobs({ skills: 'Angular' }, 1, 10));

    const request = httpMock.expectOne(
      `${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=Angular`,
    );
    request.flush({
      jobs: [
        {
          id: 'job-1',
          title: 'Frontend Engineer',
          company: 'Acme',
          url: 'https://example.com/jobs/1',
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.jobs.length).toBe(1);
    expect(second.jobs.length).toBe(1);
    httpMock.expectNone(`${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=Angular`);
  });

  it('reuses the cached getJobs response on a later call with the same params', async () => {
    const initialPromise = firstValueFrom(service.getJobs({ location: 'Remote' }, 1, 10));

    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&location=Remote`).flush({
      jobs: [
        {
          id: 'job-2',
          title: 'Remote Engineer',
          company: 'Northwind',
          url: 'https://example.com/jobs/2',
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });

    await initialPromise;

    const cached = await firstValueFrom(service.getJobs({ location: 'Remote' }, 1, 10));

    expect(cached.jobs[0]?.title).toBe('Remote Engineer');
    httpMock.expectNone(`${environment.apiBaseUrl}/jobs?page=1&limit=10&location=Remote`);
  });

  it('creates a new request when the filter key changes', async () => {
    const angularPromise = firstValueFrom(service.getJobs({ skills: 'Angular' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=Angular`).flush({
      jobs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await angularPromise;

    const reactPromise = firstValueFrom(service.getJobs({ skills: 'React' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=React`).flush({
      jobs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await reactPromise;
  });

  it('clears cached job queries when clearCache is called', async () => {
    const firstPromise = firstValueFrom(service.getJobs({ platform: 'LinkedIn' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&platform=LinkedIn`).flush({
      jobs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await firstPromise;

    service.clearCache();

    const secondPromise = firstValueFrom(service.getJobs({ platform: 'LinkedIn' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&platform=LinkedIn`).flush({
      jobs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await secondPromise;
  });

  it('expires client results after 30 seconds without requesting provider refresh', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = firstValueFrom(service.getJobs());
    httpMock
      .expectOne((request) => request.url.endsWith('/jobs'))
      .flush({ jobs: [], total: 0, page: 1, totalPages: 1 });
    await first;
    now += 30001;
    const next = firstValueFrom(service.getJobs());
    const request = httpMock.expectOne((request) => request.url.endsWith('/jobs'));
    expect(request.request.params.has('forceRefresh')).toBe(false);
    request.flush({ jobs: [], total: 0, page: 1, totalPages: 1 });
    await next;
  });
  it('cancels unobserved HTTP requests and does not reuse an aborted replay', () => {
    const subscription = service.getJobs().subscribe();
    const request = httpMock.expectOne((request) => request.url.endsWith('/jobs'));
    subscription.unsubscribe();
    expect(request.cancelled).toBe(true);
    const retry = service.getJobs().subscribe();
    const second = httpMock.expectOne((request) => request.url.endsWith('/jobs'));
    second.flush({ jobs: [], total: 0, page: 1, totalPages: 1 });
    retry.unsubscribe();
  });
  it('isolates accounts and cancels responses after a session switch', () => {
    service.getJobs().subscribe();
    const old = httpMock.expectOne((request) => request.url.endsWith('/jobs'));
    user.next({ _id: 'owner-b', activeCareerStack: 'Backend' });
    expect(old.cancelled).toBe(true);
    service.getJobs().subscribe();
    httpMock
      .expectOne((request) => request.url.endsWith('/jobs'))
      .flush({ jobs: [], page: 1, totalPages: 1 });
  });
  it('preserves authoritative metadata and does not invent an unknown score', async () => {
    const result = firstValueFrom(service.getJobs());
    httpMock
      .expectOne((request) => request.url.endsWith('/jobs'))
      .flush({
        jobs: [
          {
            id: 'x',
            title: 'Engineer',
            company: 'Example',
            salaryMetadata: { min: 100, max: 200, currency: 'PKR', period: 'month' },
            lastSynced: '2026-10-19',
            actions: { saved: true, applied: false, hidden: false },
          },
        ],
        page: 1,
        totalPages: 1,
        personalization: { status: 'career-context-only' },
      });
    const response = await result;
    expect(response.jobs[0].matchScore).toBeUndefined();
    expect(response.jobs[0].actions?.saved).toBe(true);
    expect(response.jobs[0].salaryMetadata?.currency).toBe('PKR');
    expect(response.personalization?.status).toBe('career-context-only');
  });
});
