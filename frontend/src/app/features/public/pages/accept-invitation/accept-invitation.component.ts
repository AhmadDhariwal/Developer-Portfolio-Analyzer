import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { timeout, catchError, finalize } from 'rxjs/operators';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../shared/services/auth.service';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './accept-invitation.component.html',
  styleUrl: './accept-invitation.component.scss',
})
export class AcceptInvitationComponent implements OnInit {
  private readonly apiBase = environment.apiBaseUrl;

  token = '';
  loading = true;
  accepted = false;
  error = '';
  processing = false;
  redirectTo = '/app/recruiter';

  details: {
    name?: string;
    email: string;
    role: string;
    organizationName: string;
    hasExistingAccount: boolean;
  } | null = null;

  form = {
    name: '',
    phoneNumber: '',
    password: '',
    githubUsername: '',
    linkedin: '',
    countryCode: '+92',
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly authService: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.token = String(this.route.snapshot.paramMap.get('token') || '').trim();

    if (!this.token) {
      this.loading = false;
      this.error = 'Invitation token is missing.';
      this.cdr.markForCheck();
      return;
    }

    this.http
      .get<any>(`${this.apiBase}/auth/invite-details/${encodeURIComponent(this.token)}`, {
        headers: { 'X-Skip-Auth': '1' },
      })
      .pipe(
        catchError((err) =>
          err?.status === 404
            ? this.http.get<any>(
                `${this.apiBase}/tenant/invitations/${encodeURIComponent(this.token)}/details`,
                { headers: { 'X-Skip-Auth': '1' } },
              )
            : throwError(() => err),
        ),
        timeout(10000),
        catchError((err) => {
          const msg =
            err?.error?.message ||
            (err?.name === 'TimeoutError'
              ? 'Request timed out. Please check your connection.'
              : null) ||
            'This invitation link is invalid or has expired.';
          return of({ __error: msg });
        }),
        finalize(() => this.cdr.markForCheck()),
      )
      .subscribe((res: any) => {
        this.loading = false;
        if (res?.__error) {
          this.error = res.__error;
          this.cdr.markForCheck();
          return;
        }
        this.details = res?.invitation ?? null;
        if (!this.details) {
          this.error = 'Invitation details could not be loaded.';
          this.cdr.markForCheck();
          return;
        }
        this.form.name = this.details.name || '';
        this.cdr.markForCheck();
      });
  }

  get isFormValid(): boolean {
    const pwValid = this.form.password.trim().length >= 6;
    const phoneValid = this.details?.role !== 'recruiter' || this.form.phoneNumber.trim();
    return !!(this.form.name.trim() && phoneValid && pwValid);
  }

  get signedInRecipient(): boolean {
    return (
      this.authService.getCurrentUser()?.email?.toLowerCase() === this.details?.email.toLowerCase()
    );
  }

  acceptExistingAccount(): void {
    if (this.processing || !this.details?.hasExistingAccount) return;
    if (!this.signedInRecipient) {
      this.router.navigate(['/auth/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    this.processing = true;
    this.error = '';
    this.http
      .post(`${this.apiBase}/tenant/invitations/accept/${encodeURIComponent(this.token)}`, {})
      .pipe(
        timeout(15000),
        finalize(() => {
          this.processing = false;
          this.cdr.markForCheck();
        }),
      )
      .subscribe({
        next: () => {
          this.redirectTo = '/auth/login';
          this.accepted = true;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Failed to accept invitation. Please try again.';
        },
      });
  }

  submit(): void {
    if (!this.isFormValid || this.processing || this.details?.hasExistingAccount) return;

    this.processing = true;
    this.error = '';
    const recruiter = this.details?.role === 'recruiter';

    this.http
      .post<any>(
        recruiter
          ? `${this.apiBase}/auth/accept-invite`
          : `${this.apiBase}/tenant/invitations/accept/${encodeURIComponent(this.token)}/onboard`,
        {
          token: this.token,
          name: this.form.name.trim(),
          phoneNumber: this.form.phoneNumber.trim(),
          password: this.form.password || undefined,
          githubUsername: this.form.githubUsername.trim() || undefined,
          linkedin: this.form.linkedin.trim() || undefined,
          countryCode: this.form.countryCode || undefined,
        },
        { headers: { 'X-Skip-Auth': '1' } },
      )
      .pipe(
        timeout(15000),
        catchError((err) => {
          const msg =
            err?.error?.message ||
            (err?.name === 'TimeoutError' ? 'Request timed out. Please try again.' : null) ||
            'Failed to complete setup. Please try again.';
          return of({ __error: msg });
        }),
        finalize(() => this.cdr.markForCheck()),
      )
      .subscribe((res: any) => {
        this.processing = false;
        if (res?.__error) {
          this.error = res.__error;
          this.cdr.markForCheck();
          return;
        }

        const user = res?.user;

        // Store the session so AuthService streams and guards recognize the authenticated user
        if (user?.token) {
          this.authService.adoptSession({
            ...user,
            organizationName: user.organizationName || this.details?.organizationName || '',
          });
        }

        this.redirectTo = res?.redirectTo || (recruiter ? '/app/recruiter' : '/app/dashboard');
        this.accepted = true;
        this.cdr.markForCheck();
        setTimeout(() => this.goToDashboard(), 800);
      });
  }

  goToDashboard(): void {
    if (this.details?.hasExistingAccount) this.authService.logout(false);
    this.router.navigateByUrl(this.redirectTo);
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
