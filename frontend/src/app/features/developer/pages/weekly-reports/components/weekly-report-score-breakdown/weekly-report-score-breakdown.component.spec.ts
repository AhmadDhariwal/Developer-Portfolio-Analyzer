import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportScoreBreakdownComponent } from './weekly-report-score-breakdown.component';

describe('WeeklyReportScoreBreakdownComponent', () => {
  let component: WeeklyReportScoreBreakdownComponent;
  let fixture: ComponentFixture<WeeklyReportScoreBreakdownComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportScoreBreakdownComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportScoreBreakdownComponent);
    component = fixture.componentInstance;
  });

  it('renders rows for each breakdown item with correct weights and score text', () => {
    component.items = [
      {
        key: 'github',
        label: 'GitHub',
        score: 90,
        weight: 30,
        contribution: 27,
        reason: 'Saved evidence',
      },
      {
        key: 'resume',
        label: 'Resume',
        score: null,
        weight: 25,
        contribution: null,
        reason: 'Missing evidence',
      },
    ];
    component.overallLabel = '72';
    fixture.detectChanges();

    const heading = fixture.nativeElement.querySelector('h3');
    expect(heading.textContent).toBe('Score Breakdown');

    const rows = fixture.nativeElement.querySelectorAll('.breakdown-row');
    expect(rows.length).toBe(2);

    expect(rows[0].textContent).toContain('GitHub');
    expect(rows[0].textContent).toContain('30% weight');
    expect(rows[0].textContent).toContain('90% · 27 weighted points');

    expect(rows[1].textContent).toContain('Resume');
    expect(rows[1].textContent).toContain('Missing evidence — not a zero score');
  });
});
