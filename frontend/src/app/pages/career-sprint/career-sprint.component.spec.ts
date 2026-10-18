import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { CareerSprintComponent } from './career-sprint.component';
import { CareerSprint, CareerSprintService } from '../../shared/services/career-sprint.service';
import { ProfileService } from '../../shared/services/profile.service';
import { legacyFixture, sprintFixture } from './testing/sprint.fixture';

describe('Career Sprint dashboard', () => {
  const api = {
    getCurrent: vi.fn(),
    getHistory: vi.fn(),
    getPreferences: vi.fn(),
    addTask: vi.fn(),
    editTask: vi.fn(),
    deleteTask: vi.fn(),
    toggleTask: vi.fn(),
    updateSprintDates: vi.fn(),
    restoreStreak: vi.fn(),
    create: vi.fn(),
    clearCache: vi.fn(),
    getScenarios: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    api.getCurrent.mockReturnValue(of(sprintFixture()));
    api.getHistory.mockReturnValue(of({ history: [sprintFixture()] }));
    api.getPreferences.mockReturnValue(of({ timeZone: 'Asia/Karachi' }));
    api.getScenarios.mockReturnValue(of({ history: [] }));
    TestBed.configureTestingModule({
      imports: [CareerSprintComponent],
      providers: [
        provideRouter([]),
        { provide: CareerSprintService, useValue: api },
        {
          provide: ProfileService,
          useValue: {
            getProfile: () =>
              of({
                _id: 'owner',
                name: 'Alex',
                careerStack: 'Frontend',
                experienceLevel: 'Intern',
              }),
          },
        },
      ],
    });
  });
  function mount() {
    const fixture = TestBed.createComponent(CareerSprintComponent);
    fixture.detectChanges();
    return fixture;
  }
  it('renders backend-authoritative progress, level and XP without recomputing them from tasks', () => {
    const fixture = mount(),
      text = fixture.nativeElement.textContent;
    expect(text).toContain('23%');
    expect(text).toContain('137');
    expect(text).toContain('Level 2');
    expect(fixture.componentInstance.sprint?.tasks).toHaveLength(1);
    expect(api.getHistory).toHaveBeenCalledWith(12, expect.any(String), true);
  });
  it('renders unavailable legacy analytics and blocks every legacy mutation while retaining history', () => {
    api.getCurrent.mockReturnValue(of(legacyFixture()));
    api.getHistory.mockReturnValue(
      of({ history: [legacyFixture(), { ...legacyFixture(), _id: 'overlapping-record' }] }),
    );
    const fixture = mount(),
      component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('Unavailable');
    expect(fixture.nativeElement.textContent).toContain('History preserved');
    expect(fixture.nativeElement.textContent).toContain('2026-10-11 19:00:00.000 UTC');
    component.toggleTask(component.sprint!.tasks[0]);
    component.saveDates();
    component.restoreStreak();
    component.openEditor();
    expect(api.toggleTask).not.toHaveBeenCalled();
    expect(api.updateSprintDates).not.toHaveBeenCalled();
    expect(api.restoreStreak).not.toHaveBeenCalled();
    expect(component.showEditor).toBe(false);
    fixture.nativeElement.querySelector('.workspace-nav button:last-child').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.history-entry')).toHaveLength(2);
    expect(component.sprint?.xpPoints).toBe(137);
  });
  it('retains previous data on failed refresh and disables stale mutations until successful retry', () => {
    const fixture = mount(),
      component = fixture.componentInstance,
      original = component.sprint;
    api.getCurrent.mockReturnValueOnce(throwError(() => ({ status: 503 })));
    component.loadData(true);
    expect(component.sprint).toBe(original);
    expect(component.stale).toBe(true);
    component.toggleTask(component.sprint!.tasks[0]);
    expect(api.toggleTask).not.toHaveBeenCalled();
    component.loadData(true);
    expect(component.stale).toBe(false);
  });
  it('guards duplicate mutations, keeps task state until server success, and explains conflicts', () => {
    const fixture = mount(),
      component = fixture.componentInstance,
      pending = new Subject<CareerSprint>();
    api.toggleTask.mockReturnValue(pending);
    component.toggleTask(component.sprint!.tasks[0]);
    component.toggleTask(component.sprint!.tasks[0]);
    expect(api.toggleTask).toHaveBeenCalledTimes(1);
    expect(component.sprint!.tasks[0].isCompleted).toBe(false);
    pending.error({ status: 409, error: { message: 'Sprint changed.' } });
    expect(component.actionMessage).toMatch(/Sprint changed.*preserved.*Refresh/);
    expect(component.sprint!.tasks[0].isCompleted).toBe(false);
  });
  it('keeps completed task edits/deletes locked and supports reopen using the completion endpoint', () => {
    const fixture = mount(),
      component = fixture.componentInstance;
    const task = { ...component.sprint!.tasks[0], isCompleted: true };
    component.openEditor(task);
    component.deleteTaskId = task._id!;
    component.deleteTask(task);
    expect(component.showEditor).toBe(false);
    expect(api.deleteTask).not.toHaveBeenCalled();
    api.toggleTask.mockReturnValue(of(sprintFixture()));
    component.toggleTask(task);
    expect(api.toggleTask).toHaveBeenCalledWith('sprint-one', 'task-one', false);
  });
  it('uses the pinned timezone for Today and preserves unscheduled tasks through filters', () => {
    const fixture = mount(),
      component = fixture.componentInstance;
    component.now = +new Date('2026-10-15T20:00:00Z');
    component.dateFilter = 'today';
    expect(component.visibleTasks).toHaveLength(1);
    component.statusFilter = 'completed';
    expect(component.visibleTasks).toHaveLength(0);
    component.resetFilters();
    expect(component.visibleTasks).toHaveLength(1);
    expect(component.metric(null, '%')).toBe('Unavailable');
    expect(component.metric(0, '%')).toBe('0%');
  });
  it('labels backend midnight instants by the Sprint calendar rather than their UTC date', () => {
    const fixture = mount(),
      component = fixture.componentInstance;
    component.sprint!.analytics!.dailyActivity = [
      { date: '2026-10-15T19:00:00Z', count: 2, active: true },
    ];
    expect(component.activity[0].date).toBe('2026-10-16');
    expect(component.activity[0].label).toBe('Fri');
  });
  it('suggests non-overlapping dates and blocks known overlaps without disabling current planning', () => {
    const fixture = mount(),
      component = fixture.componentInstance;
    component.now = +new Date('2026-10-16T12:00:00Z');
    component.openNewSprint();
    expect(component.newStart).toBe('2026-10-19');
    expect(component.newEnd).toBe('2026-10-25');
    component.newStart = '2026-10-16';
    component.newEnd = '2026-10-22';
    component.createSprint();
    expect(api.create).not.toHaveBeenCalled();
    expect(component.actionMessage).toMatch(/overlap.*current Sprint/);
    expect(component.mutationsDisabled).toBe(false);
    component.useAvailableDates();
    expect(component.newSprintConflict).toBeUndefined();
  });
  it('keeps planning usable after rejected overlapping date edits and explains genuine planning locks', () => {
    const fixture = mount(),
      component = fixture.componentInstance;
    component.sprintEndDate = '2026-10-20';
    api.updateSprintDates.mockReturnValue(
      throwError(() => ({
        status: 409,
        error: { message: 'Sprint dates overlap an existing sprint.' },
      })),
    );
    component.saveDates();
    expect(api.updateSprintDates).toHaveBeenCalledTimes(1);
    expect(component.stale).toBe(false);
    expect(component.mutationsDisabled).toBe(false);
    expect(component.actionMessage).toMatch(/Choose dates/);
    component.stale = true;
    expect(component.planningDisabledReason).toMatch(/Refresh Sprint/);
    component.sprint = legacyFixture();
    expect(component.planningDisabledReason).toMatch(/historical Sprint is read-only/);
    expect(component.mutationsDisabled).toBe(true);
  });
  it('opens a newly created writable Sprint for planning while keeping the legacy dashboard unchanged', () => {
    const legacy = legacyFixture();
    const before = structuredClone(legacy);
    const future = sprintFixture({
      _id: 'future-sprint',
      title: 'My AI Sprint',
      weekStartDate: '2026-12-01T00:00:00Z',
      weekEndDate: '2026-12-07T23:59:59.999Z',
    });
    api.getCurrent.mockReturnValue(of(legacy));
    api.getHistory.mockReturnValue(of({ history: [future, legacy] }));
    api.create.mockReturnValue(of(future));
    const fixture = mount(),
      component = fixture.componentInstance;
    component.newStart = '2027-01-01';
    component.newEnd = '2027-01-07';
    component.createSprint();
    fixture.detectChanges();
    expect(component.sprint).toBe(legacy);
    expect(component.plannerSprint?._id).toBe('future-sprint');
    expect(component.mutationsDisabled).toBe(true);
    expect(component.planningDisabled).toBe(false);
    expect(fixture.nativeElement.querySelector('app-sprint-planner input').disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Planning for “My AI Sprint”');
    expect(legacy).toEqual(before);
    component.plannerUpdated({ ...future, aiPlans: [] });
    expect(component.sprint).toBe(legacy);
    expect(legacy).toEqual(before);
  });
  it('can select a writable history Sprint but fails closed when its refresh is unavailable', () => {
    const legacy = legacyFixture(),
      future = sprintFixture({ _id: 'future-sprint' });
    api.getCurrent.mockReturnValue(of(legacy));
    api.getHistory.mockReturnValue(of({ history: [future, legacy] }));
    const fixture = mount(),
      component = fixture.componentInstance;
    component.selectPlanningSprint('future-sprint');
    expect(component.planningDisabled).toBe(false);
    expect(component.sprint).toBe(legacy);
    api.getHistory.mockReturnValueOnce(throwError(() => ({ status: 503 })));
    component.loadData(true);
    expect(component.planningDisabled).toBe(true);
    expect(component.planningDisabledReason).toMatch(/selected Sprint could not be refreshed/);
    expect(component.plannerSprint?._id).toBe('future-sprint');
  });
});
