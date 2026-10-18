import { environment } from '../../../environments/environment';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { CareerSprint, CareerSprintService } from './career-sprint.service';
import { ApiService } from './api.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { CourseService } from './course.service';
import { RecommendationsService } from './recommendations.service';
import { AuthService } from './auth.service';
import { sprintFixture } from '../../pages/career-sprint/testing/sprint.fixture';

describe('Career Sprint HTTP contracts and handoff invalidation', () => {
  let service: CareerSprintService;
  let http: HttpTestingController;
  const callbacks = new Map<string, () => void>();
  const invalidation = {
    register: (owner: string, clear: () => void) => callbacks.set(owner, clear),
    clearCareerSprintCaches: vi.fn(() => callbacks.get('career-sprint')?.()),
    clearDashboardCaches: vi.fn(),
    clearWeeklyReportCaches: vi.fn(),
    clearScenarioCaches: vi.fn(),
    clearNewsCaches: vi.fn(),
    clearRecommendationsCaches: vi.fn(),
    clearJobsCaches: vi.fn(),
  };
  const api = {
    getCurrentCareerSprint: vi.fn(),
    getCareerSprintHistory: vi.fn(),
    createCareerSprint: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    callbacks.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CareerSprintService,
        { provide: ApiService, useValue: api },
        { provide: FrontendCacheInvalidationService, useValue: invalidation },
        { provide: AuthService, useValue: { getCurrentUser: () => ({ _id: 'owner' }) } },
      ],
    });
    service = TestBed.inject(CareerSprintService);
    http = TestBed.inject(HttpTestingController);
    const client = TestBed.inject(HttpClient);
    api.getCurrentCareerSprint.mockImplementation((force) =>
      client.get(
        `${environment.apiBaseUrl}/career-sprints/current${force ? '?forceRefresh=true' : ''}`,
      ),
    );
  });
  afterEach(() => http.verify());

  it('shares pending current reads but revalidates completed reads with the backend', () => {
    const values: CareerSprint[] = [];
    service.getCurrent('owner').subscribe((value) => values.push(value));
    service.getCurrent('owner').subscribe((value) => values.push(value));
    http.expectOne(`${environment.apiBaseUrl}/career-sprints/current`).flush(sprintFixture());
    expect(values).toHaveLength(2);
    expect(service.getCurrentCached('owner')?.xpPoints).toBe(137);
    service.getCurrent('owner').subscribe();
    http
      .expectOne(`${environment.apiBaseUrl}/career-sprints/current`)
      .flush(sprintFixture({ xpPoints: 151 }));
    expect(service.getCurrentCached('owner')?.xpPoints).toBe(151);
  });
  it('does not let a late response repopulate cache after a handoff or logout invalidation', () => {
    const pending = new Subject<CareerSprint>();
    api.getCurrentCareerSprint.mockReturnValue(pending);
    service.getCurrent('owner').subscribe();
    service.clearCache();
    pending.next(sprintFixture());
    pending.complete();
    expect(service.getCurrentCached('owner')).toBeNull();
    api.getCareerSprintHistory.mockReturnValue(of({ history: [sprintFixture()] }));
    service.getHistory(12, 'other').subscribe();
    expect(service.getHistoryCached(12, 'owner')).toBeNull();
  });
  it('sends exact selective indexes and current fingerprint; preserves server metadata and invalidates dependents', () => {
    service.importDraft('sprint-one', 'draft-one', [0, 2], 'fresh-fingerprint').subscribe();
    const request = http.expectOne(
      `${environment.apiBaseUrl}/career-sprints/sprint-one/ai-plans/draft-one/tasks`,
    );
    expect(request.request.body).toEqual({
      taskIndexes: [0, 2],
      acknowledgeContextFingerprint: 'fresh-fingerprint',
    });
    request.flush(sprintFixture());
    expect(invalidation.clearCareerSprintCaches).toHaveBeenCalledOnce();
    expect(invalidation.clearDashboardCaches).toHaveBeenCalledOnce();
    expect(invalidation.clearRecommendationsCaches).toHaveBeenCalledOnce();
  });
  it('uses supported edit/delete/draft/preference endpoints without a completion field in edits', () => {
    const payload = {
      title: 'Updated',
      description: '',
      points: 4,
      category: 'project' as const,
      priority: 'high' as const,
      startDate: null,
      endDate: null,
    };
    service.editTask('sprint-one', 'task-one', payload).subscribe();
    const edit = http.expectOne(
      `${environment.apiBaseUrl}/career-sprints/sprint-one/tasks/task-one`,
    );
    expect(edit.request.method).toBe('PUT');
    expect(edit.request.body).toEqual(payload);
    edit.flush(sprintFixture());
    service.deleteTask('sprint-one', 'task-one').subscribe();
    const remove = http.expectOne(
      `${environment.apiBaseUrl}/career-sprints/sprint-one/tasks/task-one`,
    );
    expect(remove.request.method).toBe('DELETE');
    remove.flush(sprintFixture());
    service.deleteDraft('sprint-one', 'draft-one').subscribe();
    http
      .expectOne(`${environment.apiBaseUrl}/career-sprints/sprint-one/ai-plans/draft-one`)
      .flush(sprintFixture());
    service.savePreferences('America/New_York').subscribe();
    const zone = http.expectOne(`${environment.apiBaseUrl}/career-sprints/preferences`);
    expect(zone.request.body).toEqual({ timeZone: 'America/New_York' });
    zone.flush({ timeZone: 'America/New_York' });
  });
  it('existing Learning Hub and Recommendations handoffs invalidate Sprint reads, including already-added results', () => {
    TestBed.inject(CourseService).addToSprint('course-one').subscribe();
    const course = http.expectOne(`${environment.apiBaseUrl}/courses/course-one/career-sprint`);
    expect(course.request.body).toEqual({});
    course.flush({ sprintId: 'sprint-one', alreadyAdded: true, route: '/app/career-sprint' });
    TestBed.inject(RecommendationsService).handoffToSprint('action-one', 'source-hash').subscribe();
    const recommendation = http.expectOne(
      `${environment.apiBaseUrl}/recommendations/action-one/career-sprint`,
    );
    expect(recommendation.request.body).toEqual({ signalHash: 'source-hash' });
    recommendation.flush({
      sprintId: 'sprint-one',
      alreadyAdded: false,
      route: '/app/career-sprint',
    });
    expect(invalidation.clearCareerSprintCaches).toHaveBeenCalledTimes(2);
  });
});
