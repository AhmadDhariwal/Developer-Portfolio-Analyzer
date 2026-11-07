import { ScenarioInputsComponent } from './scenario-inputs.component';
import { ProjectInput } from '../../../../shared/models/scenario-simulator.model';

describe('Scenario inputs component', () => {
  it('edits project fields immutably and preserves a real zero impact', () => {
    const inputs = new ScenarioInputsComponent();
    const original = [{ name: 'Original', complexity: 'low' as const, weeks: 2, impact: 80 }];
    inputs.projects = original;
    let emitted: ProjectInput[] = original;
    inputs.projectsChange.subscribe((value) => (emitted = value));
    inputs.updateProject(0, { impact: 0 });
    expect(original[0].impact).toBe(80);
    expect(emitted[0].impact).toBe(0);
    expect(emitted).not.toBe(original);
    expect(emitted[0]).not.toBe(original[0]);
  });
});
