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
  details: {
    email: string;
    role: string;
    organizationName: string;
    teamName: string;
    hasExistingAccount: boolean;
  } | null = null;
  form = {
    name: '',
    githubUsername: '',
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

    this.apiService.getInvitationDetailsByToken(this.token).subscribe({
      next: (res) => {
        this.details = res?.invitation || null;
        this.form.githubUsername = String(this.details?.email || '').split('@')[0] || '';
        this.tryCompleteInvitation();
      },
      error: (error) => {
        this.loading = false;
        this.error = error?.error?.message || 'Failed to load invitation details.';
      }
    });
  }

  private tryCompleteInvitation(): void {
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
            myRole: 'member'
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

  goToTeamManagement(): void {
    this.router.navigate(['/app/settings/user-management']);
  }
}
