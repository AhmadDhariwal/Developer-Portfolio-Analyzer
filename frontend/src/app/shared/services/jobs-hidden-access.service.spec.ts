import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { JobsHiddenAccessService } from './jobs-hidden-access.service';

describe('Hidden jobs account-password access', () => {
  let service: JobsHiddenAccessService;
  let http: HttpTestingController;
  let user: BehaviorSubject<any>;
  let token: string | null;
  const grant = 'x'.repeat(43);
  beforeEach(() => {
    localStorage.clear();
    user = new BehaviorSubject({ _id: 'owner' });
    token = 'session-a';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value, getToken: () => token },
        },
      ],
    });
    service = TestBed.inject(JobsHiddenAccessService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    TestBed.resetTestingModule();
    vi.useRealTimers();
    localStorage.clear();
  });
  async function unlock() {
    const response = firstValueFrom(service.unlock('Account!Password'));
    const request = http.expectOne((request) => request.url.endsWith('/hidden-access/unlock'));
    expect(request.request.body).toEqual({ password: 'Account!Password' });
    request.flush({ token: grant, expiresAt: Date.now() + 300000 });
    await response;
  }
  it('unlocks only after acknowledgement and stores neither password nor grant in browser storage', async () => {
    expect(service.unlocked).toBe(false);
    await unlock();
    expect(service.unlocked).toBe(true);
    expect(service.headers().get('X-Jobs-Hidden-Token')).toBe(grant);
    expect(localStorage.length).toBe(0);
  });
  it('locks immediately and revokes the exact current grant', async () => {
    await unlock();
    service.lock();
    expect(service.unlocked).toBe(false);
    const request = http.expectOne((request) => request.url.endsWith('/hidden-access/lock'));
    expect(request.request.headers.get('X-Jobs-Hidden-Token')).toBe(grant);
    request.flush({ locked: true });
    expect(service.headers().has('X-Jobs-Hidden-Token')).toBe(false);
  });
  it('clears access on auth-token replacement, even for the same account', async () => {
    await unlock();
    token = 'session-b';
    user.next({ _id: 'owner' });
    expect(service.unlocked).toBe(false);
  });
  it('cancels an in-flight confirmation on logout', () => {
    service.unlock('Account!Password').subscribe();
    const request = http.expectOne((request) => request.url.endsWith('/hidden-access/unlock'));
    token = null;
    user.next(null);
    expect(request.cancelled).toBe(true);
    expect(service.unlocked).toBe(false);
  });
  it('expires access without another request or an automatic password retry', async () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    service.changes$.subscribe((value) => changes.push(value));
    await unlock();
    vi.advanceTimersByTime(300001);
    expect(service.unlocked).toBe(false);
    expect(changes).toEqual([true, false]);
  });
  it('rejects malformed grant responses without unlocking', async () => {
    const result = firstValueFrom(service.unlock('Account!Password')).catch(() => 'rejected');
    http
      .expectOne((request) => request.url.endsWith('/hidden-access/unlock'))
      .flush({ token: 'invalid', expiresAt: Date.now() + 300000 });
    expect(await result).toBe('rejected');
    expect(service.unlocked).toBe(false);
  });
});
