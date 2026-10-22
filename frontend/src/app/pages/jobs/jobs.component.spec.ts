import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { JobsComponent } from './jobs.component';
import { JobService } from '../../shared/services/job.service';
import { JobActionsService } from '../../shared/services/job-actions.service';
import { AuthService } from '../../shared/services/auth.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { JobsResponse } from '../../shared/models/job.model';

describe('Jobs Hub request lifecycle', () => {
  let response: Subject<JobsResponse>;
  let user: BehaviorSubject<any>;
  let api: { getJobs: ReturnType<typeof vi.fn>; clearCache: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    response = new Subject();
    user = new BehaviorSubject({ _id: 'owner-a' });
    api = { getJobs: vi.fn(() => response), clearCache: vi.fn() };
    TestBed.configureTestingModule({
      imports: [JobsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value },
        },
        {
          provide: CareerProfileService,
          useValue: {
            careerProfile$: of({ careerStack: 'Backend' }),
            careerStack: 'Backend',
            experienceLevel: '1-2 years',
          },
        },
        { provide: JobService, useValue: api },
        {
          provide: JobActionsService,
          useValue: {
            changes$: of(0),
            seed: vi.fn(),
            legacy: () => ({}),
            state: () => ({ saved: false, applied: false, hidden: false }),
            isBusy: () => false,
            retryAt: 0,
          },
        },
      ],
    });
  });
  it('retains usable results on 503 and blocks retry during Retry-After', () => {
    const fixture = TestBed.createComponent(JobsComponent);
    fixture.detectChanges();
    response.next({
      jobs: [{ id: 'one', title: 'Platform engineer', company: 'Example', skills: [] } as any],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    response.complete();
    response = new Subject();
    fixture.componentInstance.revalidate();
    response.error(
      new HttpErrorResponse({ status: 503, headers: new HttpHeaders({ 'Retry-After': '30' }) }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Platform engineer');
    expect(fixture.nativeElement.textContent).toContain('temporarily unavailable');
    const calls = api.getJobs.mock.calls.length;
    fixture.componentInstance.revalidate();
    expect(api.getJobs).toHaveBeenCalledTimes(calls);
  });
  it('cancels an obsolete search and does not display its late response', () => {
    const fixture = TestBed.createComponent(JobsComponent);
    fixture.detectChanges();
    const old = response;
    response = new Subject();
    fixture.componentInstance.search('TypeScript');
    fixture.componentInstance.applyFilters();
    old.next({ jobs: [{ id: 'old' }] } as JobsResponse);
    response.next({ jobs: [], total: 0, page: 1, totalPages: 1, hasMore: false });
    expect(fixture.componentInstance.jobs).toEqual([]);
    expect(api.getJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ skills: 'TypeScript' }),
      1,
      10,
    );
  });
  it('clears personalized content immediately on logout', () => {
    const fixture = TestBed.createComponent(JobsComponent);
    fixture.detectChanges();
    response.next({ jobs: [{ id: 'private' }] } as JobsResponse);
    user.next(null);
    expect(fixture.componentInstance.jobs).toEqual([]);
    expect(fixture.componentInstance.response).toBeNull();
  });
  it('reloads when the active developer identity changes and keeps an existing request cooldown', () => {
    const fixture = TestBed.createComponent(JobsComponent);
    fixture.detectChanges();
    response.next({ jobs: [{ id: 'old-context' }] } as JobsResponse);
    const next = new Subject<JobsResponse>();
    api.getJobs.mockReturnValue(next);
    user.next({ _id: 'owner-a', activeGithubUsername: 'another-developer' });
    expect(api.getJobs).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.jobs).toEqual([]);
    next.error(
      new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '60' }) }),
    );
    user.next({ _id: 'owner-a', activeGithubUsername: 'third-developer' });
    expect(api.getJobs).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.coolingDown).toBe(true);
  });
});
