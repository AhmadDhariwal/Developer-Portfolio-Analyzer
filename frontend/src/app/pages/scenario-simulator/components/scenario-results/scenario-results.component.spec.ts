import { ScenarioResultsComponent } from './scenario-results.component';

describe('Scenario results component', () => {
  it('emits tab selection without changing the parent-owned evaluation result', () => {
    const results = new ScenarioResultsComponent();
    results.activeResultTab = 'overview';
    const selected = vi.fn();
    results.activeResultTabChange.subscribe(selected);
    results.selectTab('breakdown');
    expect(selected).toHaveBeenCalledWith('breakdown');
    expect(results.activeResultTab).toBe('overview');
  });
});
