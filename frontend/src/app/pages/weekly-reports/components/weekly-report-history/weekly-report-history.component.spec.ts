import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportHistoryComponent } from './weekly-report-history.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportHistoryComponent', () => {
  let component: WeeklyReportHistoryComponent;
  let fixture: ComponentFixture<WeeklyReportHistoryComponent>;

  const reports: WeeklyReport[] = [
    {
      _id: 'report-1',
      score: 72,
      weekStartDate: '2026-11-01T00:00:00.000Z',
      weekEndDate: '2026-11-07T23:59:59.000Z',
      meta: { evidence: { scoreAvailable: true } },
    } as unknown as WeeklyReport,
    {
      _id: 'report-2',
      score: 61,
      weekStartDate: '2026-10-25T00:00:00.000Z',
      weekEndDate: '2026-10-31T23:59:59.000Z',
      meta: { evidence: { scoreAvailable: true } },
    } as unknown as WeeklyReport,
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportHistoryComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportHistoryComponent);
    component = fixture.componentInstance;
    component.history = reports;
    component.selectedReportId = 'report-1';
  });

  it('renders history toggle button and list rows', () => {
    component.isOpen = true;
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.history-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Last 2 reports');

    const rows = fixture.nativeElement.querySelectorAll('.history-row');
    expect(rows.length).toBe(2);
    expect(rows[0].classList).toContain('latest');
    expect(rows[0].textContent).toContain('72%');
  });

  it('emits toggle and selectReport events on user clicks', () => {
    const toggleSpy = vi.spyOn(component.toggle, 'emit');
    const selectSpy = vi.spyOn(component.selectReport, 'emit');

    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.history-toggle');
    toggle.click();
    expect(toggleSpy).toHaveBeenCalled();

    const rows = fixture.nativeElement.querySelectorAll('.history-row');
    rows[1].click();
    expect(selectSpy).toHaveBeenCalledWith(reports[1]);
  });
});
