import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, firstValueFrom, isObservable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, SessionUser } from '../../shared/services/auth.service';
import { authGuard } from './auth.guard';
import { recruiterRoleGuard } from './recruiter-role.guard';

describe('Recruiter & Auth route guards', () => {
  let isLoggedIn$: BehaviorSubject<boolean>;
  let currentUser: SessionUser | null;
  let authServiceMock: {
    isLoggedIn$: BehaviorSubject<boolean>;
    getCurrentUser: ReturnType<typeof vi.fn>;
    getHomeRoute: ReturnType<typeof vi.fn>;
    canAccessUrl: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(() => {
    isLoggedIn$ = new BehaviorSubject<boolean>(true);
    currentUser = { _id: 'r1', role: 'recruiter', name: 'Recruiter' };

    authServiceMock = {
      isLoggedIn$,
      getCurrentUser: vi.fn(() => currentUser),
      getHomeRoute: vi.fn((user?: SessionUser | null) =>
        user?.role === 'recruiter' ? '/app/recruiter/dashboard' : '/app/dashboard',
      ),
      canAccessUrl: vi.fn(() => true),
    };

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceMock }],
    });

    router = TestBed.inject(Router);
  });

  const runAuthGuard = async (url: string) => {
    const res = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
    return isObservable(res) ? firstValueFrom(res) : res;
  };

  it('allows authenticated users through authGuard and redirects recruiter onboarding query cleanly', async () => {
    expect(await runAuthGuard('/app/recruiter/jobs')).toBe(true);

    const redirected = await runAuthGuard('/app/profile?onboarding=recruiter');
    expect(redirected instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(redirected as UrlTree)).toBe(
      '/app/recruiter/profile?onboarding=recruiter',
    );
  });

  it('redirects unauthenticated visitors from authGuard to /auth/login preserving returnUrl', async () => {
    isLoggedIn$.next(false);
    const redirected = await runAuthGuard('/app/recruiter/matches');
    expect(redirected instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(redirected as UrlTree)).toBe(
      '/auth/login?returnUrl=%2Fapp%2Frecruiter%2Fmatches',
    );
  });

  it('permits recruiter users and blocks developer users in recruiterRoleGuard', async () => {
    const allowRes = await TestBed.runInInjectionContext(() =>
      recruiterRoleGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/app/recruiter/dashboard' } as RouterStateSnapshot,
      ),
    );
    expect(allowRes).toBe(true);

    currentUser = { _id: 'd1', role: 'developer' };
    const blockRes = await TestBed.runInInjectionContext(() =>
      recruiterRoleGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/app/recruiter/dashboard' } as RouterStateSnapshot,
      ),
    );
    expect(blockRes instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(blockRes as UrlTree)).toBe('/app/dashboard');
  });
});
