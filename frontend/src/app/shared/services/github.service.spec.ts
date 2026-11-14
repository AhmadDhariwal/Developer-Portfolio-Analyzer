import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GithubService, GitHubAnalysisResult } from './github.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';

describe('GithubService cache lifecycle', () => {
  let service: GithubService;
  let http: HttpTestingController;
  let clearGithub: () => void;
  let invalidation: {
    register: ReturnType<typeof vi.fn>;
    clearDeveloperSignalCaches: ReturnType<typeof vi.fn>;
    clearGithubCaches: ReturnType<typeof vi.fn>;
  };
  const url = `${environment.apiBaseUrl}/github/analyze`;
  const result: GitHubAnalysisResult = {
    repoCount: 0,
    totalStars: 0,
    totalForks: 0,
    activityScore: 0,
    languageDistribution: [],
    repositoryActivity: [],
    repositories: [],
    cache: { source: 'fresh', hit: false },
  };

  beforeEach(() => {
    invalidation = {
      register: vi.fn((_owner, clear) => {
        clearGithub = clear;
      }),
      clearDeveloperSignalCaches: vi.fn(),
      clearGithubCaches: vi.fn(() => clearGithub()),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FrontendAnalysisCacheService, useValue: { clearCurrentSignalHash: vi.fn() } },
        { provide: FrontendCacheInvalidationService, useValue: invalidation },
      ],
    });
    service = TestBed.inject(GithubService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('deduplicates normalized usernames and keeps preview and save independent', () => {
    service.analyzeProfile('@Octocat').subscribe();
    service.analyzeProfile('octocat').subscribe();
    service.analyzeAndSave('octocat').subscribe();
    http.expectOne(url).flush(result);
    expect(invalidation.clearDeveloperSignalCaches).not.toHaveBeenCalled();
    http.expectOne(`${environment.apiBaseUrl}/github/analyze-save`).flush(result);
    expect(invalidation.clearDeveloperSignalCaches).toHaveBeenCalledOnce();
    expect(service.getCachedAnalysis('octocat', 'save')).toBeTruthy();
  });

  it('does not let an old response repopulate caches or remove a newer in-flight request', () => {
    service.analyzeProfile('octocat').subscribe();
    const old = http.expectOne(url);
    service.clearCache();
    service.analyzeProfile('octocat').subscribe();
    const current = http.expectOne(url);
    old.flush(result);
    expect(service.getCachedAnalysis('octocat', 'public')).toBeNull();
    service.analyzeProfile('octocat').subscribe();
    http.expectNone(url);
    current.flush(result);
    expect(service.getCachedAnalysis('octocat', 'public')).toBeTruthy();
  });

  it('does not cache degraded snapshots or invalidate developer signals for them', () => {
    for (const degraded of [
      { ...result, rateLimited: true },
      { ...result, warning: 'Cached fallback' },
      { ...result, cache: { source: 'stale-cache', hit: true, stale: true } },
      { ...result, cache: { source: 'cache', hit: true, stale: true } },
    ]) {
      service.analyzeAndSave('octocat').subscribe();
      http.expectOne(`${environment.apiBaseUrl}/github/analyze-save`).flush(degraded);
      expect(service.getCachedAnalysis('octocat', 'save')).toBeNull();
    }
    expect(invalidation.clearDeveloperSignalCaches).not.toHaveBeenCalled();
  });

  it('retries after an HTTP error', () => {
    service.analyzeProfile('octocat').subscribe({ error: () => {} });
    http.expectOne(url).flush({}, { status: 503, statusText: 'Unavailable' });
    service.analyzeProfile('octocat').subscribe();
    http.expectOne(url).flush(result);
    expect(service.getCachedAnalysis('octocat', 'public')).toBeTruthy();
  });
});
