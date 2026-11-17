import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { ApiService } from './api.service';

describe('ApiService getOrganizations request deduplication and caching', () => {
  let service: ApiService;
  let http: any;
  let cacheInvalidation: any;

  beforeEach(() => {
    http = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    cacheInvalidation = {
      register: vi.fn(),
    };
    service = new ApiService(http, {} as any, cacheInvalidation);
  });

  it('serializes Interview Prep tags to the existing string wire contract for generation and Sessions', () => {
    http.post.mockReturnValue(of({ questions: [] }));
    service
      .generateInterviewPrepQuestions({
        skill: 'react',
        difficulty: 'easy',
        tags: ['hooks', 'state'],
        category: 'core-concepts',
        source: 'seed',
        target: 5,
      })
      .subscribe();
    expect(http.post).toHaveBeenLastCalledWith(
      expect.stringContaining('/interview-prep/generate'),
      expect.objectContaining({
        difficulty: 'easy',
        tags: 'hooks,state',
        category: 'core-concepts',
        source: 'seed',
        target: 5,
      }),
    );
    service
      .generateInterviewPrep({
        skill: 'react',
        skillGaps: [],
        difficulty: 'easy',
        tags: ['hooks'],
        limit: 5,
      })
      .subscribe();
    expect(http.post).toHaveBeenLastCalledWith(
      expect.stringMatching(/interview-prep$/),
      expect.objectContaining({ tags: 'hooks', difficulty: 'easy', limit: 5 }),
    );
  });
  it('shares concurrent calls so only one HTTP GET request is made', () => {
    const orgs = { organizations: [{ _id: 'org1', name: 'Acme Corp' }] };
    http.get.mockReturnValue(of(orgs));

    let firstResult: any;
    let secondResult: any;

    service.getOrganizations().subscribe((res) => (firstResult = res));
    service.getOrganizations().subscribe((res) => (secondResult = res));

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(orgs);
    expect(secondResult).toEqual(orgs);
  });

  it('caches the result for subsequent calls', () => {
    const orgs = { organizations: [{ _id: 'org1', name: 'Acme Corp' }] };
    http.get.mockReturnValue(of(orgs));

    service.getOrganizations().subscribe();
    expect(http.get).toHaveBeenCalledTimes(1);

    service.getOrganizations().subscribe();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('forces a fresh request when forceRefresh is true', () => {
    const orgs = { organizations: [{ _id: 'org1', name: 'Acme Corp' }] };
    http.get.mockReturnValue(of(orgs));

    service.getOrganizations().subscribe();
    expect(http.get).toHaveBeenCalledTimes(1);

    service.getOrganizations(true).subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('clears the cache when createOrganization is called', () => {
    const orgs = { organizations: [{ _id: 'org1', name: 'Acme Corp' }] };
    http.get.mockReturnValue(of(orgs));
    http.post.mockReturnValue(of({ success: true }));

    service.getOrganizations().subscribe();
    expect(http.get).toHaveBeenCalledTimes(1);

    service.createOrganization({ name: 'New Org' }).subscribe();
    service.getOrganizations().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('clears the cache on error so subsequent attempts can retry', () => {
    http.get.mockReturnValueOnce(throwError(() => new Error('Network error')));
    let failed = false;
    service.getOrganizations().subscribe({
      error: () => (failed = true),
    });
    expect(failed).toBe(true);
    expect(http.get).toHaveBeenCalledTimes(1);

    const orgs = { organizations: [] };
    http.get.mockReturnValueOnce(of(orgs));
    let retryResult: any;
    service.getOrganizations().subscribe((res) => (retryResult = res));
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(retryResult).toEqual(orgs);
  });
});
