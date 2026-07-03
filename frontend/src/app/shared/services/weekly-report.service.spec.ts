import { defer, firstValueFrom, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyReportService } from './weekly-report.service';

class CacheStub {
  private readonly values = new Map<string, any>();

  get<T>(lookup: object): T | null {
    return this.values.get(JSON.stringify(lookup)) ?? null;
  }

  set<T>(lookup: object, value: T): void {
    this.values.set(JSON.stringify(lookup), { ...(value as object), cachedAt: Date.now() });
  }

  clearModule(module: string): void {
    for (const key of this.values.keys()) {
      const cachedModule = JSON.parse(key).module;
      if (cachedModule === module || cachedModule.startsWith(`${module}:`)) this.values.delete(key);
    }
  }
}

describe('WeeklyReportService cache behavior', () => {
  const rawReport = (id = 'report-1') => ({
    _id: id,
    weekStartDate: '2026-06-22T00:00:00.000Z',
    weekEndDate: '2026-06-28T23:59:59.999Z',
    score: 75,
    meta: {}
  });

  let api: any;
  let cache: CacheStub;
  let invalidate: () => void;
  let service: WeeklyReportService;

  beforeEach(() => {
    api = {
      getWeeklyReportLatest: vi.fn().mockReturnValue(of(rawReport())),
      getWeeklyReportHistory: vi.fn().mockReturnValue(of({ reports: [] })),
      generateWeeklyReport: vi.fn().mockReturnValue(of(rawReport('generated')))
    };
    cache = new CacheStub();
    const auth = {
      getCurrentUser: () => ({
        _id: 'user-1',
        activeGithubUsername: 'developer',
        activeCareerStack: 'Full Stack',
        activeExperienceLevel: 'Mid'
      })
    };
    const invalidation = { register: (_owner: string, callback: () => void) => { invalidate = callback; } };
    service = new WeeklyReportService(api, auth as any, cache as any, invalidation as any);
  });

  it('calls latest once on first visit and reuses it within the TTL', async () => {
    await firstValueFrom(service.getLatest());
    await firstValueFrom(service.getLatest());
    expect(api.getWeeklyReportLatest).toHaveBeenCalledTimes(1);
  });

  it('updates the stable latest cache after generate succeeds', async () => {
    await firstValueFrom(service.generateReport(true));
    const cached = await firstValueFrom(service.getLatest());
    expect(cached?._id).toBe('generated');
    expect(api.getWeeklyReportLatest).not.toHaveBeenCalled();
  });

  it('bypasses cache for manual refresh', async () => {
    await firstValueFrom(service.getLatest());
    await firstValueFrom(service.getLatest(true));
    expect(api.getWeeklyReportLatest).toHaveBeenCalledTimes(2);
  });

  it('calls latest again after global cache invalidation', async () => {
    await firstValueFrom(service.getLatest());
    invalidate();
    await firstValueFrom(service.getLatest());
    expect(api.getWeeklyReportLatest).toHaveBeenCalledTimes(2);
  });

  it('keeps one concurrent latest transport alive across navigation teardown', () => {
    const response = new Subject<any>();
    let transportSubscriptions = 0;
    api.getWeeklyReportLatest.mockReturnValue(defer(() => {
      transportSubscriptions += 1;
      return response;
    }));

    const request = service.getLatest();
    const first = request.subscribe();
    first.unsubscribe();
    request.subscribe();

    expect(transportSubscriptions).toBe(1);
    response.next(rawReport());
    response.complete();
  });
});
