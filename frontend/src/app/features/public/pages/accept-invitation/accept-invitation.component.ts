import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { timeout, catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';
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
    const pwValid = this.details?.hasExistingAccount ? true : this.form.password.trim().length >= 6;
    return !!(this.form.name.trim() && this.form.phoneNumber.trim() && pwValid);
  }

  submit(): void {
    if (!this.isFormValid || this.processing) return;

    this.processing = true;
    this.error = '';

    this.http
      .post<any>(
        `${this.apiBase}/auth/accept-invite`,
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

        this.redirectTo = res?.redirectTo || '/app/recruiter';
        this.accepted = true;
        this.cdr.markForCheck();
        setTimeout(() => this.goToDashboard(), 800);
      });
  }

  goToDashboard(): void {
    this.router.navigateByUrl(this.redirectTo);
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
