import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CareerProfileService } from './career-profile.service';

describe('CareerProfileService', () => {
  let service: CareerProfileService;
  let http: { put: ReturnType<typeof vi.fn> };
  let invalidation: { clearDeveloperSignalCaches: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    });
    http = { put: vi.fn(() => of({})) };
    invalidation = { clearDeveloperSignalCaches: vi.fn(), register: vi.fn() };
    service = new CareerProfileService(http as any, {} as any, {} as any, invalidation as any);
  });

  it('does not invalidate while hydrating a profile response', () => {
    service.hydrateFromServer({
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      careerGoal: 'Improve portfolio',
      profileHash: 'profile-hash-1'
    });

    expect(invalidation.clearDeveloperSignalCaches).not.toHaveBeenCalled();
  });

  it('invalidates exactly once for a changed saved career profile', () => {
    service.hydrateFromServer({ careerStack: 'Backend', experienceLevel: 'Intern', profileHash: 'profile-hash-1' });
    http.put.mockReturnValue(of({
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      careerGoal: 'Improve portfolio',
      profileHash: 'profile-hash-2'
    }));

    service.saveCareerProfile('Backend', 'Intern', 'Improve portfolio').subscribe();

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(invalidation.clearDeveloperSignalCaches).toHaveBeenCalledTimes(1);
  });

  it('makes one request without invalidation for an identical saved profile', () => {
    service.hydrateFromServer({
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      careerGoal: 'Improve portfolio',
      profileHash: 'profile-hash-1'
    });
    http.put.mockReturnValue(of({
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      careerGoal: 'Improve portfolio',
      profileHash: 'profile-hash-1'
    }));

    service.saveCareerProfile('Backend', 'Intern', 'Improve portfolio').subscribe();

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(invalidation.clearDeveloperSignalCaches).not.toHaveBeenCalled();
  });
});
