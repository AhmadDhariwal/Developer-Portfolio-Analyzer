import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportKpiGridComponent } from './weekly-report-kpi-grid.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportKpiGridComponent', () => {
  let component: WeeklyReportKpiGridComponent;
  let fixture: ComponentFixture<WeeklyReportKpiGridComponent>;

  const mockReport: WeeklyReport = {
    _id: 'report-1',
    meta: {
      githubScore: 88,
      resumeScore: 75,
      evidence: {
        inputs: {
          github: { available: true, value: 88 },
          resume: { available: true, value: 75 },
          sprint: { available: true, value: 100 },
          interview: { available: true, value: 12 },
        },
      },
      sprint: { tasksTotal: 5, completionRate: 100 },
      interview: { questionsGenerated: 12 },
      comparisons: {
        githubDelta: 5,
        resumeDelta: -2,
        sprintCompletionDelta: 0,
        interviewQuestionsDelta: 4,
      },
    },
  } as unknown as WeeklyReport;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportKpiGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportKpiGridComponent);
    component = fixture.componentInstance;
    component.report = mockReport;
    component.comparisonAvailable = true;
  });

  it('renders KPI cards with correct metric values and formatted deltas', () => {
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.kpi-card');
    expect(cards.length).toBe(4);

    expect(cards[0].textContent).toContain('GitHub Score');
    expect(cards[0].textContent).toContain('88%');
    expect(cards[0].textContent).toContain('+5 pts');

    expect(cards[1].textContent).toContain('Resume Score');
    expect(cards[1].textContent).toContain('75%');
    expect(cards[1].textContent).toContain('-2 pts');

    expect(cards[2].textContent).toContain('Sprint Completion');
    expect(cards[2].textContent).toContain('100%');

    expect(cards[3].textContent).toContain('Interview Progress');
    expect(cards[3].textContent).toContain('12');
    expect(cards[3].textContent).toContain('+4 qs');
  });

  it('handles unavailable inputs gracefully', () => {
    component.report = {
      meta: {
        evidence: {
          inputs: {
            github: { available: false },
            sprint: { available: false, reason: 'Missing evidence' },
            interview: { available: false },
          },
        },
        comparisons: {},
      },
    } as unknown as WeeklyReport;
    component.comparisonAvailable = false;
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.kpi-card');
    expect(cards[0].textContent).toContain('Not assessed');
    expect(cards[2].textContent).toContain('Unavailable');
    expect(cards[3].textContent).toContain('Unavailable');
    expect(cards[0].textContent).toContain('No comparable week');
  });
});
