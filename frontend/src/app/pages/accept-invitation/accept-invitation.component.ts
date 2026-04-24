import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';
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
  token = '';
  loading = true;
  accepted = false;
  error = '';
  processing = false;

  details: {
    name?: string;
    email: string;
    role: string;
    organizationName: string;
    hasExistingAccount: boolean;
    alreadyInAnotherOrganization?: boolean;
  } | null = null;

  form = {
    name: '',
    githubUsername: '',
    linkedin: '',
    phoneNumber: '',
    countryCode: '+92',
    password: ''
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly apiService: ApiService,
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

    this.apiService.getAuthInviteDetails(this.token).subscribe({
      next: (res) => {
        this.details = res?.invitation || null;
        this.form.name = this.details?.name || '';
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'This invitation link is invalid or has expired.';
      }
    });
  }

  get isFormDisabled(): boolean {
    return this.processing;
  }

  completeOnboarding(): void {
    if (!this.form.name.trim()) {
      this.error = 'Full name is required.';
      return;
    }
    if (!this.details?.hasExistingAccount && this.form.password.trim().length < 6) {
      this.error = 'Password must be at least 6 characters.';
      return;
    }

    this.processing = true;
    this.error = '';

    this.apiService.acceptAuthInvite({
      token: this.token,
      name: this.form.name.trim(),
      password: this.form.password || undefined,
      githubUsername: this.form.githubUsername.trim() || undefined,
      linkedin: this.form.linkedin.trim() || undefined,
      phoneNumber: this.form.phoneNumber.trim() || undefined,
      countryCode: this.form.countryCode.trim() || undefined
    }).subscribe({
      next: (res) => {
        this.processing = false;

        // Set org context so login guard works correctly after redirect
        const organizationId = String(res?.user?.organizationId || res?.organizationId || '');
        if (organizationId) {
          this.tenantContext.setOrganization({
            id: organizationId,
            name: this.details?.organizationName || '',
            myRole: 'recruiter'
          });
        }

        // Account created — redirect to login so recruiter authenticates properly
        this.accepted = true;
      },
      error: (err) => {
        this.processing = false;
        this.error = err?.error?.message || 'Failed to complete setup. Please try again.';
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  // Legacy tenant flow — kept for backward compat but not used for recruiter invites
  goToTeamManagement(): void {
    this.router.navigate(['/app/settings/user-management']);
  }
}
