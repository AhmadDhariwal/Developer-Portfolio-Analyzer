import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RecommendationsService } from './recommendations.service';
import { AuthService } from './auth.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';

describe('Recommendations Sprint contract', () => {
  let service: RecommendationsService;
  let http: HttpTestingController;
  let owner: string;
  const cache = {
    register: vi.fn(),
    clearScenarioCaches: vi.fn(),
    clearNewsCaches: vi.fn(),
    clearJobsCaches: vi.fn(),
    clearCoursesCaches: vi.fn(),
    clearCareerSprintCaches: vi.fn(),
    clearDashboardCaches: vi.fn(),
    clearWeeklyReportCaches: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    owner = 'fixture';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { getCurrentUser: () => ({ _id: owner }) } },
        { provide: FrontendCacheInvalidationService, useValue: cache },
      ],
    });
    service = TestBed.inject(RecommendationsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('sends only the authoritative recommendation identity and invalidates stale Sprint views after success', () => {
    const hash = 'a'.repeat(64);
    let duplicate = false;
    service
      .handoffToSprint('learning_fixture', hash)
      .subscribe((response) => (duplicate = response.alreadyAdded));
    const request = http.expectOne(
      `${environment.apiBaseUrl}/recommendations/learning_fixture/career-sprint`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ signalHash: hash });
    request.flush({ sprintId: 'sprint', alreadyAdded: true, route: '/app/career-sprint' });
    expect(duplicate).toBe(true);
    expect(cache.clearCareerSprintCaches).toHaveBeenCalledTimes(1);
  });
  it('propagates stale-context conflicts without showing success or invalidating Sprint views', () => {
    const error = vi.fn();
    service.handoffToSprint('learning_fixture', 'a'.repeat(64)).subscribe({ error });
    http
      .expectOne(`${environment.apiBaseUrl}/recommendations/learning_fixture/career-sprint`)
      .flush({ message: 'Refresh required' }, { status: 409, statusText: 'Conflict' });
    expect(error).toHaveBeenCalledOnce();
    expect(cache.clearCareerSprintCaches).not.toHaveBeenCalled();
  });
  it('does not share or emit saved-preview responses across account changes', () => {
    const old = vi.fn();
    const current = vi.fn();
    service.listSavedPreviews().subscribe(old);
    const previous = http.expectOne(`${environment.apiBaseUrl}/recommendations/saved-previews`);
    owner = 'second';
    service.listSavedPreviews().subscribe(current);
    const next = http.expectOne(`${environment.apiBaseUrl}/recommendations/saved-previews`);
    previous.flush({ previews: [{ _id: 'private-first' }] });
    next.flush({ previews: [{ _id: 'private-second' }] });
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledWith({ previews: [{ _id: 'private-second' }] });
  });

  it('isolates simultaneous profile generation by owner and drops invalidated responses', () => {
    const old = vi.fn();
    const current = vi.fn();
    service.getRecommendations('dev', 'Backend', 'Intern').subscribe(old);
    const previous = http.expectOne(`${environment.apiBaseUrl}/recommendations`);
    owner = 'second';
    service.getRecommendations('dev', 'Backend', 'Intern').subscribe(current);
    const next = http.expectOne(`${environment.apiBaseUrl}/recommendations`);
    previous.flush({ username: 'private-first' });
    service.clearCache();
    next.flush({ username: 'invalidated-second' });
    expect(old).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    service.getRecommendations('dev', 'Backend', 'Intern').subscribe();
    http.expectOne(`${environment.apiBaseUrl}/recommendations`).flush({ username: 'fresh' });
  });

  it('keeps temporary resume handles distinct even when the supplied hash matches', () => {
    service
      .getRecommendations(
        'dev',
        'Backend',
        'Intern',
        [],
        [],
        true,
        false,
        '',
        undefined,
        'handle-a',
        'same-hash',
      )
      .subscribe();
    service
      .getRecommendations(
        'dev',
        'Backend',
        'Intern',
        [],
        [],
        true,
        false,
        '',
        undefined,
        'handle-b',
        'same-hash',
      )
      .subscribe();
    const requests = http.match(`${environment.apiBaseUrl}/recommendations/generate`);
    expect(requests.length).toBe(2);
    requests.forEach((request) => request.flush({}));
  });
});
