import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CountryCodeDropdownComponent } from '../../components/country-code-dropdown/country-code-dropdown.component';
import { AuthShellComponent } from '../../components/auth-shell/auth-shell.component';
import { AuthService, OtpType } from '../../../../shared/services/auth.service';
import { UiCardComponent } from '../../../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CountryCodeDropdownComponent,
    AuthShellComponent,
    UiCardComponent,
  ],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  type: OtpType = 'email';
  email = '';
  phoneNumber = '';
  countryCode = '+92';
  isLoading = false;
  error = '';
  fieldError = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  selectMethod(method: OtpType): void {
    if (this.isLoading) return;
    this.type = method;
    this.error = '';
    this.fieldError = '';
  }

  validateInput(): boolean {
    if (this.type === 'email') {
      const value = this.email.trim();
      if (!value) {
        this.fieldError = 'Email address is required.';
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        this.fieldError = 'Please enter a valid email address.';
        return false;
      }
      this.fieldError = '';
      return true;
    }

    if (!this.phoneNumber.trim()) {
      this.fieldError = 'Phone number is required.';
      return false;
    }
    this.fieldError = '';
    return true;
  }

  submit(): void {
    if (this.isLoading) return;
    if (!this.validateInput()) {
      this.error = '';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.cdr.detectChanges();

    const trimmedEmail = this.email.trim();
    const trimmedPhone = this.phoneNumber.trim();

    this.authService
      .forgotPassword({
        email: this.type === 'email' ? trimmedEmail : '',
        phoneNumber: this.type === 'phone' ? trimmedPhone : '',
        countryCode: this.type === 'phone' ? this.countryCode : '',
        type: this.type,
      })
      .subscribe({
        next: (res) => {
          this.isLoading = false;
          this.router.navigate(['/auth/otp-verification'], {
            state: {
              userId: res.userId,
              type: this.type,
              purpose: 'forgot-password',
              email: trimmedEmail,
              phoneNumber: trimmedPhone,
              countryCode: this.countryCode,
              expiresAt: res.expiresAt,
            },
          });
        },
        error: (err) => {
          this.isLoading = false;
          this.error = err?.error?.message || 'Unable to send verification code. Please try again.';
          this.cdr.detectChanges();
        },
      });
  }
}
