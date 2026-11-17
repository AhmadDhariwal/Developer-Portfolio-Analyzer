import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OtpVerificationComponent } from './otp-verification.component';
import { AuthService } from '../../../../shared/services/auth.service';
import { ResumeOnboardingService } from '../../../../shared/services/resume-onboarding.service';

describe('OtpVerificationComponent', () => {
  let component: OtpVerificationComponent;
  let fixture: ComponentFixture<OtpVerificationComponent>;
  let authServiceMock: {
    verifyOtp: ReturnType<typeof vi.fn>;
    sendOtp: ReturnType<typeof vi.fn>;
    forgotPassword: ReturnType<typeof vi.fn>;
  };
  let resumeOnboardingMock: { triggerForNewUser: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authServiceMock = {
      verifyOtp: vi.fn(),
      sendOtp: vi.fn(),
      forgotPassword: vi.fn(),
    };
    resumeOnboardingMock = { triggerForNewUser: vi.fn() };

    window.history.replaceState(
      {
        userId: 'reset-v1.orig',
        purpose: 'forgot-password',
        type: 'email',
        email: 'ahmad@example.com',
      },
      '',
    );

    await TestBed.configureTestingModule({
      imports: [OtpVerificationComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        { provide: ResumeOnboardingService, useValue: resumeOnboardingMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OtpVerificationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    window.history.replaceState({}, '');
    fixture.destroy();
  });

  it('requires 6-digit OTP before submitting', () => {
    component.onOtpChange('123');
    component.submit();
    expect(component.error).toContain('6 digits');
    expect(authServiceMock.verifyOtp).not.toHaveBeenCalled();
  });

  it('navigates to reset-password with resetToken when forgot-password OTP succeeds', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    authServiceMock.verifyOtp.mockReturnValue(of({ resetToken: 'rt-123' }));

    component.onOtpChange('123456');
    component.submit();

    expect(authServiceMock.verifyOtp).toHaveBeenCalledWith({
      otp: '123456',
      type: 'email',
      purpose: 'forgot-password',
      userId: 'reset-v1.orig',
    });
    expect(navSpy).toHaveBeenCalledWith(['/auth/reset-password'], {
      state: { resetToken: 'rt-123' },
    });
  });

  it('updates userId when resending forgot-password OTP', () => {
    authServiceMock.forgotPassword.mockReturnValue(of({ userId: 'reset-v1.next' }));
    component.resendSeconds = 0;
    component.resendOtp();
    expect(component.userId).toBe('reset-v1.next');
  });

  it('surfaces backend error on invalid OTP', () => {
    authServiceMock.verifyOtp.mockReturnValue(
      throwError(() => ({ error: { message: 'Invalid verification code' } })),
    );

    component.onOtpChange('999999');
    component.submit();

    expect(component.error).toBe('Invalid verification code');
    expect(component.isLoading).toBe(false);
  });
});
