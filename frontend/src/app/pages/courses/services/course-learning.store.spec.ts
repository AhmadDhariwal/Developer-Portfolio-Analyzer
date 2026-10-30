import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { CourseLearningStore } from './course-learning.store';
import { CourseService } from '../../../shared/services/course.service';
import { UserCourseProgress } from '../../../shared/models/course.model';

const record: UserCourseProgress = {
  courseId: 'fb_a1',
  course: {
    id: 'fb_a1',
    title: 'Angular',
    platform: 'Udemy',
    url: 'https://www.udemy.com/course/angular/',
    topics: ['Angular'],
  },
  status: 'saved',
  notes: '',
  progressPercent: null,
  progressSource: 'user-entered',
  completionSource: 'self-reported',
  completedAt: null,
  createdAt: '',
  updatedAt: '',
};

describe('Learning Hub server-confirmed progress', () => {
  let store: CourseLearningStore;
  const api = {
    getMyLearning: vi.fn(),
    saveProgress: vi.fn(),
    removeProgress: vi.fn(),
    addToSprint: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [CourseLearningStore, { provide: CourseService, useValue: api }],
    });
    store = TestBed.inject(CourseLearningStore);
    api.getMyLearning.mockReturnValue(of({ courses: [record], page: 1, totalPages: 1, total: 1 }));
  });
  it('reads all owned pages before enabling discovery actions', () => {
    const second = new Subject();
    api.getMyLearning
      .mockReturnValueOnce(of({ courses: [], page: 1, totalPages: 2 }))
      .mockReturnValueOnce(second);
    store.load();
    expect(store.ready()).toBe(false);
    second.next({ courses: [record], page: 2, totalPages: 2 });
    second.complete();
    expect(store.ready()).toBe(true);
    expect(store.records()[record.courseId]).toEqual(record);
    expect(api.getMyLearning).toHaveBeenLastCalledWith(undefined, 2);
  });
  it('keeps prior status during pending and failed mutations and guards duplicate submits', () => {
    store.load();
    const pending = new Subject<UserCourseProgress>();
    api.saveProgress.mockReturnValue(pending);
    store.save(record.courseId, { status: 'completed' });
    store.save(record.courseId, { status: 'completed' });
    expect(api.saveProgress).toHaveBeenCalledTimes(1);
    expect(store.records()[record.courseId].status).toBe('saved');
    pending.error({ status: 503, error: { message: 'Retry later' } });
    expect(store.records()[record.courseId].status).toBe('saved');
    expect(store.actions()[record.courseId].pending).toBeFalsy();
    expect(store.actions()[record.courseId]).toMatchObject({ error: true, message: 'Retry later' });
  });
  it('accepts only the saved response as progress including an explicit zero', () => {
    store.load();
    api.saveProgress.mockReturnValue(
      of({ ...record, progressPercent: 0, notes: 'Practice joins' }),
    );
    store.save(record.courseId, { status: 'saved', notes: 'Practice joins', progressPercent: 0 });
    expect(store.records()[record.courseId].progressPercent).toBe(0);
    expect(store.revision()).toBe(1);
  });
  it('does not remove failed records and allows an actual successful delete', () => {
    store.load();
    api.removeProgress
      .mockReturnValueOnce(throwError(() => ({ status: 401 })))
      .mockReturnValueOnce(of(undefined));
    store.remove(record.courseId);
    expect(store.records()[record.courseId]).toEqual(record);
    expect(store.announcement()).toContain('Sign in');
    store.remove(record.courseId);
    expect(store.records()[record.courseId]).toBeUndefined();
  });
  it('requires a saved noncompleted record and distinguishes Sprint duplicate and conflict', () => {
    store.load();
    store.addToSprint('unknown');
    expect(api.addToSprint).not.toHaveBeenCalled();
    api.addToSprint
      .mockReturnValueOnce(
        throwError(() => ({ status: 409, error: { message: 'Target conflict' } })),
      )
      .mockReturnValueOnce(of({ alreadyAdded: true }));
    store.addToSprint(record.courseId);
    expect(store.actions()[record.courseId].message).toBe('Target conflict');
    store.addToSprint(record.courseId);
    expect(store.actions()[record.courseId]).toMatchObject({
      sprintAdded: true,
      message: 'Already in your Career Sprint.',
    });
    store.records.set({ [record.courseId]: { ...record, status: 'completed' } });
    store.addToSprint(record.courseId);
    expect(api.addToSprint).toHaveBeenCalledTimes(2);
  });
  it('keeps actions disabled when the saved-course inventory cannot be verified', () => {
    api.getMyLearning.mockReturnValue(throwError(() => ({ status: 503 })));
    store.load();
    store.save('fb_a1', { status: 'saved' });
    expect(store.error()).toContain('temporarily unavailable');
    expect(api.saveProgress).not.toHaveBeenCalled();
  });
});
