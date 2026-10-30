import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

describe('Scenario authoritative reads and session invalidation', () => {
  let api: ApiService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ApiService,
        { provide: FrontendAnalysisCacheService, useValue: {} },
        { provide: FrontendCacheInvalidationService, useValue: { register: vi.fn() } },
      ],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    localStorage.removeItem('user');
  });
  it('shares pending reads, then revalidates rather than caching authoritative history', () => {
    api.getScenarioSimulationHistory().subscribe();
    api.getScenarioSimulationHistory().subscribe();
    http.expectOne((request) => request.url.includes('/simulator/history')).flush({ history: [] });
    api.getScenarioSimulationHistory().subscribe();
    http.expectOne((request) => request.url.includes('/simulator/history')).flush({ history: [] });
  });
  it('cancels old requests on invalidation and never delivers a late account response', () => {
    let received = 0;
    localStorage.setItem('user', JSON.stringify({ _id: 'A' }));
    api.getScenarioSimulatorContext().subscribe(() => received++);
    const old = http.expectOne((request) => request.url.includes('/simulator/context'));
    api.clearScenarioCaches();
    assertCancelled(old.cancelled);
    localStorage.setItem('user', JSON.stringify({ _id: 'B' }));
    api.getScenarioSimulatorContext().subscribe(() => received++);
    http
      .expectOne((request) => request.url.includes('/simulator/context'))
      .flush({ context: { profile: { careerStack: 'B' } } });
    expect(received).toBe(1);
  });
});
const assertCancelled = (cancelled: boolean) => expect(cancelled).toBe(true);
