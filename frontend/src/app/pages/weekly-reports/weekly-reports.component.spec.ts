import { ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { WeeklyReportsComponent } from './weekly-reports.component';
import { WeeklyReportService } from '../../shared/services/weekly-report.service';

describe('Weekly report workspace lifecycle', () => {
  it('cancels a pending dashboard read on teardown and releases its loading state', () => {
    const response = new Subject<any>();
    const component = new WeeklyReportsComponent(
      { getDashboard: () => response } as unknown as WeeklyReportService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.loadReports();
    expect(response.observed).toBe(true);
    component.ngOnDestroy();
    expect(response.observed).toBe(false);
    expect(component.isLoading).toBe(false);
    response.next({ latest: { _id: 'obsolete' }, history: [] });
    expect(component.latestReport).toBeNull();
  });

  it('retains the saved report when regeneration fails', () => {
    const response = new Subject<any>();
    const component = new WeeklyReportsComponent(
      { generateReport: () => response } as unknown as WeeklyReportService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    const saved = { _id: 'saved' } as any;
    component.latestReport = saved;
    component.generateReport();
    response.error(new Error('offline'));
    expect(component.latestReport).toBe(saved);
    expect(component.isGenerating).toBe(false);
    expect(component.errorMessage).toContain('Unable to generate');
    component.ngOnDestroy();
  });
});
