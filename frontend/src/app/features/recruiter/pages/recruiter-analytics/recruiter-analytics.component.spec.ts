import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { RecruiterAnalyticsComponent } from './recruiter-analytics.component';

describe('Recruiter Analytics population accuracy', () => {
  async function mount(response: any) {
    const service = { getAnalytics: vi.fn().mockReturnValue(response) };
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [RecruiterAnalyticsComponent],
      providers: [provideRouter([]), { provide: RecruiterHubService, useValue: service }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    const fixture = TestBed.createComponent(RecruiterAnalyticsComponent);
    fixture.detectChanges();
    return { fixture, service, component: fixture.componentInstance };
  }

  it('separates exact population supply from bounded cards and audit metrics', async () => {
    const { fixture, component } = await mount(
      of({
        metrics: { totalCandidates: 5200, avgCandidateScore: 64.7 },
        charts: { supplyVsDemand: [{ label: 'TypeScript', supply: 3100, demand: 3 }] },
        meta: {
          candidatePopulation: { mode: 'exact', total: 5200 },
          topCandidates: { mode: 'bounded', poolLimit: 240 },
          activity: { mode: 'bounded', limit: 500 },
        },
      }),
    );
    expect(fixture.nativeElement.textContent).toContain('all 5,200 currently eligible candidates');
    expect(fixture.nativeElement.textContent).toContain('up to 500 recent audit events');
    expect(fixture.nativeElement.textContent).toContain('up to 240 discovery profiles');
    expect(component.analytics.charts.supplyVsDemand[0].supply).toBe(3100);
  });

  it('accepts old payloads without claiming exactness', async () => {
    const { component } = await mount(of({ analytics: { metrics: { totalCandidates: 0 } } }));
    expect(component.populationAccuracyHint).toContain('not reported');
    expect(component.boundedAccuracyHint).toBe('');
    expect(component.analytics.charts.supplyVsDemand).toEqual([]);
  });

  it('shows a successful exact empty population', async () => {
    const { fixture } = await mount(
      of({ meta: { candidatePopulation: { mode: 'exact', total: 0 } } }),
    );
    expect(fixture.nativeElement.textContent).toContain('all 0 currently eligible candidates');
  });

  it('hides old metrics during refresh, reports access failure and supports retry', async () => {
    const { fixture, service, component } = await mount(
      of({ meta: { candidatePopulation: { mode: 'exact', total: 5200 } } }),
    );
    const pending = new Subject<any>();
    service.getAnalytics.mockReturnValueOnce(pending);
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('all 5,200');
    pending.error({ error: { message: 'Membership revoked' } });
    fixture.detectChanges();
    expect(component.error).toBe('Membership revoked');
    expect(component.metricsReady).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('all 5,200');
    service.getAnalytics.mockReturnValueOnce(
      of({ meta: { candidatePopulation: { mode: 'exact', total: 1 } } }),
    );
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    expect(component.loading).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('all 1 currently eligible candidates');
  });
});
