import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthCallbackComponent } from './oauth-callback.component';
import { AuthService } from '../../../../shared/services/auth.service';

describe('OAuthCallbackComponent', () => {
  let component: OAuthCallbackComponent;
  let fixture: ComponentFixture<OAuthCallbackComponent>;
  let authServiceMock: {
    completeExternalLogin: ReturnType<typeof vi.fn>;
    getCurrentUser: ReturnType<typeof vi.fn>;
    getHomeRoute: ReturnType<typeof vi.fn>;
  };

  const setup = async (queryParams: Record<string, string> = {}, hash = '') => {
    authServiceMock = {
      completeExternalLogin: vi.fn(),
      getCurrentUser: vi.fn().mockReturnValue({ _id: 'u1', role: 'developer' }),
      getHomeRoute: vi.fn().mockReturnValue('/app/dashboard'),
    };
    window.history.replaceState(null, '', `/auth/oauth/callback${hash}`);

    await TestBed.configureTestingModule({
      imports: [OAuthCallbackComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    return { navSpy };
  };

  afterEach(() => {
    if (fixture) fixture.destroy();
    window.history.replaceState(null, '', '/');
  });

  it('shows cancelled state when access_denied error param is present', async () => {
    await setup({ error: 'access_denied' });
    expect(component.status).toBe('cancelled');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sign-in cancelled');
  });

  it('shows account unavailable message when oauthError=account_unavailable', async () => {
    await setup({ oauthError: 'account_unavailable' });
    expect(component.status).toBe('error');
    expect(component.errorTitle).toContain('Account unavailable');
  });

  it('decodes #oauth hash payload, completes login, and clears URL hash', async () => {
    const payload = { _id: 'u1', token: 'jwt-abc', role: 'developer' };
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const { navSpy } = await setup({}, `#oauth=${encoded}`);

    expect(authServiceMock.completeExternalLogin).toHaveBeenCalledWith(payload);
    expect(window.location.hash).toBe('');
    expect(navSpy).toHaveBeenCalledWith('/app/dashboard');
  });
});
