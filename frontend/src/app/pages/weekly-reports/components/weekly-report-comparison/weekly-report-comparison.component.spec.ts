import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportComparisonComponent } from './weekly-report-comparison.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportComparisonComponent', () => {
  let component: WeeklyReportComparisonComponent;
  let fixture: ComponentFixture<WeeklyReportComparisonComponent>;

  const mockReport: WeeklyReport = {
    score: 75,
    predictedHiringReadiness: { score: 78 },
    meta: {
      activity: {
        weeklyCommitSignal: 14,
        activeRepositories: 3,
      },
      provenance: { timezone: 'UTC' },
      comparison: {
        available: true,
        reason: 'Compared with previous week',
      },
      comparisons: {
        scoreDelta: 10,
        readinessDelta: 8,
        activityCommitsDelta: 2,
        activeReposDelta: 1,
      },
    },
  } as unknown as WeeklyReport;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportComparisonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportComparisonComponent);
    component = fixture.componentInstance;
    component.report = mockReport;
    component.comparisonAvailable = true;
  });

  it('renders progress comparison rows with deltas when comparison is available', () => {
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.comparison-row');
    expect(rows.length).toBe(4);

    expect(rows[0].textContent).toContain('Overall Score');
    expect(rows[0].textContent).toContain('75');
    expect(rows[0].textContent).toContain('+10 pts');

    expect(rows[1].textContent).toContain('Readiness');
    expect(rows[1].textContent).toContain('78%');
    expect(rows[1].textContent).toContain('+8 pts');

    expect(rows[2].textContent).toContain('Weekly commits');
    expect(rows[2].textContent).toContain('14');

    expect(rows[3].textContent).toContain('Active Repositories');
    expect(rows[3].textContent).toContain('3');
    expect(rows[3].textContent).toContain('+1 repos');
  });

  it('shows comparison note and hides list when comparison is not available', () => {
    component.comparisonAvailable = false;
    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector('.comparison-list');
    expect(list).toBeNull();

    const note = fixture.nativeElement.querySelector('.comparison-note');
    expect(note.textContent).toContain('Compared with previous week');
  });
});
