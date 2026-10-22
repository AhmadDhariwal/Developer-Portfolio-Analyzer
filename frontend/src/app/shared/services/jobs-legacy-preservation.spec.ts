import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';

describe('Jobs legacy activity preservation', () => {
  it('preserves account-scoped migration records while clearing disposable caches on logout', () => {
    TestBed.configureTestingModule({
      providers: [
        FrontendCacheInvalidationService,
        {
          provide: FrontendAnalysisCacheService,
          useValue: {
            clearModule: vi.fn(),
            clearCurrentSignalHash: vi.fn(),
            clearPrefixes: vi.fn(),
          },
        },
      ],
    });
    const key = 'devinsight_public_jobs_state:owner-a';
    localStorage.setItem(key, '{"one":{"saved":true}}');
    localStorage.setItem('resume_analysis_cache:test', 'disposable');
    TestBed.inject(FrontendCacheInvalidationService).clearAllUserCaches();
    expect(localStorage.getItem(key)).toContain('one');
    expect(localStorage.getItem('resume_analysis_cache:test')).toBeNull();
    localStorage.removeItem(key);
  });
});
