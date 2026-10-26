import { ScenarioHistoryComponent } from './scenario-history.component';
import { SavedScenario } from '../../../../shared/models/scenario-simulator.model';

describe('Scenario history component', () => {
  it('owns comparison presentation and emits benchmark intent without mutating shared selection', () => {
    const history = new ScenarioHistoryComponent();
    history.result = null;
    history.baselineHiringScore = 50;
    history.baselineJobMatch = 45;
    history.baselineConfirmed = true;
    history.durationWeeks = 6;
    history.scenarioName = '';
    history.skills = ['TypeScript'];
    history.projects = [];
    history.role = 'frontend';
    history.experienceLevel = 'mid';
    history.compareScenario = {
      _id: 'saved',
      name: 'Saved',
      predicted: { hiringScore: 60, jobMatch: 55 },
      durationWeeks: 8,
      confidenceScore: 75,
      skills: ['TypeScript', 'Testing'],
      projects: [],
      result: null,
    } as unknown as SavedScenario;
    expect(history.comparisonData?.deltas.hiring).toBe(-10);
    expect(history.comparisonData?.skills.shared).toEqual(['TypeScript']);
    expect(history.comparisonData?.skills.savedOnly).toEqual(['Testing']);
    const selected = vi.fn();
    history.benchmarkSelected.subscribe(selected);
    history.onBenchmarkChange({ target: { value: 'different' } } as unknown as Event);
    expect(selected).toHaveBeenCalledWith('different');
    expect(history.compareScenario._id).toBe('saved');
  });
});
