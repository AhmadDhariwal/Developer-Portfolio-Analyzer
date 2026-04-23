import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, OtpType } from '../../shared/services/auth.service';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { CountryCodeDropdownComponent } from '../../features/auth/components/country-code-dropdown/country-code-dropdown.component';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, UiButtonComponent, UiCardComponent, CountryCodeDropdownComponent],
  templateUrl: './signup.html',
  styleUrl: './signup.scss',
})
export class Signup {
  name: string = '';
  email: string = '';
  githubUsername: string = '';
  password: string = '';
  confirmPassword: string = '';
  otpType: OtpType = 'email';
  countryCode = '+92';
  phoneNumber = '';
  agreeToTerms: boolean = false;
  isPublic: boolean = false;
  isLoading: boolean = false;
  error: string = '';

  // Per-field errors for real-time feedback
  fieldErrors: Record<string, string> = {};

  constructor(private readonly authService: AuthService, private readonly router: Router, private readonly cdr: ChangeDetectorRef) {}

  // ── Real-time validators ──────────────────────────────────────────────────

  validateName(): void {
    this.fieldErrors['name'] = this.name.trim() ? '' : 'Full name is required.';
  }

  validateEmail(): void {
    if (!this.email.trim()) {
      this.fieldErrors['email'] = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.fieldErrors['email'] = 'Enter a valid email address.';
    } else {
      this.fieldErrors['email'] = '';
    }
  }

  validateGithubUsername(): void {
    this.fieldErrors['githubUsername'] = this.githubUsername.trim() ? '' : 'GitHub username is required.';
  }

  validatePassword(): void {
    if (!this.password) {
      this.fieldErrors['password'] = 'Password is required.';
    } else if (this.password.length < 6) {
      this.fieldErrors['password'] = 'Password must be at least 6 characters.';
    } else {
      this.fieldErrors['password'] = '';
    }
    // Re-validate confirm password whenever password changes
    if (this.confirmPassword) {
      this.validateConfirmPassword();
    }
  }

  validateConfirmPassword(): void {
    if (!this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Please confirm your password.';
    } else if (this.password !== this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Passwords do not match.';
    } else {
      this.fieldErrors['confirmPassword'] = '';
    }
  }

  validatePhoneNumber(): void {
    if (this.otpType === 'phone') {
      this.fieldErrors['phoneNumber'] = this.phoneNumber.trim() ? '' : 'Phone number is required.';
    } else {
      this.fieldErrors['phoneNumber'] = '';
    }
  }

  onOtpTypeChange(): void {
    // Clear phone error when switching back to email
    if (this.otpType === 'email') {
      this.fieldErrors['phoneNumber'] = '';
    }
  }

  // ── Form submission ───────────────────────────────────────────────────────

  private getValidationError(): string | null {
    if (!this.name.trim()) return 'Full name is required.';
    if (!this.email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) return 'Enter a valid email address.';
    if (!this.githubUsername.trim()) return 'GitHub username is required.';
    if (!this.password) return 'Password is required.';
    if (this.password.length < 6) return 'Password must be at least 6 characters.';
    if (this.password !== this.confirmPassword) return 'Passwords do not match.';
    if (this.otpType === 'phone' && !this.phoneNumber.trim()) return 'Phone number is required for phone OTP.';
    if (!this.agreeToTerms) return 'Please agree to the Terms of Service and Privacy Policy.';
    return null;
  }

  onSubmit() {
    const validationError = this.getValidationError();
    if (validationError) {
      this.error = validationError;
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.cdr.detectChanges();

    // Only send phone fields when the user actually chose phone OTP
    const payload: any = {
      name: this.name.trim(),
      email: this.email.trim(),
      password: this.password,
      githubUsername: this.githubUsername.trim(),
      isPublic: this.isPublic,
    };

    if (this.otpType === 'phone') {
      payload.phoneNumber = this.phoneNumber.trim();
      payload.countryCode = this.countryCode;
    }

    this.authService.register(payload).subscribe({
      next: (res) => {
        // Backend now returns pendingId (no user created yet — awaiting OTP)
        const pendingId = String(res?.pendingId || '');
        const type = this.otpType;
        this.isLoading = false;
        this.router.navigate(['/auth/otp-verification'], {
          state: {
            pendingId,
            type,
            purpose: 'signup',
            email: this.email.trim(),
            phoneNumber: this.otpType === 'phone' ? this.phoneNumber.trim() : '',
            countryCode: this.otpType === 'phone' ? this.countryCode : '',
            expiresAt: res.expiresAt
          }
        });
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'Signup failed. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  signupWithGithub() {
    // GitHub OAuth implementation would go here
    console.log('GitHub signup clicked');
  }
}
