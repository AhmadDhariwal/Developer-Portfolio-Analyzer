import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordComponent } from './forgot-password.component';
import { AuthService } from '../../../../shared/services/auth.service';

describe('ForgotPasswordComponent', () => {
  let component: ForgotPasswordComponent;
  let fixture: ComponentFixture<ForgotPasswordComponent>;
  let authServiceMock: {
    forgotPassword: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      forgotPassword: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('validates email format before calling API', () => {
    component.email = 'not-an-email';
    component.submit();
    expect(component.fieldError).toContain('valid email');
    expect(authServiceMock.forgotPassword).not.toHaveBeenCalled();
  });

  it('submits forgotPassword and navigates to otp-verification', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    authServiceMock.forgotPassword.mockReturnValue(
      of({
        message: 'If the account is eligible, a password reset code has been sent.',
        userId: 'reset-v1.abc',
        expiresAt: '2026-11-15T12:00:00Z',
      }),
    );

    component.email = 'ahmad@example.com';
    component.submit();

    expect(authServiceMock.forgotPassword).toHaveBeenCalledWith({
      email: 'ahmad@example.com',
      phoneNumber: '',
      countryCode: '',
      type: 'email',
    });
    expect(navSpy).toHaveBeenCalledWith(
      ['/auth/otp-verification'],
      expect.objectContaining({
        state: expect.objectContaining({
          userId: 'reset-v1.abc',
          purpose: 'forgot-password',
          email: 'ahmad@example.com',
        }),
      }),
    );
  });

  it('shows API error when request fails', () => {
    authServiceMock.forgotPassword.mockReturnValue(
      throwError(() => ({ error: { message: 'Too many requests' } })),
    );

    component.email = 'ahmad@example.com';
    component.submit();

    expect(component.isLoading).toBe(false);
    expect(component.error).toBe('Too many requests');
  });
});
