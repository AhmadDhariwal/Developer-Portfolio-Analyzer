import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../../shared/services/auth.service';
import { AuthShellComponent } from '../../components/auth-shell/auth-shell.component';
import { UiCardComponent } from '../../../../shared/components/ui-card/ui-card.component';

type ResetViewState = 'form' | 'expired' | 'invalid' | 'success';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AuthShellComponent, UiCardComponent],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent implements OnInit {
  resetToken = '';
  newPassword = '';
  confirmPassword = '';
  showNewPassword = false;
  showConfirmPassword = false;
  isLoading = false;
  error = '';
  fieldErrors: Record<string, string> = {};
  viewState: ResetViewState = 'form';

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    const statusParam = query.get('status');
    const stateToken = String(history.state?.resetToken || '').trim();
    const queryToken = String(query.get('token') || '').trim();

    if (queryToken && typeof window !== 'undefined') {
      // Strip token from query string immediately before proceeding
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (statusParam === 'expired') {
      this.viewState = 'expired';
      return;
    }

    if (statusParam === 'invalid') {
      this.viewState = 'invalid';
      return;
    }

    this.resetToken = stateToken || queryToken;
    if (!this.resetToken) {
      this.viewState = 'invalid';
    }
  }

  get hasMinBackendLength(): boolean {
    return this.newPassword.length >= 6;
  }

  get hasRecommendedLength(): boolean {
    return this.newPassword.length >= 8;
  }

  get hasUppercase(): boolean {
    return /[A-Z]/.test(this.newPassword);
  }

  get hasLowercase(): boolean {
    return /[a-z]/.test(this.newPassword);
  }

  get hasNumber(): boolean {
    return /[0-9]/.test(this.newPassword);
  }

  get passwordsMatch(): boolean {
    return (
      !!this.newPassword && !!this.confirmPassword && this.newPassword === this.confirmPassword
    );
  }

  get passwordScore(): number {
    if (!this.newPassword) return 0;
    let score = 0;
    if (this.hasMinBackendLength) score++;
    if (this.hasRecommendedLength) score++;
    if (this.hasUppercase && this.hasLowercase) score++;
    if (this.hasNumber) score++;
    return score;
  }

  toggleNewPasswordVisibility(): void {
    this.showNewPassword = !this.showNewPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  validateNewPassword(): void {
    if (!this.newPassword) {
      this.fieldErrors['newPassword'] = 'New password is required.';
    } else if (this.newPassword.length < 6) {
      this.fieldErrors['newPassword'] = 'Password must be at least 6 characters.';
    } else {
      this.fieldErrors['newPassword'] = '';
    }

    if (this.confirmPassword) {
      this.validateConfirmPassword();
    }
  }

  validateConfirmPassword(): void {
    if (!this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Please confirm your new password.';
    } else if (this.newPassword !== this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Passwords do not match.';
    } else {
      this.fieldErrors['confirmPassword'] = '';
    }
  }

  submit(): void {
    if (this.isLoading) return;

    if (!this.resetToken) {
      this.viewState = 'invalid';
      return;
    }

    this.validateNewPassword();
    this.validateConfirmPassword();

    if (this.fieldErrors['newPassword'] || this.fieldErrors['confirmPassword']) {
      this.error = '';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.cdr.detectChanges();

    this.authService
      .resetPassword({ resetToken: this.resetToken, newPassword: this.newPassword })
      .subscribe({
        next: () => {
          this.isLoading = false;
          this.viewState = 'success';
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.isLoading = false;
          const message = String(err?.error?.message || 'Failed to reset password.');
          const lower = message.toLowerCase();
          if (lower.includes('expired')) {
            this.viewState = 'expired';
            this.error = message;
          } else if (lower.includes('invalid')) {
            this.viewState = 'invalid';
            this.error = message;
          } else {
            this.error = message;
          }
          this.cdr.detectChanges();
        },
      });
  }
}
