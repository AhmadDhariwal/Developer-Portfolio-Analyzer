import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { CoursesComponent } from './courses.component';
import { CourseService } from '../../shared/services/course.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { CourseLearningStore } from './services/course-learning.store';
import { Course, CoursesResponse } from '../../shared/models/course.model';

const course = (id: string): Course => ({
  id,
  title: id,
  platform: 'Udemy',
  url: 'https://www.udemy.com/course/angular/',
  topics: ['Angular'],
});
const response = (ids = ['z', 'a'], page = 1): CoursesResponse => ({
  courses: ids.map(course),
  page,
  total: 3,
  totalPages: 2,
  hasMore: page === 1,
});
describe('Learning Hub discovery lifecycle', () => {
  let component: CoursesComponent;
  const api = { getCourses: vi.fn(), clearCache: vi.fn() };
  beforeEach(() => {
    vi.resetAllMocks();
    api.getCourses.mockReturnValue(of(response()));
    const query = convertToParamMap({ skill: 'Angular' });
    component = new CoursesComponent(
      api as unknown as CourseService,
      {
        careerStack: 'Frontend',
        experienceLevel: 'Student',
        isConfigured: true,
        careerProfile$: new BehaviorSubject({
          careerStack: 'Frontend',
          experienceLevel: 'Student',
        }),
      } as unknown as CareerProfileService,
      { snapshot: { queryParamMap: query }, queryParamMap: of(query) } as ActivatedRoute,
      { load: vi.fn() } as unknown as CourseLearningStore,
      { markForCheck: vi.fn(), detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.ngOnInit();
  });
  afterEach(() => component.ngOnDestroy());
  it('ingests skill deep links and preserves backend order across pages', () => {
    expect(component.activeFilters.topic).toBe('Angular');
    api.getCourses.mockReturnValue(of(response(['a', 'b'], 2)));
    component.loadMore();
    expect(component.allCourses.map((item) => item.id)).toEqual(['z', 'a', 'b']);
  });
  it('retains previous results on failed refresh and sends the backend refresh flag', () => {
    api.getCourses.mockReturnValue(
      throwError(() => ({ error: { message: 'Provider unavailable' } })),
    );
    component.refreshCourses();
    expect(component.allCourses.map((item) => item.id)).toEqual(['z', 'a']);
    expect(component.errorMessage).toBe('Provider unavailable');
    expect(api.getCourses).toHaveBeenLastCalledWith(component.activeFilters, 1, 10, {
      refresh: true,
    });
  });
  it('ignores stale responses after filters change', () => {
    const stale = new Subject<CoursesResponse>();
    api.getCourses.mockReturnValueOnce(stale).mockReturnValueOnce(of(response(['new'])));
    component.onFiltersChange({ ...component.activeFilters, topic: 'Old' });
    component.onFiltersChange({ ...component.activeFilters, topic: 'New' });
    stale.next(response(['stale']));
    expect(component.allCourses[0].id).toBe('new');
  });
  it('retries the failed next page without discarding existing results', () => {
    api.getCourses
      .mockReturnValueOnce(throwError(() => ({ status: 503 })))
      .mockReturnValueOnce(of(response(['b'], 2)));
    component.loadMore();
    expect(component.allCourses).toHaveLength(2);
    component.retryLoad();
    expect(component.allCourses.map((item) => item.id)).toEqual(['z', 'a', 'b']);
  });
  it('can reapply a former filter after clearing a chip', () => {
    component.onFiltersChange({ ...component.activeFilters, platform: 'YouTube' });
    component.clearFilter('platform');
    const before = api.getCourses.mock.calls.length;
    component.onFiltersChange({ ...component.activeFilters, platform: 'YouTube' });
    expect(api.getCourses).toHaveBeenCalledTimes(before + 1);
    expect(api.getCourses.mock.calls.at(-1)?.[0].platform).toBe('YouTube');
  });
  it('tears down pending discovery subscriptions', () => {
    const pending = new Subject<CoursesResponse>();
    api.getCourses.mockReturnValue(pending);
    component.onFiltersChange({ ...component.activeFilters, topic: 'Pending' });
    component.ngOnDestroy();
    pending.next(response(['after-destroy']));
    expect(component.allCourses).toHaveLength(0);
  });
});
