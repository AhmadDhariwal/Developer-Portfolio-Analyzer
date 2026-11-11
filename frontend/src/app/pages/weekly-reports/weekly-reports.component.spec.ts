import { ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { WeeklyReportsComponent } from './weekly-reports.component';
import { WeeklyReportService } from '../../shared/services/weekly-report.service';

describe('Weekly report workspace lifecycle', () => {
  it('distinguishes missing scores from saved zero and suppresses unverifiable deltas', () => {
    const component = new WeeklyReportsComponent(
      {} as WeeklyReportService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.latestReport = {
      score: 18,
      meta: {
        evidence: {
          scoreAvailable: false,
          inputs: {
            github: { available: true, value: 0 },
            resume: { available: false, value: null },
          },
        },
        comparison: { available: false },
      },
    } as any;
    expect(component.overallLabel(component.latestReport!)).toBe('Not assessed');
    expect(component.metricLabel('github', 0)).toBe('0%');
    expect(component.metricLabel('resume', 0)).toBe('Not assessed');
    expect(component.formatDelta(18)).toBe('No comparable week');
    component.ngOnDestroy();
  });

  it('resends the selected saved snapshot without generation or refresh', () => {
    const response = new Subject<any>();
    const api = {
      resendEmail: vi.fn(() => response),
      generateReport: vi.fn(),
      refreshReport: vi.fn(),
    };
    const component = new WeeklyReportsComponent(
      api as unknown as WeeklyReportService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    const saved = { _id: 'saved', meta: { reportHash: 'a'.repeat(64) } } as any;
    component.latestReport = saved;
    component.resendEmail();
    response.next({ sent: true });
    response.complete();
    expect(api.resendEmail).toHaveBeenCalledWith(saved);
    expect(api.generateReport).not.toHaveBeenCalled();
    expect(api.refreshReport).not.toHaveBeenCalled();
    expect(component.actionMessage).toContain('Inbox delivery is not guaranteed');
    expect(component.isResending).toBe(false);
    component.ngOnDestroy();
  });

  it('distinguishes unavailable Sprint and Interview sources from measured zero activity', () => {
    const component = new WeeklyReportsComponent(
      {} as WeeklyReportService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    const missing = {
      meta: {
        evidence: {
          inputs: {
            sprint: { available: false, value: null, reason: 'Missing evidence' },
            interview: { available: false, value: null, reason: 'Missing evidence' },
          },
        },
        sprint: { tasksTotal: 0, completionRate: 0 },
        interview: { questionsGenerated: 0 },
      },
    } as any;
    const zeroActivity = {
      meta: {
        evidence: {
          inputs: {
            sprint: { available: false, value: null, reason: 'No tasks to assess' },
            interview: { available: true, value: 0, reason: 'Measured zero' },
          },
        },
        sprint: { tasksTotal: 0, completionRate: 0 },
        interview: { questionsGenerated: 0 },
      },
    } as any;

    expect(component.sprintMetricLabel(missing)).toBe('Unavailable');
    expect(component.interviewActivityLabel(missing)).toBe('Unavailable');
    expect(component.sprintMetricLabel(zeroActivity)).toBe('No tasks to assess');
    expect(component.interviewActivityLabel(zeroActivity)).toBe('0');
    component.ngOnDestroy();
  });

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
