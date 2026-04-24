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
  needsOnboarding = false;
  processing = false;
  flow: 'auth-recruiter' | 'tenant' = 'auth-recruiter';
  details: {
    name?: string;
    email: string;
    role: string;
    organizationName: string;
    teamName?: string;
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
        this.flow = 'auth-recruiter';
        this.details = res?.invitation || null;
        this.form.name = this.details?.name || '';
        this.form.githubUsername = String(this.details?.email || '').split('@')[0] || '';
        this.loading = false;
        this.needsOnboarding = true;
      },
      error: () => {
        this.flow = 'tenant';
        this.loadTenantInvitationFlow();
      }
    });
  }

  private loadTenantInvitationFlow(): void {
    this.apiService.getInvitationDetailsByToken(this.token).subscribe({
      next: (res) => {
        this.details = res?.invitation || null;
        this.form.githubUsername = String(this.details?.email || '').split('@')[0] || '';
        this.tryCompleteTenantInvitation();
      },
      error: (error) => {
        this.loading = false;
        this.error = error?.error?.message || 'Failed to load invitation details.';
      }
    });
  }

  private tryCompleteTenantInvitation(): void {
    if (!this.token) {
      this.loading = false;
      this.error = 'Invitation token is missing.';
      return;
    }

    if (!this.authService.isLoggedIn()) {
      this.loading = false;
      this.needsOnboarding = true;
      return;
    }

    this.apiService.acceptInvitationByToken(this.token).subscribe({
      next: (res) => {
        this.accepted = true;
        this.loading = false;

        const organizationId = String(res?.organizationId || '');
        const teamId = String(res?.teamId || '');

        if (organizationId) {
          this.tenantContext.setOrganization({
            id: organizationId,
            name: '',
            myRole: 'recruiter'
          });
        }
        if (teamId) {
          this.tenantContext.setTeam({ id: teamId, name: '' });
        }
      },
      error: (error) => {
        this.loading = false;
        if (error?.status === 403) {
          this.needsOnboarding = true;
          this.error = '';
          return;
        }
        this.error = error?.error?.message || 'Failed to accept invitation.';
      }
    });
  }

  completeOnboarding(): void {
    if (!this.token) return;

    if (this.flow === 'auth-recruiter') {
      this.completeAuthInviteOnboarding();
      return;
    }

    if (!this.form.name.trim() || !this.form.password.trim()) {
      this.error = 'Name and password are required.';
      return;
    }

    this.processing = true;
    this.error = '';
    this.apiService.acceptInvitationOnboard(this.token, {
      name: this.form.name.trim(),
      password: this.form.password,
      githubUsername: this.form.githubUsername.trim() || undefined
    }).subscribe({
      next: (res) => {
        this.processing = false;
        const user = res?.user;
        if (user?.token) {
          this.authService.completeExternalLogin(user);
        }

        const organizationId = String(res?.organizationId || '');
        const teamId = String(res?.teamId || '');
        if (organizationId) {
          this.tenantContext.setOrganization({
            id: organizationId,
            name: '',
            myRole: 'member'
          });
        }
        if (teamId) {
          this.tenantContext.setTeam({ id: teamId, name: '' });
        }

        this.accepted = true;
        this.needsOnboarding = false;
      },
      error: (error) => {
        this.processing = false;
        this.error = error?.error?.message || 'Failed to complete onboarding.';
      }
    });
  }

  private completeAuthInviteOnboarding(): void {
    if (!this.form.name.trim()) {
      this.error = 'Name is required.';
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
        if (res?.user?.token) {
          this.authService.completeExternalLogin(res.user);
        }

        const organizationId = String(res?.user?.organizationId || res?.organizationId || '');
        if (organizationId) {
          this.tenantContext.setOrganization({
            id: organizationId,
            name: this.details?.organizationName || '',
            myRole: 'recruiter'
          });
        }

        this.accepted = true;
        this.needsOnboarding = false;

        const redirectTo = String(res?.redirectTo || '/app/profile?onboarding=recruiter');
        this.router.navigateByUrl(redirectTo);
      },
      error: (error) => {
        this.processing = false;
        this.error = error?.error?.message || 'Failed to complete recruiter onboarding.';
      }
    });
  }

  goToTeamManagement(): void {
    this.router.navigate(['/app/settings/user-management']);
  }
}
