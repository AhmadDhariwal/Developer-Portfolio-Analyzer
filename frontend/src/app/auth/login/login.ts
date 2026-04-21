import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, UiButtonComponent, UiCardComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  email: string = '';
  password: string = '';
  isLoading: boolean = false;
  error: string = '';

  // Per-field real-time errors
  fieldErrors: Record<string, string> = {};

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  validateEmail(): void {
    if (!this.email.trim()) {
      this.fieldErrors['email'] = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.fieldErrors['email'] = 'Enter a valid email address.';
    } else {
      this.fieldErrors['email'] = '';
    }
  }

  validatePassword(): void {
    this.fieldErrors['password'] = this.password ? '' : 'Password is required.';
  }

  onSubmit() {
    // Run all validators first
    this.validateEmail();
    this.validatePassword();

    if (!this.email.trim() || !this.password) {
      this.error = '';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.cdr.detectChanges();

    this.authService.login({ email: this.email.trim(), password: this.password }).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigate(['/app/dashboard']);
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err?.error?.message || 'Invalid email or password.';
        this.cdr.detectChanges();
      }
    });
  }

  loginWithGithub() {
    console.log('GitHub login clicked');
  }
}
