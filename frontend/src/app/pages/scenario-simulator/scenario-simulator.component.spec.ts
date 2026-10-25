import { ChangeDetectorRef } from '@angular/core';
import { of, Subject } from 'rxjs';
import { ScenarioSimulatorComponent } from './scenario-simulator.component';
import { ScenarioSimulatorService } from '../../shared/services/scenario-simulator.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
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
});
