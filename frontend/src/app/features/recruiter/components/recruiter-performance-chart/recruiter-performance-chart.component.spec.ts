import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '../../../../shared/services/theme.service';
import { RecruiterPerformanceChartComponent } from './recruiter-performance-chart.component';

describe('RecruiterPerformanceChartComponent', () => {
  let component: RecruiterPerformanceChartComponent;
  let fixture: ComponentFixture<RecruiterPerformanceChartComponent>;
  let themeService: ThemeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecruiterPerformanceChartComponent],
    }).compileComponents();

    themeService = TestBed.inject(ThemeService);
    fixture = TestBed.createComponent(RecruiterPerformanceChartComponent);
    component = fixture.componentInstance;
  });

  it('renders empty state cleanly when no items or datasets are provided', () => {
    component.title = 'Pipeline Funnel';
    component.emptyMessage = 'No data available yet.';
    component.items = [];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Pipeline Funnel');
    expect(text).toContain('No data available yet.');
    expect(component.hasRenderableData).toBe(false);
  });

  it('maps single-series items and re-reacts safely to theme toggles in jsdom without canvas context', () => {
    component.title = 'Activity Trend';
    component.mode = 'area';
    component.items = [
      { label: 'Mon', count: 4 },
      { label: 'Tue', count: 7 },
    ];
    fixture.detectChanges();

    expect(component.hasRenderableData).toBe(true);
    expect(component.isCanvasMode).toBe(true);

    themeService.setTheme('dark');
    fixture.detectChanges();
    expect(themeService.activeTheme()).toBe('dark');

    themeService.setTheme('light');
    fixture.detectChanges();
    expect(themeService.activeTheme()).toBe('light');
  });

  it('computes multi-series datasets and dual/heatmap non-canvas views accurately', () => {
    fixture.componentRef.setInput('mode', 'column');
    fixture.componentRef.setInput('labels', ['Readiness', 'GitHub']);
    fixture.componentRef.setInput('datasets', [
      { label: 'Alice', values: [88, null] },
      { label: 'Bob', values: [91, 82] },
    ]);
    fixture.detectChanges();
    expect(component.hasMultiSeries).toBe(true);
    expect(component.hasRenderableData).toBe(true);

    const heatmapFixture = TestBed.createComponent(RecruiterPerformanceChartComponent);
    const heatmap = heatmapFixture.componentInstance;
    heatmap.mode = 'heatmap';
    heatmap.items = [
      { label: 'Mon', count: 2 },
      { label: 'Tue', count: 8 },
    ];
    heatmapFixture.detectChanges();
    expect(heatmap.isCanvasMode).toBe(false);
    expect(heatmap.heatCellsFor({ label: 'Tue', count: 8 }).length).toBe(6);
    expect(heatmap.heatCellsFor({ label: 'Mon', count: 2 }).every((op) => op <= 0.45)).toBe(true);
  });

  it('applies a default minimum axis/funnel scale of 10 for count charts and 100 for percentage charts', () => {
    component.mode = 'funnel';
    component.items = [
      { label: 'Shortlisted', count: 1 },
      { label: 'Interview', count: 3 },
    ];
    expect(component.effectiveAxisMinMax).toBe(10);
    expect(component.funnelBaseline).toBe(10);
    expect(component.funnelPercent({ label: 'Shortlisted', count: 1 })).toBe(10);
    expect(component.funnelPercent({ label: 'Interview', count: 3 })).toBe(30);

    component.items = [{ label: 'Shortlisted', count: 25 }];
    expect(component.funnelBaseline).toBe(25);
    expect(component.funnelPercent({ label: 'Shortlisted', count: 25 })).toBe(100);

    component.valueSuffix = '%';
    expect(component.effectiveAxisMinMax).toBe(100);
  });
});
