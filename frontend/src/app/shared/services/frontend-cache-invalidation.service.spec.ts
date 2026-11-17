import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';

describe('Developer data revision propagation', () => {
  let service: FrontendCacheInvalidationService;
  const clearModule = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify({ _id: 'owner' }));
    service = new FrontendCacheInvalidationService({
      clearModule,
      clearCurrentSignalHash: vi.fn(),
      clearPrefixes: vi.fn(),
    } as unknown as FrontendAnalysisCacheService);
    clearModule.mockClear();
  });
  afterEach(() => {
    service.ngOnDestroy();
    localStorage.clear();
  });
  it('publishes a scoped revision after invalidation and signals an active Dashboard', () => {
    const changed = vi.fn();
    globalThis.addEventListener('devinsight:developer-data-changed', changed);
    try {
      service.clearDashboardCaches();
      expect(JSON.parse(localStorage.getItem('devinsight_developer_revision')!).owner).toBe(
        'owner:',
      );
      expect(changed).toHaveBeenCalledOnce();
      expect(clearModule).toHaveBeenCalledWith('dashboardSummary');
    } finally {
      globalThis.removeEventListener('devinsight:developer-data-changed', changed);
    }
  });
  it('invalidates matching cross-tab revisions once without rebroadcasting or accepting another owner', () => {
    const clearRecommendations = vi.fn();
    service.register('recommendations', clearRecommendations);
    const publish = (owner: string) =>
      globalThis.dispatchEvent(
        new StorageEvent('storage', {
          key: 'devinsight_developer_revision',
          newValue: JSON.stringify({ owner, revision: 'test' }),
        }),
      );
    publish('other:');
    expect(clearRecommendations).not.toHaveBeenCalled();
    publish('owner:');
    expect(clearRecommendations).toHaveBeenCalledOnce();
    expect(localStorage.getItem('devinsight_developer_revision')).toBeNull();
  });
});
