import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportMomentumTrendComponent } from './weekly-report-momentum-trend.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportMomentumTrendComponent', () => {
  let component: WeeklyReportMomentumTrendComponent;
  let fixture: ComponentFixture<WeeklyReportMomentumTrendComponent>;

  const reports: WeeklyReport[] = [
    {
      _id: 'report-1',
      score: 61,
      weekStartDate: '2026-10-25T00:00:00.000Z',
      weekEndDate: '2026-10-31T23:59:59.000Z',
      meta: { evidence: { scoreAvailable: true } },
    } as unknown as WeeklyReport,
    {
      _id: 'report-2',
      score: 72,
      weekStartDate: '2026-11-01T00:00:00.000Z',
      weekEndDate: '2026-11-07T23:59:59.000Z',
      meta: { evidence: { scoreAvailable: true } },
    } as unknown as WeeklyReport,
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportMomentumTrendComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportMomentumTrendComponent);
    component = fixture.componentInstance;
    component.trendReports = reports;
    component.selectedReportId = 'report-2';
  });

  it('renders heading and trend bar buttons when reports count > 1', () => {
    fixture.detectChanges();
    const heading = fixture.nativeElement.querySelector('h2');
    expect(heading.textContent).toBe('Your momentum over time');

    const buttons = fixture.nativeElement.querySelectorAll('.trend-bars button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('emits selectReport when a trend bar button is clicked', () => {
    const selectSpy = vi.spyOn(component.selectReport, 'emit');
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.trend-bars button');
    buttons[0].click();
    expect(selectSpy).toHaveBeenCalledWith(reports[0]);
  });
});
