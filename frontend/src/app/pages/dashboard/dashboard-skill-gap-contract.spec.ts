import { DashboardComponent } from './dashboard.component';

describe('Dashboard Skill Gap nullable coverage contract', () => {
  const create = () =>
    new DashboardComponent(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { bypassSecurityTrustHtml: (value: string) => value } as never,
    );

  it('preserves explicit null after a measured score and does not borrow the previous score', () => {
    const page = create();
    const apply = (data: unknown) => (page as any).applySkillsSnapshot(data);
    apply({ coveragePercentage: 50 });
    apply({ coveragePercentage: null });
    expect(page.coveragePercentage).toBeNull();
    apply({ topSkills: [] });
    expect(page.coveragePercentage).toBeNull();
    apply({ coveragePercentage: 0 });
    expect(page.coveragePercentage).toBe(0);
  });

  it('keeps unavailable skill coverage out of radar and explainability numbers', () => {
    const page = create();
    page.aiBreakdown = {
      codeQuality: 80,
      skillCoverage: null,
      industryReadiness: 70,
      projectImpact: 60,
    };
    expect(page.scoreBreakdownRows.find((row) => row.label === 'Skill Coverage')?.value).toBeNull();
    expect(page.explainabilityRows.find((row) => row.label === 'Skill Coverage')?.value).toBeNull();
    expect((page as any).buildScoreReasons()).toContain(
      'Skill coverage is unavailable; missing evidence does not establish zero coverage.',
    );
    expect(page.aiBreakdown.codeQuality).toBe(80);
  });

  it('preserves unavailable market readiness and measured zero without changing other cards', () => {
    const page = create();
    const normalize = (value: unknown) => (page as any).normalizeReadinessCenter(value);
    expect(normalize([{ key: 'market', value: null }])[0].value).toBeNull();
    expect(normalize([{ key: 'market', value: 0 }])[0].value).toBe(0);
    expect(normalize([{ key: 'resume', value: 75 }])[0].value).toBe(75);
    expect((page as any).normalizeCoverage('not a number')).toBeNull();
  });
});
