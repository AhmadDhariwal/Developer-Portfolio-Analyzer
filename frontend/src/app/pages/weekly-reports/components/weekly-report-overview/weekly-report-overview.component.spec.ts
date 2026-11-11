import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportOverviewComponent } from './weekly-report-overview.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportOverviewComponent', () => {
  let component: WeeklyReportOverviewComponent;
  let fixture: ComponentFixture<WeeklyReportOverviewComponent>;

  const mockReport: WeeklyReport = {
    _id: 'report-1',
    score: 82,
    weekStartDate: '2026-11-01T00:00:00.000Z',
    weekEndDate: '2026-11-07T23:59:59.000Z',
    progressSummary: 'Strong velocity across all channels.',
    emailStatus: 'sent',
    predictedHiringReadiness: {
      score: 85,
      reason: 'Strong performance on repositories and sprints.',
    },
    meta: {
      version: 1,
      reportHash: 'hash1',
      narrativeSource: 'ai-enhanced',
      evidence: {
        scoreAvailable: true,
        inputs: {},
      },
    },
  } as unknown as WeeklyReport;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportOverviewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportOverviewComponent);
    component = fixture.componentInstance;
    component.report = mockReport;
  });

  it('renders overall score and career momentum meter properly', () => {
    fixture.detectChanges();
    const meter = fixture.nativeElement.querySelector('[role="meter"]');
    expect(meter).toBeTruthy();
    expect(meter.getAttribute('aria-valuenow')).toBe('82');
    expect(meter.getAttribute('aria-valuetext')).toBe('82');
    expect(meter.textContent).toContain('82/100');
  });

  it('renders readiness indicator score and tone', () => {
    fixture.detectChanges();
    const readiness = fixture.nativeElement.querySelector('.readiness-score');
    expect(readiness.textContent).toContain('85%');
    expect(readiness.textContent).toContain('Strong');
  });

  it('displays "Not assessed" when evidence scoreAvailable is false', () => {
    component.report = {
      ...mockReport,
      meta: {
        ...mockReport.meta,
        evidence: {
          scoreAvailable: false,
          inputs: {},
        },
      },
    } as unknown as WeeklyReport;
    fixture.detectChanges();

    const meter = fixture.nativeElement.querySelector('[role="meter"]');
    expect(meter.getAttribute('aria-valuenow')).toBeNull();
    expect(meter.textContent).toContain('Not assessed');
  });
});
