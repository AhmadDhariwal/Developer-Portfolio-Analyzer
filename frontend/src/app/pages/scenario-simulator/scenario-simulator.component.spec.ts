import { ChangeDetectorRef } from '@angular/core';
import { of, Subject } from 'rxjs';
import { ScenarioSimulatorComponent } from './scenario-simulator.component';
import { ScenarioSimulatorService } from '../../shared/services/scenario-simulator.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  SavedScenario,
  ScenarioContext,
  ScenarioInput,
  SimResult,
} from '../../shared/models/scenario-simulator.model';
import { SCENARIO_TEMPLATES } from '../../shared/models/scenario-template.model';

describe('Scenario immutable evaluated state', () => {
  it('does not suggest profile evidence for a different scenario target', () => {
    const component = new ScenarioSimulatorComponent(
      {} as ScenarioSimulatorService,
      {} as CareerProfileService,
      {} as ChangeDetectorRef,
    );
    component.context = {
      profile: { role: 'frontend', level: 'junior' },
      signals: {
        missingSkills: ['React'],
        portfolioCandidates: [{ name: 'React showcase', skills: ['React'] }],
        completedPortfolioProjects: ['Shipped'],
      },
    } as unknown as ScenarioContext;
    component.role = 'backend';
    expect(component.templateContext?.signals.missingSkills).toEqual([]);
    expect(component.templateContext?.signals.portfolioCandidates).toEqual([]);
    expect(component.templateContext?.signals.completedPortfolioProjects).toEqual(['Shipped']);
    component.role = 'frontend';
    component.experienceLevel = 'junior';
    expect(component.templateContext).toBe(component.context);
    component.ngOnDestroy();
  });
  it('opens each template without changing the draft and applies without persisting', () => {
    const api = {
      runWhatIfSimulation: vi.fn(),
      saveScenarioSimulation: vi.fn(),
      createSprintFromScenario: vi.fn(),
    };
    const component = new ScenarioSimulatorComponent(
      api as unknown as ScenarioSimulatorService,
      {} as CareerProfileService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.skills = ['Existing'];
    for (const template of SCENARIO_TEMPLATES) {
      component.applyTemplate(template);
      expect(component.skills).toEqual(['Existing']);
      component.activeTemplate = null;
    }
    component.applyTemplate(SCENARIO_TEMPLATES[0]);
    component.commitTemplate({
      draft: { skills: ['Docker', 'TypeScript'], projects: [], durationWeeks: 4 },
      baselineConfirmed: false,
      evaluate: false,
    });
    expect(component.skills).toEqual(['Docker', 'TypeScript']);
    expect(component.hasUnsavedDraft).toBe(true);
    expect(api.runWhatIfSimulation).not.toHaveBeenCalled();
    expect(api.saveScenarioSimulation).not.toHaveBeenCalled();
    expect(api.createSprintFromScenario).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
  it('rejects a late evaluation when its draft changed during the request', () => {
    const response = new Subject<{ result: SimResult }>();
    const component = new ScenarioSimulatorComponent(
      { runWhatIfSimulation: () => response } as unknown as ScenarioSimulatorService,
      {} as CareerProfileService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.skills = ['Docker'];
    component.baselineConfirmed = true;
    component.simulate();
    component.durationWeeks = 12;
    response.next({ result: {} as SimResult });
    expect(component.result).toBeNull();
    expect(component.isRunning).toBe(false);
    component.ngOnDestroy();
  });
  it('does not save/export an edited draft under an old displayed result', () => {
    const api = {
      sessionChanged$: new Subject<void>(),
      runWhatIfSimulation: vi.fn(),
      saveScenarioSimulation: vi.fn(),
      createSprintFromScenario: vi.fn(),
    };
    api.runWhatIfSimulation.mockImplementation((input: ScenarioInput) =>
      of({
        result: {
          ruleVersion: 'scenario-planning-v2',
          evaluation: { normalizedInput: input },
          warnings: [],
          improvements: { hiringScore: 1, jobMatch: 1 },
        } as unknown as SimResult,
      }),
    );
    const component = new ScenarioSimulatorComponent(
      api as unknown as ScenarioSimulatorService,
      {} as CareerProfileService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.baselineConfirmed = true;
    component.skills = ['React'];
    component.simulate();
    expect(component.isResultCurrent).toBe(true);
    component.skills = ['Docker'];
    component.saveScenario();
    component.createSprintDraft();
    expect(component.isResultCurrent).toBe(false);
    expect(api.saveScenarioSimulation).not.toHaveBeenCalled();
    expect(api.createSprintFromScenario).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
  it('retains a valid zero project impact and cancels evaluation on destroy', () => {
    const response = new Subject<{ result: SimResult }>();
    const api = { sessionChanged$: new Subject<void>(), runWhatIfSimulation: () => response };
    const component = new ScenarioSimulatorComponent(
      api as unknown as ScenarioSimulatorService,
      {} as CareerProfileService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.baselineConfirmed = true;
    component.projects = [{ name: 'Zero', impact: 0, complexity: 'low', weeks: 1 }];
    expect(component.validProjects[0].impact).toBe(0);
    component.simulate();
    component.ngOnDestroy();
    response.next({ result: {} as SimResult });
    expect(component.result).toBeNull();
  });

  it('manages comparison state and computes deltas and Venn skill diffs', () => {
    const component = new ScenarioSimulatorComponent(
      {} as ScenarioSimulatorService,
      {} as CareerProfileService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.baselineHiringScore = 60;
    component.baselineJobMatch = 55;
    component.durationWeeks = 6;
    component.skills = ['TypeScript', 'React'];
    component.projects = [{ name: 'React App', impact: 80, complexity: 'medium', weeks: 3 }];

    const savedScenario = {
      _id: 'sc-1',
      name: 'Fullstack Boost',
      baselineHiringScore: 60,
      baselineJobMatch: 55,
      role: 'fullstack',
      experienceLevel: 'mid',
      durationWeeks: 8,
      skills: ['TypeScript', 'GraphQL'],
      projects: [{ name: 'E-commerce API', complexity: 'medium', impact: 80, weeks: 4 }],
      predicted: { hiringScore: 75, jobMatch: 70 },
      confidenceScore: 85,
      createdAt: new Date().toISOString(),
    } as unknown as SavedScenario;

    // Initial compare toggle
    expect(component.isCompareOpen).toBe(false);
    component.compareWithScenario(savedScenario);
    expect(component.isCompareOpen).toBe(true);
    expect(component.compareScenario).toBe(savedScenario);

    // Baseline fallback when no simulationResult
    const data1 = component.comparisonData;
    expect(data1).not.toBeNull();
    expect(data1?.current.name).toBe('Current Baseline Profile');
    expect(data1?.deltas.hiring).toBe(60 - 75); // currentScore (60) - savedScore (75) = -15
    expect(data1?.deltas.jobMatch).toBe(55 - 70); // 55 - 70 = -15

    // When simulationResult is active
    component.result = {
      predicted: { hiringScore: 82, jobMatch: 78 },
      confidenceScore: 90,
      meta: { durationWeeks: 6 },
      ruleVersion: 'scenario-planning-v2',
      evaluation: { normalizedInput: {} as ScenarioInput },
      warnings: [],
      improvements: {},
    } as unknown as SimResult;

    const data2 = component.comparisonData;
    expect(data2?.current.name).toBe('Current Simulated Plan');
    expect(data2?.deltas.hiring).toBe(82 - 75); // 7
    expect(data2?.deltas.jobMatch).toBe(78 - 70); // 8
    expect(data2?.deltas.feasibility).toBe(90 - 85); // 5
    expect(data2?.deltas.duration).toBe(6 - 8); // -2

    // Skills Venn diffs
    expect(data2?.skills.shared).toContain('TypeScript');
    expect(data2?.skills.currentOnly).toContain('React');
    expect(data2?.skills.savedOnly).toContain('GraphQL');

    // Close comparison
    component.closeCompare();
    expect(component.isCompareOpen).toBe(false);
    expect(component.compareScenario).toBeNull();
    expect(component.comparisonData).toBeNull();

    // Dossier tabs default & switching
    expect(component.activeResultTab).toBe('overview');
    component.activeResultTab = 'breakdown';
    expect(component.activeResultTab).toBe('breakdown');
    component.activeResultTab = 'roadmap';
    expect(component.activeResultTab).toBe('roadmap');

    component.ngOnDestroy();
  });
});
