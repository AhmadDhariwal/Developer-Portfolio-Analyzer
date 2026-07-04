import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../../shared/services/auth.service';

/**
 * OAuthCallbackComponent
 *
 * Handles the OAuth redirect landing at /auth/oauth/callback.
 * Registered WITHOUT publicGuard so that the callback can complete
 * even if a previous session cookie is technically present.
 *
 * Flow:
 *  1. Check window.location.hash for #oauth=<base64url-JSON>
 *  2. Check window.location.search for ?token=<jwt> (URL-param fallback)
 *  3. Immediately strip credentials from address bar via replaceState
 *  4. On success → completeExternalLogin() → navigate to home route
 *  5. On ?oauthError or decode failure → navigate to /auth/login?oauthError=1
 *  6. If nothing found → navigate to /auth/login
 *
 * SECURITY NOTES:
 *  - URL fragment (#oauth=…) is never sent to the server by the browser.
 *  - Token is stripped from the URL immediately before any other processing.
 *  - No OAuth secrets are stored or logged anywhere in this file.
 */
@Component({
  selector: 'app-oauth-callback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './oauth-callback.component.html',
  styleUrl: './oauth-callback.component.scss'
})
export class OAuthCallbackComponent implements OnInit {
  status: 'processing' | 'error' = 'processing';
  errorMessage = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Check for oauthError query param first
    if (this.route.snapshot.queryParamMap.has('oauthError')) {
      this.failWith('Social sign-in could not be completed. Please try again.');
      return;
    }

    // --- Primary path: token in URL hash fragment (never sent to server) ---
    const hash = window.location.hash;
    if (hash.startsWith('#oauth=')) {
      const encoded = hash.slice('#oauth='.length);

      // SECURITY: strip credentials from address bar BEFORE decoding
      window.history.replaceState(null, '', `${window.location.pathname}`);

      try {
        const payload = this.decodeBase64Payload(encoded);
        if (!payload?.token || !payload?.user) {
          throw new Error('Incomplete OAuth payload — missing token or user');
        }
        this.completeLogin(payload);
        return;
      } catch {
        this.failWith('Social sign-in could not be completed. Please try again.');
        return;
      }
    }

    // --- Fallback path: ?token= query param (less preferred; token briefly in URL) ---
    const tokenParam = this.route.snapshot.queryParamMap.get('token');
    if (tokenParam) {
      // SECURITY: strip token from URL immediately
      window.history.replaceState(null, '', `${window.location.pathname}`);

      // Build a minimal session object from the token
      try {
        const payload = { token: tokenParam };
        this.completeLogin(payload);
        return;
      } catch {
        this.failWith('Social sign-in could not be completed. Please try again.');
        return;
      }
    }

    // No payload found at all — go back to login
    this.router.navigate(['/auth/login']);
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

  private failWith(message: string): void {
    this.status = 'error';
    this.errorMessage = message;
    this.cdr.detectChanges();

    // Redirect to login with oauthError flag after a brief display
    setTimeout(() => {
      this.router.navigate(['/auth/login'], { queryParams: { oauthError: '1' } });
    }, 1500);
  }
}
