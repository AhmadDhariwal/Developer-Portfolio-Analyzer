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
  const cache = {
    register: vi.fn(),
    clearCareerSprintCaches: vi.fn(),
    clearDashboardCaches: vi.fn(),
    clearWeeklyReportCaches: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { getCurrentUser: () => ({ _id: 'fixture' }) } },
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
});
