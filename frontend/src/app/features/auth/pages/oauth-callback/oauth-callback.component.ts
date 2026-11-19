import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../../shared/services/auth.service';
import { AuthShellComponent } from '../../components/auth-shell/auth-shell.component';
import { UiCardComponent } from '../../../../shared/components/ui-card/ui-card.component';

/**
 * OAuthCallbackComponent
 *
 * Handles external OAuth redirect landing at /auth/oauth/callback.
 * Registered without publicGuard so callback completion succeeds regardless of prior client state.
 */
@Component({
  selector: 'app-oauth-callback',
  standalone: true,
  imports: [CommonModule, RouterLink, AuthShellComponent, UiCardComponent],
  templateUrl: './oauth-callback.component.html',
  styleUrl: './oauth-callback.component.scss',
})
export class OAuthCallbackComponent implements OnInit, OnDestroy {
  status: 'processing' | 'cancelled' | 'error' = 'processing';
  errorTitle = 'Social sign-in could not be completed';
  errorMessage = 'Please return to sign in and try again.';
  private redirectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    const oauthError = query.get('oauthError');
    const errorParam = query.get('error');

    if (errorParam === 'access_denied' || oauthError === 'oauth_cancelled') {
      this.failWith(
        'Sign-in cancelled',
        'You cancelled the authorization step before sign-in finished. You can sign in again whenever you are ready.',
        'cancelled',
        'oauth_cancelled',
      );
      return;
    }

    if (oauthError === 'account_unavailable') {
      this.failWith(
        'Account unavailable',
        'This social account is unavailable or deactivated. Contact support or sign in with another method.',
        'error',
        'account_unavailable',
      );
      return;
    }

    if (query.has('oauthError') || query.has('error')) {
      this.failWith(
        'Social sign-in could not be completed',
        'We could not verify the provider callback or state token. Please try signing in again.',
        'error',
        'oauth_failed',
      );
      return;
    }

    // --- Primary path: credentials encoded in URL hash fragment ---
    const hash = window.location.hash;
    if (hash.startsWith('#oauth=')) {
      const encoded = hash.slice('#oauth='.length);
      window.history.replaceState(null, '', window.location.pathname);

      try {
        const payload = this.decodeBase64Payload(encoded);
        if (!payload?.token || !payload?._id) {
          throw new Error('Incomplete OAuth payload');
        }
        this.completeLogin(payload);
        return;
      } catch {
        this.failWith(
          'Invalid sign-in response',
          'The authentication callback could not be verified. Please return to sign in and try again.',
          'error',
          'oauth_failed',
        );
        return;
      }
    }

    // --- Fallback path: ?token= query param ---
    const tokenParam = query.get('token');
    if (tokenParam) {
      window.history.replaceState(null, '', window.location.pathname);
      try {
        this.completeLogin({ token: tokenParam });
        return;
      } catch {
        this.failWith(
          'Social sign-in failed',
          'Your sign-in session could not be initialized. Please try again.',
          'error',
          'oauth_failed',
        );
        return;
      }
    }

    // Nothing present in callback URL — return cleanly to login
    this.router.navigate(['/auth/login']);
  }

  ngOnDestroy(): void {
    if (this.redirectTimer) {
      clearTimeout(this.redirectTimer);
      this.redirectTimer = null;
    }
  }

  private decodeBase64Payload(encoded: string): any {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  private completeLogin(payload: any): void {
    this.authService.completeExternalLogin(payload);
    const user = this.authService.getCurrentUser();
    this.router.navigateByUrl(this.authService.getHomeRoute(user));
  }

  private failWith(
    title: string,
    message: string,
    status: 'cancelled' | 'error',
    queryReason: string,
  ): void {
    this.status = status;
    this.errorTitle = title;
    this.errorMessage = message;
    this.cdr.detectChanges();

    this.redirectTimer = setTimeout(() => {
      this.router.navigate(['/auth/login'], { queryParams: { oauthError: queryReason } });
    }, 3500);
  }
}
