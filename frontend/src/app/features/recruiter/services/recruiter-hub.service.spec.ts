import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../shared/services/api.service';
import { RecruiterHubService } from './recruiter-hub.service';

describe('RecruiterHubService', () => {
  it('loads dashboard and analytics again after the active account or organization changes', async () => {
    let scope = 'account-one/org-a';
    const api = {
      getRecruiterHubDashboard: vi.fn(() => of({ scope })),
      getRecruiterHubAnalytics: vi.fn(() => of({ scope })),
    };
    const service = new RecruiterHubService(api as unknown as ApiService);
    const load = () =>
      Promise.all([firstValueFrom(service.getDashboard()), firstValueFrom(service.getAnalytics())]);

    await expect(load()).resolves.toEqual([{ scope }, { scope }]);
    scope = 'account-two/org-b';
    await expect(load()).resolves.toEqual([{ scope }, { scope }]);
    scope = 'account-two/org-c';
    await expect(load()).resolves.toEqual([{ scope }, { scope }]);
    expect(api.getRecruiterHubDashboard).toHaveBeenCalledTimes(3);
    expect(api.getRecruiterHubAnalytics).toHaveBeenCalledTimes(3);
  });
});
