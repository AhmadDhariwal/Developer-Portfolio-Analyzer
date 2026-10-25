import { ChangeDetectorRef } from '@angular/core';
import { of, Subject } from 'rxjs';
import { ScenarioSimulatorComponent } from './scenario-simulator.component';
import { ScenarioSimulatorService } from '../../shared/services/scenario-simulator.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { ScenarioInput, SimResult } from '../../shared/models/scenario-simulator.model';

describe('Scenario immutable evaluated state', () => {
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
