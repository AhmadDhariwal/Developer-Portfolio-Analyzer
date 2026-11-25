import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../../shared/services/auth.service';
import { CareerProfileService } from '../../../../shared/services/career-profile.service';
import { JobApplicationsService } from '../../../../shared/services/job-applications.service';
import { DEFAULT_CAREER_PROFILE } from '../../../../shared/models/career-profile.model';
import { JobsComponent } from './jobs.component';

describe('JobsComponent internal jobs tab integration', () => {
  function setup(initialView = 'discover') {
    const currentUser = { _id: 'dev-1', role: 'developer', name: 'Dev User' };
    const authMock = {
      currentUser$: new BehaviorSubject(currentUser).asObservable(),
      getCurrentUser: () => currentUser,
      getToken: () => 'test-token',
    };
    const profileMock = {
      careerProfile$: new BehaviorSubject({ ...DEFAULT_CAREER_PROFILE }).asObservable(),
    };
    const directApi = {
      discover: vi.fn().mockReturnValue(
        of({
          jobs: [
            {
              _id: 'ij-1',
              organizationName: 'Alpha Engineering',
              title: 'Staff Systems Engineer',
              description: 'Build distributed services.',
              location: 'Remote',
              employmentType: 'full-time',
              requiredSkills: ['TypeScript', 'Node.js'],
              minExperienceYears: 4,
            },
          ],
        }),
      ),
      options: vi.fn().mockReturnValue(
        of({
          portfolioHash: 'hash-1',
          resumes: [{ _id: 'res-1', fileName: 'cv.pdf', uploadDate: '2026-11-21' }],
          portfolio: null,
        }),
      ),
      mine: vi.fn().mockReturnValue(of({ applications: [] })),
      submit: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [JobsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authMock },
        { provide: CareerProfileService, useValue: profileMock },
        { provide: JobApplicationsService, useValue: directApi },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({ view: initialView }) },
          },
        },
      ],
    });

    const httpMock = TestBed.inject(HttpTestingController);
    const fixture: ComponentFixture<JobsComponent> = TestBed.createComponent(JobsComponent);
    return { fixture, httpMock, directApi };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('places Internal jobs alongside existing tabs and isolates internal workspace requests', () => {
    const { fixture, httpMock, directApi } = setup('discover');
    fixture.detectChanges();

    const discoverReq = httpMock.match(
      (req) =>
        req.url.includes('/api/jobs') &&
        !req.url.includes('/api/jobs/internal') &&
        !req.url.includes('/api/jobs/actions'),
    );
    discoverReq.forEach((req) =>
      req.flush({ jobs: [], page: 1, total: 0, totalPages: 0, hasMore: false }),
    );
    const actionReqs = httpMock.match((req) => req.url.includes('/api/jobs/actions'));
    actionReqs.forEach((req) => req.flush({ records: [] }));

    fixture.detectChanges();

    const tabButtons = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.view-tabs .tab-btn',
      ) as NodeListOf<HTMLButtonElement>,
    );
    expect(tabButtons.map((b) => b.textContent?.trim())).toEqual([
      'Discover',
      'Internal jobs',
      'Saved jobs',
      'Application tracker',
      'Hidden',
    ]);
    expect(fixture.nativeElement.querySelector('app-internal-jobs')).toBeNull();

    const internalTab = tabButtons.find((b) => b.textContent?.trim() === 'Internal jobs')!;
    internalTab.click();
    fixture.detectChanges();

    httpMock.expectNone(
      (req) => req.url.includes('/api/jobs') && !req.url.includes('/api/jobs/internal'),
    );
    expect(fixture.nativeElement.querySelector('app-internal-jobs')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-job-filters')).toBeNull();
    expect(directApi.discover).toHaveBeenCalledTimes(1);
    httpMock.verify();
  });

  it('supports deep-linking directly to ?view=internal without firing external job searches', () => {
    const { fixture, httpMock, directApi } = setup('internal');
    fixture.detectChanges();

    httpMock.expectNone(
      (req) => req.url.includes('/api/jobs') && !req.url.includes('/api/jobs/internal'),
    );
    expect(fixture.componentInstance.view).toBe('internal');
    expect(fixture.nativeElement.querySelector('app-internal-jobs')).toBeTruthy();
    expect(directApi.discover).toHaveBeenCalledTimes(1);
    httpMock.verify();
  });
});
