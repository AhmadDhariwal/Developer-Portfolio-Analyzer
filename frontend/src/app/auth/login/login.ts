import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import {
  AuthShellComponent,
  AuthShowcaseItem,
} from '../../features/auth/components/auth-shell/auth-shell.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, UiCardComponent, AuthShellComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnInit {
  email = '';
  password = '';
  showPassword = false;
  isLoading = false;
  error = '';
  infoMessage = '';

  // Per-field validation feedback
  fieldErrors: Record<string, string> = {};

  // OAuth provider currently loading — null means no OAuth in progress
  oauthLoading: 'google' | 'github' | null = null;

  readonly showcaseItems: AuthShowcaseItem[] = [
    {
      icon: 'chart',
      title: 'Portfolio Analysis',
      description: 'Turn your code and projects into career insights.',
    },
    {
      icon: 'calendar',
      title: 'Career Sprint',
      description: 'Plan, track and build the right engineering skills.',
    },
    {
      icon: 'layers',
      title: 'Interview Prep',
      description: 'Practice with curated and AI-powered questions.',
    },
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    // --- OAuth hash-based callback (existing backend redirect contract) ---
    const oauthPayload = window.location.hash.startsWith('#oauth=')
      ? window.location.hash.slice('#oauth='.length)
      : '';

    if (oauthPayload) {
      // Remove credentials from the address bar before decoding or storing them.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      try {
        const normalized = oauthPayload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));

        if (!payload?.token || !payload?._id) throw new Error('Invalid OAuth payload');
        this.authService.completeExternalLogin(payload);
        this.router.navigateByUrl(this.authService.getHomeRoute(payload));
        return;
      } catch {
        this.error = 'Social sign-in could not be completed. Please try again.';
      }
    }

    const query = this.route.snapshot.queryParamMap;
    if (query.get('error') === 'access_denied' || query.get('oauthError') === 'oauth_cancelled') {
      this.error =
        'Social sign-in was cancelled before completion. You can sign in below or try again.';
    } else if (query.get('oauthError') === 'account_unavailable') {
      this.error =
        'Your linked social account is currently unavailable or deactivated. Contact support or sign in with email.';
    } else if (query.has('oauthError')) {
      this.error = 'Social sign-in could not be completed. Please try again.';
    }

    if (query.get('expired') === 'true' || query.get('sessionExpired') === 'true') {
      this.infoMessage = 'Your session expired. Sign in again to return to your workspace.';
    }
  }

  @HostListener('window:pageshow')
  onPageShow(): void {
    // Reset external redirect loading indicator if navigating back from provider page
    if (this.oauthLoading) {
      this.oauthLoading = null;
      this.cdr.detectChanges();
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
    this.cdr.detectChanges();
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

  validatePassword(): void {
    this.fieldErrors['password'] = this.password ? '' : 'Password is required.';
  }

  onSubmit(): void {
    if (this.isLoading || this.oauthLoading) return;

    this.validateEmail();
    this.validatePassword();

    if (this.fieldErrors['email'] || this.fieldErrors['password']) {
      this.error = '';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.error = '';
    this.infoMessage = '';
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
        this.error = err?.error?.message || 'Invalid email or password.';
        this.cdr.detectChanges();
      },
    });
  }

  /** Redirect to backend Google OAuth endpoint. No client secret involved. */
  loginWithGoogle(): void {
    if (this.oauthLoading || this.isLoading) return;
    this.oauthLoading = 'google';
    this.error = '';
    this.cdr.detectChanges();
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
