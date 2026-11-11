import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportNarrativeComponent } from './weekly-report-narrative.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportNarrativeComponent', () => {
  let component: WeeklyReportNarrativeComponent;
  let fixture: ComponentFixture<WeeklyReportNarrativeComponent>;

  const mockReport: WeeklyReport = {
    topAchievements: ['Completed portfolio migration', 'Delivered sprint goals'],
    biggestRiskArea: 'Test coverage below 80%',
    insights: ['Commit activity peaked mid-week'],
    recommendations: ['Increase unit test assertions'],
    meta: {
      skillFocus: ['Angular', 'TypeScript'],
    },
  } as unknown as WeeklyReport;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportNarrativeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportNarrativeComponent);
    component = fixture.componentInstance;
    component.report = mockReport;
  });

  it('renders achievements, risks, insights, and recommendations', () => {
    fixture.detectChanges();

    const headings = Array.from(fixture.nativeElement.querySelectorAll('h3')).map(
      (h: any) => h.textContent,
    );
    expect(headings).toContain('Achievements');
    expect(headings).toContain('Risks and Focus');
    expect(headings).toContain('Insights');
    expect(headings).toContain('Recommendations');

    const achievements = fixture.nativeElement.querySelectorAll('.ordered li');
    expect(achievements.length).toBe(2);
    expect(achievements[0].textContent).toContain('Completed portfolio migration');

    const risk = fixture.nativeElement.querySelector('.risk-copy');
    expect(risk.textContent).toContain('Test coverage below 80%');

    const chips = fixture.nativeElement.querySelectorAll('.focus-chips span');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('Angular');
  });

  it('hides sections when text is absent', () => {
    component.report = {
      topAchievements: [],
      biggestRiskArea: '',
      insights: [],
      recommendations: [],
      meta: { skillFocus: [] },
    } as unknown as WeeklyReport;
    fixture.detectChanges();

    const panels = fixture.nativeElement.querySelectorAll('.panel-card');
    expect(panels.length).toBe(0);
  });
});
