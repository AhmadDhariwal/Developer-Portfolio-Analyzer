import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportDataSourcesComponent } from './weekly-report-data-sources.component';
import { WeeklyReportDataSourceStatus } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportDataSourcesComponent', () => {
  let component: WeeklyReportDataSourcesComponent;
  let fixture: ComponentFixture<WeeklyReportDataSourcesComponent>;

  const mockSources: Array<{ label: string; status: WeeklyReportDataSourceStatus }> = [
    {
      label: 'GitHub',
      status: {
        connected: true,
        status: 'Connected',
        freshness: 'fresh',
        lastAnalyzedAt: '2026-11-07T12:00:00.000Z',
      },
    },
    {
      label: 'Interview Prep',
      status: {
        analyzed: true,
        status: 'Stale evidence',
        freshness: 'stale',
        lastAnalyzedAt: '2026-10-15T12:00:00.000Z',
      },
    },
    {
      label: 'Learning Hub',
      status: {
        status: 'Unavailable',
        lastAnalyzedAt: null,
      },
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportDataSourcesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportDataSourcesComponent);
    component = fixture.componentInstance;
    component.dataSources = mockSources;
  });

  it('renders all source cards with appropriate tone classes', () => {
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.source-card');
    expect(cards.length).toBe(3);

    expect(cards[0].classList).toContain('source-card--live');
    expect(cards[0].textContent).toContain('GitHub');
    expect(cards[0].textContent).toContain('Connected');

    expect(cards[1].classList).toContain('source-card--warning');
    expect(cards[1].textContent).toContain('Interview Prep');

    expect(cards[2].classList).toContain('source-card--unavailable');
    expect(cards[2].textContent).toContain('Learning Hub');
  });
});
