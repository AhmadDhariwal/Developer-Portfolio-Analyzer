import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { SkillGapService, SkillGapResult } from './skill-gap.service';
import { AuthService } from './auth.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

describe('SkillGapService source validation', () => {
  let service: SkillGapService;
  let http: HttpTestingController;
  let user: any;
  const response = {
    coverage: null,
    ruleVersion: 'skill-evidence-coverage-v1',
    username: 'active',
  } as SkillGapResult;
  const match = (request: any) => request.url.endsWith('/skillgap/skill-gap');
  beforeEach(() => {
    localStorage.clear();
    user = { _id: 'owner', activeResumeFileId: 'resume-a' };
    const invalidation = {
      register: vi.fn(),
      clearRecommendationsCaches: vi.fn(),
      clearScenarioCaches: vi.fn(),
      clearNewsCaches: vi.fn(),
      clearJobsCaches: vi.fn(),
      clearCoursesCaches: vi.fn(),
      clearDashboardCaches: vi.fn(),
      clearWeeklyReportCaches: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { getCurrentUser: () => user } },
        { provide: FrontendAnalysisCacheService, useValue: { setCurrentSignalHash: vi.fn() } },
        { provide: FrontendCacheInvalidationService, useValue: invalidation },
      ],
    });
    service = TestBed.inject(SkillGapService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('asks backend to validate every sequential profile load, preserving null coverage', () => {
    let received: SkillGapResult | undefined;
    service.analyze('active', 'Backend', 'Student').subscribe((value) => (received = value));
    http.expectOne(match).flush(response);
    expect(received?.coverage).toBeNull();
    service.analyze('active', 'Backend', 'Student').subscribe();
    http.expectOne(match).flush(response);
  });
  it('coalesces identical inflight calls but separates active resume selections', () => {
    service.analyze('active', 'Backend', 'Student').subscribe();
    service.analyze('active', 'Backend', 'Student').subscribe();
    const first = http.expectOne(match);
    user.activeResumeFileId = 'resume-b';
    service.analyze('active', 'Backend', 'Student').subscribe();
    http.expectOne(match).flush(response);
    first.flush(response);
  });
  it('separates GitHub selections and same-length preview resume text', () => {
    service.analyze('alice', 'Backend', 'Student', true, false, 'abc').subscribe();
    service.analyze('alice', 'Backend', 'Student', true, false, 'xyz').subscribe();
    service.analyze('bob', 'Backend', 'Student', true, false, 'abc').subscribe();
    const requests = http.match(match);
    expect(requests.length).toBe(3);
    requests.forEach((request) => request.flush(response));
  });
  it('invalidation prevents obsolete requests from removing newer inflight requests', () => {
    service.analyze('active', 'Backend', 'Student').subscribe();
    const prior = http.expectOne(match);
    service.clearCache();
    service.analyze('active', 'Backend', 'Student').subscribe();
    const current = http.expectOne(match);
    prior.flush(response);
    service.analyze('active', 'Backend', 'Student').subscribe();
    http.expectNone(match);
    current.flush(response);
  });
  it('rejects unversioned local results and cached results for another GitHub account', () => {
    const complete = { ...response, careerStack: 'Backend', experienceLevel: 'Student' };
    service.cacheResult({ ...complete, ruleVersion: 'v7' });
    expect(service.getCachedResult('active', 'Backend', 'Student')).toBeNull();
    service.cacheResult(complete);
    expect(service.getCachedResult('other', 'Backend', 'Student')).toBeNull();
  });
});
