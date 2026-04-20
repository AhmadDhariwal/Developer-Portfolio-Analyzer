import { Component } from '@angular/core';
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
  isLoading: boolean = false;
  error: string = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  onSubmit() {
    if (!this.name || !this.email || !this.password || !this.confirmPassword) {
      this.error = 'Please fill in all fields';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match';
      return;
    }

    if (this.otpType === 'phone' && !this.phoneNumber) {
      this.error = 'Phone number is required for phone OTP';
      return;
    }

    if (!this.agreeToTerms) {
      this.error = 'Please agree to the terms and conditions';
      return;
    }

    this.isLoading = true;
    this.error = '';

    this.authService.register({
      name: this.name,
      email: this.email,
      password: this.password,
      githubUsername: this.githubUsername || 'not-provided',
      phoneNumber: this.phoneNumber,
      countryCode: this.countryCode
    }).subscribe({
      next: (res) => {
        const userId = String(res?._id || '');
        const type = this.otpType;
        this.authService.sendOtp({
          userId,
          type,
          purpose: 'signup'
        }).subscribe({
          next: (otpRes) => {
            this.isLoading = false;
            this.router.navigate(['/auth/otp-verification'], {
              state: {
                userId,
                type,
                purpose: 'signup',
                email: this.email,
                phoneNumber: this.phoneNumber,
                countryCode: this.countryCode,
                expiresAt: otpRes.expiresAt
              }
            });
          },
          error: (otpErr) => {
            this.isLoading = false;
            this.error = otpErr?.error?.message || 'Account created but failed to send OTP.';
          }
        });
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err.error?.message || 'Signup failed. Please try again.';
      }
    });
  }

  signupWithGithub() {
    // GitHub OAuth implementation would go here
    console.log('GitHub signup clicked');
  }
}

