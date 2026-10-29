import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let http: {
    post: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let invalidation: { clearDeveloperSignalCaches: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { post: vi.fn(() => of({})), delete: vi.fn(() => of({})), get: vi.fn(() => of({})) };
    invalidation = { clearDeveloperSignalCaches: vi.fn() };
    service = new IntegrationsService(http as any, invalidation as any);
  });

  it('clears all developer-signal dependents after connect, sync, and disconnect', () => {
    service.manualConnect('leetcode', 'mock-user').subscribe();
    service.syncNow('leetcode').subscribe();
    service.disconnect('leetcode').subscribe();

    expect(invalidation.clearDeveloperSignalCaches).toHaveBeenCalledTimes(3);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.delete).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate dependents when a mutation fails', () => {
    http.post.mockReturnValueOnce(throwError(() => new Error('failed')));
    service.syncNow('github').subscribe({ error: () => undefined });

    expect(invalidation.clearDeveloperSignalCaches).not.toHaveBeenCalled();
  });

  it('uses separate linked-profile endpoints without invalidating developer-signal scores', () => {
    service.getHackerRankLinkedProfile().subscribe();
    service.saveHackerRankLinkedProfile('coder').subscribe();
    service.removeHackerRankLinkedProfile().subscribe();
    expect(http.get.mock.calls[0][0]).toMatch(/\/linked-profiles\/hackerrank$/);
    expect(http.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/linked-profiles\/hackerrank$/),
      { profile: 'coder' },
    );
    expect(http.delete.mock.calls[0][0]).toMatch(/\/linked-profiles\/hackerrank$/);
    expect(invalidation.clearDeveloperSignalCaches).not.toHaveBeenCalled();
  });
});
