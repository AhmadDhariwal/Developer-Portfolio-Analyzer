import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { JobService } from './job.service';

describe('JobService caching', () => {
  let service: JobService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        JobService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(JobService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('shares one request for repeated getJobs subscriptions with the same params', async () => {
    const firstPromise = firstValueFrom(service.getJobs({ skills: 'Angular' }, 1, 10));
    const secondPromise = firstValueFrom(service.getJobs({ skills: 'Angular' }, 1, 10));

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=Angular`);
    request.flush({
      jobs: [{ id: 'job-1', title: 'Frontend Engineer', company: 'Acme', url: 'https://example.com/jobs/1' }],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.jobs.length).toBe(1);
    expect(second.jobs.length).toBe(1);
    httpMock.expectNone(`${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=Angular`);
  });

  it('reuses the cached getJobs response on a later call with the same params', async () => {
    const initialPromise = firstValueFrom(service.getJobs({ location: 'Remote' }, 1, 10));

    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&location=Remote`).flush({
      jobs: [{ id: 'job-2', title: 'Remote Engineer', company: 'Northwind', url: 'https://example.com/jobs/2' }],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false
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
      hasMore: false
    });
    await angularPromise;

    const reactPromise = firstValueFrom(service.getJobs({ skills: 'React' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&skills=React`).flush({
      jobs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false
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
      hasMore: false
    });
    await firstPromise;

    service.clearCache();

    const secondPromise = firstValueFrom(service.getJobs({ platform: 'LinkedIn' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/jobs?page=1&limit=10&platform=LinkedIn`).flush({
      jobs: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false
    });
    await secondPromise;
  });
});
