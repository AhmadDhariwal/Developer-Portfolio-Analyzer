import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
export class Login implements OnInit {
  email: string = '';
  password: string = '';
  isLoading: boolean = false;
  error: string = '';

  // Per-field real-time errors
  fieldErrors: Record<string, string> = {};

  // OAuth provider currently loading — null means no OAuth in progress
  oauthLoading: 'google' | 'github' | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // --- OAuth hash-based callback (existing behavior, unchanged) ---
    const oauthPayload = window.location.hash.startsWith('#oauth=')
      ? window.location.hash.slice('#oauth='.length)
      : '';

    if (oauthPayload) {
      // Remove credentials from the address bar before decoding or storing them.
      // SECURITY: token is never sent to server via fragment; stripped immediately.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      try {
        const normalized = oauthPayload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));

        if (!payload?.token || !payload?.user) throw new Error('Invalid OAuth payload');
        this.authService.completeExternalLogin(payload);
        this.router.navigateByUrl(this.authService.getHomeRoute(payload.user));
        return;
      } catch {
        this.error = 'Social sign-in could not be completed. Please try again.';
      }
    }

    if (this.route.snapshot.queryParamMap.has('oauthError')) {
      this.error = 'Social sign-in could not be completed. Please try again.';
    }
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
        const current = this.authService.getCurrentUser();
        const returnUrl = String(this.route.snapshot.queryParamMap.get('returnUrl') || '').trim();
        const target = this.authService.canAccessUrl(returnUrl, current)
          ? returnUrl
          : this.authService.getHomeRoute(current);
        this.router.navigateByUrl(target);
      },
      error: (err) => {
        this.isLoading = false;
        // Show backend message only — never expose raw stack traces
        this.error = err?.error?.message || 'Invalid email or password.';
        this.cdr.detectChanges();
      }
    });
  }

  /** Redirect to backend Google OAuth endpoint. No client secret involved. */
  loginWithGoogle(): void {
    if (this.oauthLoading || this.isLoading) return;
    this.oauthLoading = 'google';
    this.error = '';
    this.cdr.detectChanges();
    // startExternalLogin does window.location.assign — page navigates away immediately
    this.authService.startExternalLogin('google');
  }

  /** Redirect to backend GitHub OAuth endpoint. No client secret involved. */
  loginWithGithub(): void {
    if (this.oauthLoading || this.isLoading) return;
    this.oauthLoading = 'github';
    this.error = '';
    this.cdr.detectChanges();
    this.authService.startExternalLogin('github');
  }
}
