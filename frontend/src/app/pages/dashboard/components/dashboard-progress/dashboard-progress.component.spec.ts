import { TestBed } from '@angular/core/testing';
import { DashboardProgressComponent } from './dashboard-progress.component';
import { DashboardProgress } from '../../../../shared/models/dashboard.model';

describe('Dashboard progress evidence', () => {
  const data: DashboardProgress = {
    history: { status: 'missing', points: [], reason: 'No comparable durable assessments.' },
    sprint: {
      available: false,
      weightedCompletion: null,
      velocity: [],
      undatedCompletions: 0,
      basis: 'Latest saved sprint; recorded UTC completions only.',
    },
    skills: {
      available: false,
      proven: null,
      claimed: null,
      basis: 'Canonical Skill Gap evidence.',
    },
    evidence: { totalSources: 10, available: 0, fresh: 0, stale: 0, missing: 10 },
    github: {
      available: false,
      historyStatus: 'Legacy history identity is unknown.',
      activity: [],
    },
    completedCourses: [],
  };
  it('renders missing evidence explicitly without a fake chart or zero skill quality', async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardProgressComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardProgressComponent);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No comparable durable assessments');
    expect(fixture.nativeElement.textContent).toContain('Unavailable');
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    expect(fixture.nativeElement.querySelector('h4')).not.toBeNull();
  });
  it('keeps dates proportional and exposes exact accessible values for measured zero', async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardProgressComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardProgressComponent);
    fixture.componentRef.setInput('data', {
      ...data,
      history: {
        status: 'available',
        reason: 'Comparable scores',
        points: [
          { at: '2026-01-01', value: 0 },
          { at: '2026-01-02', value: 50 },
          { at: '2026-01-11', value: 100 },
        ],
      },
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.historyPolyline).toBe('10,110 38,60 290,10');
    expect(fixture.nativeElement.querySelector('svg').getAttribute('aria-label')).toContain(
      'zero to one hundred',
    );
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(3);
  });
  it('provides loading, stale and error states without treating them as successful evidence', async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardProgressComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardProgressComponent);
    fixture.componentRef.setInput('loading', true);
    fixture.componentRef.setInput('error', 'Evidence refresh failed');
    fixture.componentRef.setInput('stale', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('failed');
  });

  it('labels velocity dates in UTC without shifting date-only strings to the previous day', async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardProgressComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardProgressComponent);
    fixture.componentRef.setInput('data', {
      ...data,
      sprint: {
        ...data.sprint,
        available: true,
        velocity: [{ day: '2026-11-12', completed: 1, points: 9 }],
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.velocity small').textContent.trim()).toBe('Thu');
  });
});
