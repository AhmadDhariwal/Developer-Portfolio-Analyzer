import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpErrorResponse } from '@angular/common/http';
import { runInInjectionContext, EnvironmentInjector } from '@angular/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../shared/services/auth.service';
import { Router } from '@angular/router';
import { MaintenanceModeService } from '../shared/services/maintenance-mode.service';

describe('authInterceptor - Token Expiration and 401 Handling', () => {
  let authServiceMock: any;
  let routerMock: any;
  let maintenanceModeMock: any;
  let storageMap: Map<string, string>;
  let injector: EnvironmentInjector;

  beforeEach(() => {
    storageMap = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => storageMap.set(key, value),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
    };

    vi.stubGlobal('localStorage', mockStorage);

    authServiceMock = {
      isLoggedIn: vi.fn(() => true),
      logout: vi.fn(),
    };
    routerMock = {
      navigate: vi.fn(),
      url: '/app/dashboard?tab=overview',
    };
    maintenanceModeMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: MaintenanceModeService, useValue: maintenanceModeMock },
      ],
    });
    injector = TestBed.inject(EnvironmentInjector);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const runInterceptor = (req: HttpRequest<any>, nextFn: any) => {
    return runInInjectionContext(injector, () => authInterceptor(req, nextFn));
  };

  it('2. ignores 401s from login endpoint', () => {
    authServiceMock.isLoggedIn.mockReturnValue(false);
    const req = new HttpRequest('POST', '/api/auth/login', { email: 'user@test.com' });
    const next = () =>
      throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }));

    let caughtError: any;
    runInterceptor(req, next).subscribe({
      error: (err: any) => {
        caughtError = err;
      },
    });

    expect(caughtError?.status).toBe(401);
    expect(authServiceMock.logout).not.toHaveBeenCalled();
  });

  it('10. triggers single logout when receiving 401 on protected endpoint', () => {
    const req = new HttpRequest('GET', '/api/user/profile');
    const next = () =>
      throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }));

    runInterceptor(req, next).subscribe({ error: () => {} });

    expect(authServiceMock.logout).toHaveBeenCalledTimes(1);
    expect(authServiceMock.logout).toHaveBeenCalledWith(true, '/app/dashboard?tab=overview');
  });

  it('keeps a valid session when the current-password challenge fails', () => {
    const req = new HttpRequest('PUT', '/api/profile/password', { currentPassword: 'incorrect' });
    const next = () =>
      throwError(
        () => new HttpErrorResponse({ status: 401, error: { code: 'CURRENT_PASSWORD_INCORRECT' } }),
      );
    let caught: any;
    runInterceptor(req, next).subscribe({ error: (error) => (caught = error) });
    expect(caught.status).toBe(401);
    expect(authServiceMock.logout).not.toHaveBeenCalled();
  });
  it('still logs out a revoked session on the password endpoint', () => {
    const req = new HttpRequest('PUT', '/api/profile/password', {});
    const next = () =>
      throwError(
        () => new HttpErrorResponse({ status: 401, error: { message: 'Session expired' } }),
      );
    runInterceptor(req, next).subscribe({ error: () => {} });
    expect(authServiceMock.logout).toHaveBeenCalledOnce();
  });

  it('9. rejects protected requests early when session is logged out', () => {
    authServiceMock.isLoggedIn.mockReturnValue(false);
    const req = new HttpRequest('GET', '/api/user/profile');
    const next = vi.fn();

    let caughtError: any;
    runInterceptor(req, next).subscribe({
      error: (err: any) => {
        caughtError = err;
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(caughtError?.status).toBe(401);
    expect(caughtError?.error?.message).toBe('Session expired');
  });
});
