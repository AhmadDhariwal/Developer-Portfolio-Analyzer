import { ChangeDetectorRef, Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, OtpType } from '../../shared/services/auth.service';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { CountryCodeDropdownComponent } from '../../features/auth/components/country-code-dropdown/country-code-dropdown.component';
import {
  AuthShellComponent,
  AuthShowcaseItem,
} from '../../features/auth/components/auth-shell/auth-shell.component';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    UiCardComponent,
    CountryCodeDropdownComponent,
    AuthShellComponent,
  ],
  templateUrl: './signup.html',
  styleUrl: './signup.scss',
})
export class Signup {
  name = '';
  email = '';
  githubUsername = '';
  password = '';
  confirmPassword = '';
  otpType: OtpType = 'email';
  countryCode = '+92';
  phoneNumber = '';
  agreeToTerms = false;
  isPublic = false;
  isLoading = false;
  error = '';

  showPassword = false;
  showConfirmPassword = false;

  // Per-field validation messages
  fieldErrors: Record<string, string> = {};

  // OAuth provider currently loading — null means no OAuth in progress
  oauthLoading: 'google' | 'github' | null = null;

  readonly showcaseItems: AuthShowcaseItem[] = [
    {
      icon: 'github',
      title: 'GitHub Analysis',
      description: 'Turn your repositories and code history into verified insights.',
    },
    {
      icon: 'chart',
      title: 'Portfolio Readiness',
      description: 'Measure and improve your target-role career readiness.',
    },
    {
      icon: 'award',
      title: 'Interview Preparation',
      description: 'Practice with curated and AI-generated technical questions.',
    },
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  @HostListener('window:pageshow')
  onPageShow(): void {
    if (this.oauthLoading) {
      this.oauthLoading = null;
      this.cdr.detectChanges();
    }
  }

  get hasMinBackendLength(): boolean {
    return this.password.length >= 6;
  }

  get hasRecommendedLength(): boolean {
    return this.password.length >= 8;
  }

  get hasUppercase(): boolean {
    return /[A-Z]/.test(this.password);
  }

  get hasLowercase(): boolean {
    return /[a-z]/.test(this.password);
  }

  get hasNumber(): boolean {
    return /[0-9]/.test(this.password);
  }

  get passwordScore(): number {
    if (!this.password) return 0;
    let score = 0;
    if (this.hasMinBackendLength) score++;
    if (this.hasRecommendedLength) score++;
    if (this.hasUppercase && this.hasLowercase) score++;
    if (this.hasNumber) score++;
    return score;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
    this.cdr.detectChanges();
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
    this.cdr.detectChanges();
  }

  selectOtpType(type: OtpType): void {
    if (this.isLoading || this.oauthLoading) return;
    this.otpType = type;
    if (type === 'email') {
      this.fieldErrors['phoneNumber'] = '';
    }
  }

  validateName(): void {
    this.fieldErrors['name'] = this.name.trim() ? '' : 'Full name is required.';
  }

  validateEmail(): void {
    if (!this.email.trim()) {
      this.fieldErrors['email'] = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.fieldErrors['email'] = 'Please enter a valid email address.';
    } else {
      this.fieldErrors['email'] = '';
    }
  }

  validateGithubUsername(): void {
    this.fieldErrors['githubUsername'] = this.githubUsername.trim()
      ? ''
      : 'GitHub username is required.';
  }

  validatePassword(): void {
    if (!this.password) {
      this.fieldErrors['password'] = 'Password is required.';
    } else if (this.password.length < 6) {
      this.fieldErrors['password'] = 'Password must be at least 6 characters.';
    } else {
      this.fieldErrors['password'] = '';
    }
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
      this.fieldErrors['phoneNumber'] = this.phoneNumber.trim()
        ? ''
        : 'Phone number is required for SMS OTP.';
    } else {
      this.fieldErrors['phoneNumber'] = '';
    }
  }

  validateTerms(): void {
    this.fieldErrors['agreeToTerms'] = this.agreeToTerms
      ? ''
      : 'Please accept the Terms of Service and Privacy Policy to continue.';
  }

  private runAllValidations(): boolean {
    this.validateName();
    this.validateEmail();
    this.validateGithubUsername();
    this.validatePhoneNumber();
    this.validatePassword();
    this.validateConfirmPassword();
    this.validateTerms();

    return !(
      this.fieldErrors['name'] ||
      this.fieldErrors['email'] ||
      this.fieldErrors['githubUsername'] ||
      this.fieldErrors['phoneNumber'] ||
      this.fieldErrors['password'] ||
      this.fieldErrors['confirmPassword'] ||
      this.fieldErrors['agreeToTerms']
    );
  }

  onSubmit(): void {
    if (this.isLoading || this.oauthLoading) return;

    if (!this.runAllValidations()) {
      this.error = 'Please review the highlighted fields before continuing.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.cdr.detectChanges();

    // Only send phone fields when the user selected phone OTP
    const payload: {
      name: string;
      email: string;
      password: string;
      githubUsername: string;
      isPublic: boolean;
      phoneNumber?: string;
      countryCode?: string;
    } = {
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
            expiresAt: res.expiresAt,
          },
        });
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'Signup failed. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  /** Redirect to backend Google OAuth endpoint. No client secret involved. */
  signupWithGoogle(): void {
    if (this.oauthLoading || this.isLoading) return;
    this.oauthLoading = 'google';
    this.error = '';
    this.cdr.detectChanges();
    this.authService.startExternalLogin('google');
  }

  /** Redirect to backend GitHub OAuth endpoint. No client secret involved. */
  signupWithGithub(): void {
    if (this.oauthLoading || this.isLoading) return;
    this.oauthLoading = 'github';
    this.error = '';
    this.cdr.detectChanges();
    this.authService.startExternalLogin('github');
  }
}
