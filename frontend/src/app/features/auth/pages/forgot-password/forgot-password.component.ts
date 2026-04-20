import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CountryCodeDropdownComponent } from '../../components/country-code-dropdown/country-code-dropdown.component';
import { AuthService, OtpType } from '../../../../shared/services/auth.service';
import { UiButtonComponent } from '../../../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CountryCodeDropdownComponent, UiButtonComponent, UiCardComponent],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss'
})
export class ForgotPasswordComponent {
  type: OtpType = 'email';
  email = '';
  phoneNumber = '';
  countryCode = '+92';
  isLoading = false;
  error = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  submit(): void {
    if (this.type === 'email' && !this.email) {
      this.error = 'Please enter your email.';
      return;
    }
    if (this.type === 'phone' && !this.phoneNumber) {
      this.error = 'Please enter your phone number.';
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.authService.forgotPassword({
      email: this.type === 'email' ? this.email : '',
      phoneNumber: this.type === 'phone' ? this.phoneNumber : '',
      countryCode: this.type === 'phone' ? this.countryCode : '',
      type: this.type
    }).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.router.navigate(['/auth/otp-verification'], {
          state: {
            userId: res.userId,
            type: this.type,
            purpose: 'forgot-password',
            email: this.email,
            phoneNumber: this.phoneNumber,
            countryCode: this.countryCode,
            expiresAt: res.expiresAt
          }
        });
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'Failed to send OTP.';
      }
    });
  }
}
