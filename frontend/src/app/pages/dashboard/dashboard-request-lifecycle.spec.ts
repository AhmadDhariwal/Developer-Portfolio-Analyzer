import { Observable, Subject, of } from 'rxjs';
import { Chart } from 'chart.js';
import { DashboardComponent } from './dashboard.component';

describe('Personal dashboard request lifecycle', () => {
  const create = () => {
    const summary = new Subject<any>();
    const api = {
      getDashboardSummary: vi.fn(() => summary),
      getDashboardContributions: vi.fn(() => of({ data: [] })),
      getDashboardLanguages: vi.fn(() => of({ data: {} })),
      getDashboardIntegrationAnalytics: vi.fn(() => of({ cards: [] })),
      getDashboardSkills: vi.fn(),
    };
    const cache = {
      get: vi.fn(() => null),
      set: vi.fn(),
      clearModule: vi.fn(),
      setCurrentSignalHash: vi.fn(),
    };
    const page = new DashboardComponent(
      api as never,
      { careerStack: 'Backend', experienceLevel: 'Student' } as never,
      { detectChanges: vi.fn() } as never,
      cache as never,
      { bypassSecurityTrustHtml: (value: string) => value } as never,
    );
    return { page, api, summary, cache };
  };
  const payload = {
    readinessScore: 40,
    activitySnapshot: { data: [] },
    languageSnapshot: { data: {} },
    readinessBreakdown: {
      codeQuality: 80,
      skillCoverage: null,
      industryReadiness: 70,
      projectImpact: 60,
    },
    skillsSnapshot: { topSkills: ['TypeScript'], missingSkills: [], coveragePercentage: null },
    recommendationSnapshot: { items: [] },
  };

  it('uses summary skills without a fifth request or a secondary overwrite of score dimensions', () => {
    const { page, api, summary } = create();
    page.loadDashboardData();
    summary.next(payload);
    expect(api.getDashboardSkills).not.toHaveBeenCalled();
    expect(api.getDashboardContributions).not.toHaveBeenCalled();
    expect(api.getDashboardLanguages).not.toHaveBeenCalled();
    expect(api.getDashboardIntegrationAnalytics).toHaveBeenCalledOnce();
    expect(page.aiBreakdown?.projectImpact).toBe(60);
    expect(page.topSkills).toEqual(['TypeScript']);
    expect(page.coveragePercentage).toBeNull();
    page.ngOnDestroy();
  });

  it('revalidates summary despite a local cache and cancels superseded requests before they can write cache entries', () => {
    const { page, api, summary, cache } = create();
    const next = new Subject<any>();
    cache.get.mockReturnValue({ readinessScore: 99 } as never);
    page.loadDashboardData();
    api.getDashboardSummary.mockReturnValue(next);
    page.loadDashboardData(true);
    summary.next({ ...payload, readinessScore: 99 });
    expect(cache.set).not.toHaveBeenCalled();
    next.next(payload);
    expect(page.developerScore).toBe(40);
    page.ngOnDestroy();
  });

  it('cancels work on destruction and rejects later cache and UI writes', () => {
    const { page, summary, cache } = create();
    page.loadDashboardData();
    page.ngOnDestroy();
    summary.next(payload);
    expect(cache.set).not.toHaveBeenCalled();
    expect(page.developerScore).toBe(0);
  });

  it('deduplicates simultaneous subscribers and releases in-flight entries after completion', () => {
    const { page } = create();
    const response = new Subject<object>();
    const producer = vi.fn(() => response);
    const request = () =>
      (page as any).cachedDashboardRequest('dashboardLanguages', producer) as Observable<object>;
    const first = request();
    const second = request();
    expect(first).toBe(second);
    first.subscribe();
    second.subscribe();
    expect(producer).toHaveBeenCalledOnce();
    response.complete();
    request().subscribe();
    expect(producer).toHaveBeenCalledTimes(2);
    page.ngOnDestroy();
  });

  it('reports refresh failure without silently treating previously displayed values as current', () => {
    const { page, summary } = create();
    page.loadDashboardData();
    summary.error(new Error('offline'));
    expect(page.loadError).toContain('could not be refreshed');
    expect(page.isLoading).toBe(false);
    expect(page.readinessAvailable).toBe(false);
    expect(page.statCards.every((card) => card.value === null)).toBe(true);
    page.ngOnDestroy();
  });

  it('preserves unavailable readiness dimensions and zero measurements', () => {
    const { page } = create();
    const normalize = (page as any).normalizeReadinessCenter.bind(page);
    expect(normalize([{ key: 'resume', value: null }])[0].value).toBeNull();
    expect(normalize([{ key: 'sprint', value: 0 }])[0].value).toBe(0);
    page.ngOnDestroy();
  });

  it('keeps fetched evidence usable when browser cache storage fails', () => {
    const { page, summary, cache } = create();
    cache.set.mockImplementation(() => {
      throw new Error('Storage quota');
    });
    page.loadDashboardData();
    summary.next(payload);
    expect(page.developerScore).toBe(40);
    expect(page.loadError).toBe('');
    page.ngOnDestroy();
  });

  it('clears the previous activity total when a new snapshot has no activity', () => {
    const { page, summary } = create();
    page.totalActivity = 99;
    page.loadDashboardData();
    summary.next(payload);
    expect(page.totalActivity).toBe(0);
    page.ngOnDestroy();
  });
  it('shows measured-zero fallback activity and clears visibility on missing evidence', () => {
    const { page, api } = create();
    api.getDashboardContributions.mockReturnValue(
      of({ data: [{ month: 'Nov', count: 0 }] }) as never,
    );
    page.loadActivityAndLanguage();
    expect(page.activityAvailable).toBe(true);
    expect(page.totalActivity).toBe(0);
    api.getDashboardContributions.mockReturnValue(of({ data: [] }));
    page.loadActivityAndLanguage();
    expect(page.activityAvailable).toBe(false);
    page.ngOnDestroy();
  });

  it('rejects unavailable activity counts and does not reuse a previous profile snapshot', () => {
    const { page, summary } = create();
    page.loadDashboardData();
    summary.next({
      ...payload,
      activitySnapshot: { available: true, data: [{ month: 'Nov', count: 0 }] },
    });
    expect(page.activityAvailable).toBe(true);
    summary.next({
      ...payload,
      activitySnapshot: { available: true, data: [{ month: 'Nov', count: null }] },
    });
    expect(page.activityAvailable).toBe(false);
    expect(page.totalActivity).toBe(0);
    expect(page.hasLanguageData).toBe(false);
    expect(page.aiBreakdown?.skillCoverage).toBeNull();
    page.ngOnDestroy();
  });
  it('coalesces asynchronous updates, waits for size, and cancels rendering on destruction', () => {
    const { page } = create();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({} as never);
    document.body.append(canvas);
    let width = 0;
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(
      () => ({ width, height: 150 }) as DOMRect,
    );
    vi.spyOn(canvas, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    (page as any).viewInitialized = true;
    page.languageChart = { nativeElement: canvas };
    page.hasLanguageData = true;
    (page as any).pendingLanguageData = { JavaScript: 57, TypeScript: 43 };
    const render = vi.spyOn(page, 'initLanguageChart').mockImplementation(() => {});
    const chartLookup = vi
      .spyOn(Chart, 'getChart')
      .mockReturnValue({ ctx: {}, width: 300, height: 150 } as never);
    try {
      (page as any).requestChartRender();
      page.ngAfterViewChecked();
      page.ngAfterViewChecked();
      expect(callbacks).toHaveLength(1);
      callbacks.shift()!(0);
      expect(render).not.toHaveBeenCalled();
      width = 300;
      page.ngAfterViewChecked();
      callbacks.shift()!(1);
      expect(render).toHaveBeenCalledOnce();
      (page as any).requestChartRender();
      page.ngAfterViewChecked();
      page.ngOnDestroy();
      expect(cancel).toHaveBeenCalled();
      callbacks.shift()!(2);
      expect(render).toHaveBeenCalledOnce();
    } finally {
      render.mockRestore();
      chartLookup.mockRestore();
      canvas.remove();
      vi.unstubAllGlobals();
    }
  });

  it('reports a rendering failure without retaining a misleading language legend', () => {
    const { page } = create();
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({} as never);
    document.body.append(canvas);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 150,
    } as DOMRect);
    vi.spyOn(canvas, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    (page as any).viewInitialized = true;
    page.languageChart = { nativeElement: canvas };
    page.hasLanguageData = true;
    const render = vi.spyOn(page, 'initLanguageChart').mockImplementation(() => {
      throw new Error('Context lost');
    });
    try {
      (page as any).requestChartRender();
      page.ngAfterViewChecked();
      frame(0);
      expect(page.chartErrors.language).toContain('could not be drawn');
      expect(page.languageLegend).toEqual([]);
    } finally {
      page.ngOnDestroy();
      render.mockRestore();
      canvas.remove();
      vi.unstubAllGlobals();
    }
  });

  it('distinguishes an unavailable radar from measured zero dimensions', () => {
    const { page } = create();
    expect(page.hasRadarData).toBe(false);
    page.aiBreakdown = {
      codeQuality: 0,
      skillCoverage: null,
      industryReadiness: null,
      projectImpact: null,
    };
    expect(page.hasRadarData).toBe(true);
    page.ngOnDestroy();
  });
});
