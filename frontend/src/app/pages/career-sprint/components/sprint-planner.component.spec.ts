import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { SprintPlannerComponent } from './sprint-planner.component';
import {
  CareerSprintService,
  GenerateAiTasksResponse,
} from '../../../shared/services/career-sprint.service';
import { sprintFixture } from '../testing/sprint.fixture';

describe('Sprint planning and draft ingestion', () => {
  const api = {
    getScenarios: vi.fn(),
    generateAiTasks: vi.fn(),
    generateTrueAiPlan: vi.fn(),
    importDraft: vi.fn(),
    saveAiPlan: vi.fn(),
    deleteDraft: vi.fn(),
    importScenarioPlan: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    api.getScenarios.mockReturnValue(of({ history: [] }));
    TestBed.configureTestingModule({
      imports: [SprintPlannerComponent],
      providers: [provideRouter([]), { provide: CareerSprintService, useValue: api }],
    });
  });
  function mount() {
    const fixture = TestBed.createComponent(SprintPlannerComponent);
    fixture.componentRef.setInput('sprint', sprintFixture());
    fixture.detectChanges();
    return fixture;
  }
  it('requires an exact fresh context acknowledgement and imports selected indexes in one request', () => {
    const fixture = mount(),
      planner = fixture.componentInstance;
    const sprint = sprintFixture();
    sprint.aiPlans![0].compatibility = {
      status: 'different-context',
      requiresAcknowledgement: true,
      currentFingerprint: 'new-context',
      recordedFingerprint: 'old-context',
    };
    fixture.componentRef.setInput('sprint', sprint);
    fixture.detectChanges();
    planner.selectDraft('draft-one');
    planner.selectAll();
    planner.importSelected();
    expect(api.importDraft).not.toHaveBeenCalled();
    planner.acknowledge(true);
    api.importDraft.mockReturnValue(of(sprint));
    planner.importSelected();
    expect(api.importDraft).toHaveBeenCalledWith('sprint-one', 'draft-one', [0], 'new-context');
    const changed = structuredClone(sprint);
    changed.aiPlans![0].compatibility!.currentFingerprint = 'newer-context';
    fixture.componentRef.setInput('sprint', changed);
    fixture.detectChanges();
    expect(planner.acknowledged).toBe(false);
  });
  it('retains a usable previous preview after failed generation and labels deterministic AI fallback', () => {
    const fixture = mount(),
      planner = fixture.componentInstance;
    const preview: GenerateAiTasksResponse = {
      tasks: sprintFixture().aiPlans![0].tasks,
      planMeta: {
        summary: 'Preview',
        confidenceScore: 50,
        consistencyScore: 30,
        signalsUsed: [],
        generationMode: 'deterministic',
      },
    };
    api.generateAiTasks.mockReturnValue(of(preview));
    planner.generate();
    api.generateTrueAiPlan.mockReturnValue(throwError(() => ({ status: 503 })));
    planner.generate(true);
    expect(planner.preview).toBe(preview);
    api.generateTrueAiPlan.mockReturnValue(of(preview));
    planner.generate(true);
    expect(planner.message).toMatch(/deterministic fallback/);
  });
  it('saves original task provenance and dates as a draft rather than sequential manual task copies', () => {
    const fixture = mount(),
      planner = fixture.componentInstance;
    const task = {
      ...sprintFixture().aiPlans![0].tasks[0],
      sourceRecommendationId: 'source-id',
      sourceRule: 'recorded-rule',
      startDate: '2026-10-15T19:00:00Z',
    };
    planner.preview = {
      tasks: [task],
      planMeta: {
        summary: 'Preview',
        confidenceScore: 50,
        consistencyScore: 30,
        signalsUsed: [],
        generationMode: 'deterministic',
      },
    };
    planner.draftName = 'Preserved plan';
    api.saveAiPlan.mockReturnValue(of(sprintFixture()));
    planner.save();
    expect(api.saveAiPlan).toHaveBeenCalledWith(
      'sprint-one',
      expect.objectContaining({ tasks: [task], generatorType: 'deterministic' }),
    );
  });
  it('guards busy/read-only imports and retains selection on 409 for review', () => {
    const fixture = mount(),
      planner = fixture.componentInstance;
    planner.selectDraft('draft-one');
    planner.selectAll();
    const pending = new Subject();
    api.importDraft.mockReturnValue(pending);
    planner.importSelected();
    planner.importSelected();
    expect(api.importDraft).toHaveBeenCalledTimes(1);
    pending.error({ status: 409, error: { message: 'Context changed.' } });
    expect(planner.selected.size).toBe(1);
    expect(planner.message).toMatch(/preserved.*Refresh/);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    planner.importSelected();
    expect(api.importDraft).toHaveBeenCalledTimes(1);
  });
});
