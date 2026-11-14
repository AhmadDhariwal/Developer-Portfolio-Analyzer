import { Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileService, UserProfile } from './profile.service';

describe('ProfileService session and revision safety', () => {
  let service: ProfileService;
  let http: any;
  let auth: any;
  let invalidation: any;
  const profile = (id = 'owner', hash = 'revision-a') =>
    ({
      _id: id,
      name: 'Owner',
      avatar: '',
      githubUsername: 'octocat',
      profileHash: hash,
    }) as UserProfile;
  beforeEach(() => {
    localStorage.clear();
    http = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    auth = {
      getCurrentUser: vi.fn(() => ({ _id: 'owner' })),
      getToken: vi.fn(() => 'token-a'),
      updateCurrentUser: vi.fn(),
      rotateSessionToken: vi.fn(),
    };
    invalidation = {
      register: vi.fn(),
      clearDeveloperSignalCaches: vi.fn(),
      clearPublicPortfolioCaches: vi.fn(),
    };
    service = new ProfileService(
      http,
      auth,
      { hydrateFromServer: vi.fn() } as any,
      {} as any,
      invalidation,
    );
  });
  afterEach(() => service.ngOnDestroy());
  it('rotates this session token only after a successful password change', () => {
    http.put.mockReturnValue(of({ message: 'Updated', token: 'token-rotated' }));
    service.updatePassword({ currentPassword: 'old', newPassword: 'new' }).subscribe();
    expect(auth.rotateSessionToken).toHaveBeenCalledWith('token-rotated');
  });
  it('rejects a persisted profile belonging to another account', () => {
    localStorage.setItem(
      'devinsight_profile_cache',
      JSON.stringify({ expiresAt: Date.now() + 99999, profile: profile('other') }),
    );
    http.get.mockReturnValue(of(profile()));
    let result: any;
    service.getProfile().subscribe((value) => (result = value));
    expect(result._id).toBe('owner');
    expect(http.get).toHaveBeenCalledOnce();
  });
  it('deduplicates inflight reads and honors memory expiry', () => {
    const pending = new Subject<UserProfile>();
    http.get.mockReturnValue(pending);
    service.getProfile().subscribe();
    service.getProfile().subscribe();
    expect(http.get).toHaveBeenCalledOnce();
    pending.next(profile());
    pending.complete();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);
    http.get.mockReturnValue(of(profile()));
    service.getProfile().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it('does not hydrate a late response from a logged-out session', () => {
    const pending = new Subject<UserProfile>();
    http.get.mockReturnValue(pending);
    service.getProfile().subscribe();
    auth.getToken.mockReturnValue('token-b');
    service.clearCache();
    pending.next(profile());
    pending.complete();
    expect(auth.updateCurrentUser).not.toHaveBeenCalled();
  });
  it('does not let a previous GET overwrite a successful edit', () => {
    const pending = new Subject<UserProfile>();
    http.get.mockReturnValue(pending);
    service.getProfile().subscribe();
    http.put.mockReturnValue(of({ name: 'Edited' }));
    service.updateProfile({ name: 'Edited' }).subscribe();
    pending.next(profile());
    pending.complete();
    expect(auth.updateCurrentUser).toHaveBeenCalledWith({ name: 'Edited' });
    expect(auth.updateCurrentUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Owner' }),
    );
  });
  it('rejects a late mutation after switching accounts', () => {
    const pending = new Subject<any>();
    http.put.mockReturnValue(pending);
    service.updateProfile({ name: 'Edited' }).subscribe();
    auth.getToken.mockReturnValue('token-b');
    pending.next({ name: 'Edited' });
    pending.complete();
    expect(auth.updateCurrentUser).not.toHaveBeenCalled();
  });
  it('invalidates personalization when the selected resume changes its hash', () => {
    http.get.mockReturnValue(of(profile()));
    service.getProfile().subscribe();
    http.put.mockReturnValue(of({ profileHash: 'revision-b', activeResume: { fileId: 'new' } }));
    service.updateProfile({ defaultResumeFileId: 'new' }).subscribe();
    expect(invalidation.clearDeveloperSignalCaches).toHaveBeenCalledOnce();
  });
  it('invalidates memory and dependent caches on another tab mutation', () => {
    http.get.mockReturnValue(of(profile()));
    service.getProfile().subscribe();
    localStorage.removeItem('devinsight_profile_cache');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'devinsight_profile_cache', newValue: '{}' }),
    );
    service.getProfile().subscribe();
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(invalidation.clearDeveloperSignalCaches).toHaveBeenCalled();
  });
});
