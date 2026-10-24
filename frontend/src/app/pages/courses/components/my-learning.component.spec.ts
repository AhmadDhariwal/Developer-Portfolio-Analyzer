import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { MyLearningComponent } from './my-learning.component';
import { CourseLearningStore } from '../services/course-learning.store';
import { CourseService } from '../../../shared/services/course.service';
import { MyLearningResponse, UserCourseProgress } from '../../../shared/models/course.model';

const record = {
  courseId: 'fb_a1',
  course: {
    id: 'fb_a1',
    title: 'SQL',
    platform: 'Udemy',
    url: 'https://www.udemy.com/course/sql/',
    topics: ['SQL'],
  },
  status: 'saved',
  notes: '',
  progressPercent: null,
} as UserCourseProgress;
const result = (courses = [record], page = 1): MyLearningResponse => ({
  courses,
  page,
  totalPages: 2,
  total: 11,
});
describe('My Learning workspace', () => {
  let fixture: ComponentFixture<MyLearningComponent>;
  const api = { getMyLearning: vi.fn() };
  const store = {
    revision: signal(0),
    records: signal({}),
    actions: signal({}),
    ready: signal(true),
    save: vi.fn(),
    remove: vi.fn(),
    addToSprint: vi.fn(),
    load: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    store.revision.set(0);
    api.getMyLearning.mockReturnValue(of(result()));
    TestBed.configureTestingModule({
      imports: [MyLearningComponent],
      providers: [
        provideRouter([]),
        { provide: CourseService, useValue: api },
        { provide: CourseLearningStore, useValue: store },
      ],
    });
    fixture = TestBed.createComponent(MyLearningComponent);
    fixture.detectChanges();
  });
  it('uses server pagination and status filtering instead of a local subset', () => {
    const component = fixture.componentInstance;
    api.getMyLearning.mockReturnValueOnce(of(result([{ ...record, courseId: 'fb_b1' }], 2)));
    component.load(2);
    expect(component.records).toHaveLength(2);
    api.getMyLearning.mockReturnValueOnce(of(result([])));
    component.status = 'completed';
    component.changeFilter();
    fixture.detectChanges();
    expect(api.getMyLearning).toHaveBeenLastCalledWith('completed', 1, 10);
    expect(component.records).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No courses in this status');
  });
  it('preserves loaded records when refresh fails and reports the failure', () => {
    api.getMyLearning.mockReturnValueOnce(
      throwError(() => ({ status: 503, error: { message: 'Learning outage' } })),
    );
    fixture.componentInstance.refresh();
    fixture.detectChanges();
    expect(fixture.componentInstance.records[0]).toEqual(record);
    expect(fixture.nativeElement.textContent).toContain(
      'Previously loaded learning records are still shown.',
    );
    expect(fixture.nativeElement.textContent).toContain('Learning outage');
  });
  it('cancels the old page read when a new status filter is selected', () => {
    const pending = new Subject<MyLearningResponse>();
    api.getMyLearning.mockReturnValueOnce(pending).mockReturnValueOnce(of(result([])));
    fixture.componentInstance.refresh();
    fixture.componentInstance.status = 'in_progress';
    fixture.componentInstance.changeFilter();
    pending.next(result());
    expect(fixture.componentInstance.records).toHaveLength(0);
  });
  it('retries the exact failed next page and refreshes saved status from the server', () => {
    const component = fixture.componentInstance;
    api.getMyLearning.mockReturnValueOnce(throwError(() => ({ status: 503 })));
    component.load(2);
    expect(component.failedPage).toBe(2);
    api.getMyLearning.mockReturnValueOnce(of(result([{ ...record, status: 'in_progress' }], 2)));
    component.load(component.failedPage);
    expect(store.records()).toMatchObject({ fb_a1: { status: 'in_progress' } });
    component.refreshLearning();
    expect(store.load).toHaveBeenCalledOnce();
  });
});
