import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './login.component';
import { AuthService } from '../../../../shared/services/auth.service';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let authServiceMock: {
    login: ReturnType<typeof vi.fn>;
    getCurrentUser: ReturnType<typeof vi.fn>;
    canAccessUrl: ReturnType<typeof vi.fn>;
    getHomeRoute: ReturnType<typeof vi.fn>;
    startExternalLogin: ReturnType<typeof vi.fn>;
    completeExternalLogin: ReturnType<typeof vi.fn>;
  };

  const setupComponent = async (queryParams: Record<string, string> = {}) => {
    authServiceMock = {
      login: vi.fn(),
      getCurrentUser: vi.fn().mockReturnValue({ _id: 'u1', role: 'developer' }),
      canAccessUrl: vi.fn().mockReturnValue(false),
      getHomeRoute: vi.fn().mockReturnValue('/app/dashboard'),
      startExternalLogin: vi.fn(),
      completeExternalLogin: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    window.history.replaceState(null, '', '/');
    await setupComponent();
  });

  it('creates and renders primary auth controls', () => {
    expect(component).toBeTruthy();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Welcome back');
    expect(el.querySelector('button[type="submit"]')?.textContent).toContain('Sign in');
  });

  it('validates email and password inline when submitted empty', () => {
    component.onSubmit();
    expect(component.fieldErrors['email']).toContain('required');
    expect(component.fieldErrors['password']).toContain('required');
    expect(authServiceMock.login).not.toHaveBeenCalled();
  });

  it('toggles password visibility', () => {
    expect(component.showPassword).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword).toBe(true);
  });

  it('navigates to safe returnUrl on successful login', async () => {
    TestBed.resetTestingModule();
    await setupComponent({ returnUrl: '/app/resume-analyzer' });

    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    authServiceMock.login.mockReturnValue(of({ token: 'jwt-1' }));
    authServiceMock.canAccessUrl.mockReturnValue(true);

    component.email = 'dev@example.com';
    component.password = 'secret12';
    component.onSubmit();

    expect(authServiceMock.login).toHaveBeenCalledWith({
      email: 'dev@example.com',
      password: 'secret12',
    });
    expect(navSpy).toHaveBeenCalledWith('/app/resume-analyzer');
  });

  it('displays server error on failed login', () => {
    authServiceMock.login.mockReturnValue(
      throwError(() => ({ error: { message: 'Invalid email or password' } })),
    );

    component.email = 'dev@example.com';
    component.password = 'wrongpass';
    component.onSubmit();

    expect(component.isLoading).toBe(false);
    expect(component.error).toBe('Invalid email or password');
  });

  it('starts Google and GitHub OAuth and prevents duplicate requests while loading', () => {
    component.loginWithGoogle();
    expect(component.oauthLoading).toBe('google');
    expect(authServiceMock.startExternalLogin).toHaveBeenCalledWith('google');

    component.loginWithGithub();
    expect(authServiceMock.startExternalLogin).toHaveBeenCalledTimes(1);

    component.onPageShow();
    expect(component.oauthLoading).toBeNull();
  });

  it('surfaces distinct account_unavailable OAuth error message', async () => {
    TestBed.resetTestingModule();
    await setupComponent({ oauthError: 'account_unavailable' });
    expect(component.error).toContain('unavailable');
  });
});
