import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, OtpPurpose, OtpType } from '../../../../shared/services/auth.service';
import { OtpInputComponent } from '../../components/otp-input/otp-input.component';
import { UiButtonComponent } from '../../../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-otp-verification',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, OtpInputComponent, UiButtonComponent, UiCardComponent],
  templateUrl: './otp-verification.component.html',
  styleUrl: './otp-verification.component.scss'
})
export class OtpVerificationComponent implements OnInit {
  userId = '';
  type: OtpType = 'email';
  purpose: OtpPurpose = 'signup';
  email = '';
  phoneNumber = '';
  countryCode = '';
  otp = '';
  error = '';
  info = '';
  isLoading = false;
  isResending = false;
  resendSeconds = 30;
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    const state = history.state || {};
    this.userId = String(state.userId || '');
    this.type = state.type === 'phone' ? 'phone' : 'email';
    this.purpose = state.purpose === 'forgot-password' ? 'forgot-password' : 'signup';
    this.email = String(state.email || '');
    this.phoneNumber = String(state.phoneNumber || '');
    this.countryCode = String(state.countryCode || '');

    this.route.queryParamMap.subscribe((params) => {
      if (!this.userId) this.userId = String(params.get('userId') || '');
      if (!state.type && params.get('type') === 'phone') this.type = 'phone';
      if (!state.purpose && params.get('purpose') === 'forgot-password') this.purpose = 'forgot-password';
      if (!this.email) this.email = String(params.get('email') || '');
      if (!this.phoneNumber) this.phoneNumber = String(params.get('phoneNumber') || '');
      if (!this.countryCode) this.countryCode = String(params.get('countryCode') || '');
    });

    this.startResendCountdown();
  }

  onOtpChange(value: string): void {
    this.otp = value;
  }

  submit(): void {
    if (!this.userId || this.otp.length !== 6) {
      this.error = 'Please enter the 6-digit OTP.';
      return;
    }

    this.isLoading = true;
    this.error = '';

    this.authService.verifyOtp({
      userId: this.userId,
      otp: this.otp,
      type: this.type,
      purpose: this.purpose
    }).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (this.purpose === 'forgot-password') {
          this.router.navigate(['/auth/reset-password'], {
            state: {
              resetToken: res?.resetToken || ''
            }
          });
          return;
        }
        this.router.navigate(['/app/dashboard']);
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'OTP verification failed.';
      }
    });
  }

  resendOtp(): void {
    if (this.resendSeconds > 0 || !this.userId) return;

    this.isResending = true;
    this.error = '';
    this.info = '';
    const payload = this.purpose === 'forgot-password'
      ? {
        email: this.email,
        phoneNumber: this.phoneNumber,
        countryCode: this.countryCode,
        type: this.type
      }
      : {
        userId: this.userId,
        type: this.type,
        purpose: this.purpose
      };

    const request$ = this.purpose === 'forgot-password'
      ? this.authService.forgotPassword(payload)
      : this.authService.sendOtp(payload as { userId: string; type: OtpType; purpose: OtpPurpose });

    request$.subscribe({
      next: () => {
        this.isResending = false;
        this.info = 'OTP resent successfully.';
        this.startResendCountdown();
      },
      error: (err) => {
        this.isResending = false;
        this.error = err?.error?.message || 'Failed to resend OTP.';
      }
    });
  }

  private startResendCountdown(): void {
    this.resendSeconds = 30;
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
    }
    this.resendTimer = setInterval(() => {
      this.resendSeconds = Math.max(0, this.resendSeconds - 1);
      if (this.resendSeconds === 0 && this.resendTimer) {
        clearInterval(this.resendTimer);
        this.resendTimer = null;
      }
    }, 1000);
  }
}
