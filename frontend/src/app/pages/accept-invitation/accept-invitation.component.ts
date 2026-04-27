import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { TenantContextService } from '../../shared/services/tenant-context.service';
import { AuthService } from '../../shared/services/auth.service';

@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './accept-invitation.component.html',
  styleUrl: './accept-invitation.component.scss'
})
export class AcceptInvitationComponent implements OnInit {
  private readonly apiBase = 'http://localhost:5000/api';

  token = '';
  loading = true;
  accepted = false;
  error = '';
  processing = false;
  redirectTo = '/app/recruiter/dashboard';

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
    countryCode: '+92'
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly http: HttpClient,
    private readonly tenantContext: TenantContextService,
    private readonly authService: AuthService
  ) {}

  ngOnInit(): void {
    this.token = String(this.route.snapshot.paramMap.get('token') || '').trim();

    if (!this.token) {
      this.loading = false;
      this.error = 'Invitation token is missing.';
      return;
    }

    this.http
      .get<any>(`${this.apiBase}/auth/invite-details/${encodeURIComponent(this.token)}`, {
        headers: { 'X-Skip-Auth': '1' }
      })
      .pipe(
        timeout(10000),
        catchError((err) => {
          const msg = err?.error?.message
            || (err?.name === 'TimeoutError' ? 'Request timed out. Please check your connection.' : null)
            || 'This invitation link is invalid or has expired.';
          return of({ __error: msg });
        })
      )
      .subscribe((res: any) => {
        this.loading = false;
        if (res?.__error) {
          this.error = res.__error;
          return;
        }
        this.details = res?.invitation ?? null;
        if (!this.details) {
          this.error = 'Invitation details could not be loaded.';
          return;
        }
        this.form.name = this.details.name || '';
      });
  }

  get isFormValid(): boolean {
    const pwValid = this.details?.hasExistingAccount
      ? true
      : this.form.password.trim().length >= 6;
    return !!(this.form.name.trim() && this.form.phoneNumber.trim() && pwValid);
  }

  submit(): void {
    if (!this.isFormValid || this.processing) return;

    this.processing = true;
    this.error = '';

    this.http
      .post<any>(`${this.apiBase}/auth/accept-invite`, {
        token: this.token,
        name: this.form.name.trim(),
        phoneNumber: this.form.phoneNumber.trim(),
        password: this.form.password || undefined,
        githubUsername: this.form.githubUsername.trim() || undefined,
        linkedin: this.form.linkedin.trim() || undefined,
        countryCode: this.form.countryCode || undefined
      }, { headers: { 'X-Skip-Auth': '1' } })
      .pipe(
        timeout(15000),
        catchError((err) => {
          const msg = err?.error?.message
            || (err?.name === 'TimeoutError' ? 'Request timed out. Please try again.' : null)
            || 'Failed to complete setup. Please try again.';
          return of({ __error: msg });
        })
      )
      .subscribe((res: any) => {
        this.processing = false;
        if (res?.__error) {
          this.error = res.__error;
          return;
        }

        const user = res?.user;
        const orgId = String(user?.organizationId || '');
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(orgId);

        // Store the session so the user is immediately logged in
        if (user?.token) {
          localStorage.setItem('token', user.token);
          localStorage.setItem('user', JSON.stringify(user));
          localStorage.setItem('loginExpiry', String(Date.now() + 20 * 60 * 60 * 1000));

          if (isValidObjectId) {
            this.tenantContext.setOrganization({
              id: orgId,
              name: this.details?.organizationName || '',
              myRole: 'recruiter'
            });
          }
        }

        this.redirectTo = res?.redirectTo || '/app/recruiter/dashboard';
        this.accepted = true;
      });
  }

  goToDashboard(): void {
    this.router.navigate([this.redirectTo]);
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
