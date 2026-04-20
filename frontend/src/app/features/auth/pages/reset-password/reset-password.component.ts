import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../shared/services/auth.service';
import { UiButtonComponent } from '../../../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UiButtonComponent, UiCardComponent],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss'
})
export class ResetPasswordComponent implements OnInit {
  resetToken = '';
  newPassword = '';
  confirmPassword = '';
  isLoading = false;
  error = '';
  success = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  ngOnInit(): void {
    this.resetToken = String(history.state?.resetToken || '');
  }

  submit(): void {
    if (!this.resetToken) {
      this.error = 'Reset session expired. Please retry forgot password.';
      return;
    }
    if (!this.newPassword || this.newPassword.length < 6) {
      this.error = 'Password must be at least 6 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.success = '';
    this.authService.resetPassword({ resetToken: this.resetToken, newPassword: this.newPassword }).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.success = res.message || 'Password reset successful.';
        setTimeout(() => this.router.navigate(['/auth/login']), 1200);
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'Failed to reset password.';
      }
    });
  }
}
