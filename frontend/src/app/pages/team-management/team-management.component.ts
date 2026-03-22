import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';
import { TenantContextService } from '../../shared/services/tenant-context.service';

type TeamRole = 'admin' | 'manager' | 'member';

interface OrganizationItem {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  myRole: TeamRole;
}

interface TeamItem {
  _id: string;
  name: string;
  slug: string;
  description?: string;
}

interface OrganizationMemberItem {
  user: {
    _id: string;
    name: string;
    email: string;
    githubUsername?: string;
  };
  orgRole: TeamRole;
  organizationMembershipId?: string | null;
  memberships: Array<{
    membershipId: string;
    teamId: string;
    teamName: string;
    role: TeamRole;
  }>;
}

interface TeamMemberItem {
  _id: string;
  role: TeamRole;
  userId: {
    _id: string;
    name: string;
    email: string;
    githubUsername?: string;
  };
}

@Component({
  selector: 'app-team-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './team-management.component.html',
  styleUrl: './team-management.component.scss'
})
export class TeamManagementComponent implements OnInit {
  readonly roleOptions: TeamRole[] = ['admin', 'manager', 'member'];

  organizations: OrganizationItem[] = [];
  teams: TeamItem[] = [];
  members: OrganizationMemberItem[] = [];
  teamMembers: TeamMemberItem[] = [];
  invitations: Array<{ _id: string; email: string; role: TeamRole; status: string; expiresAt: string; token?: string; invitationLink?: string }> = [];

  invitationLink = ''; // shown when no email provider is configured

  selectedOrganizationId = '';
  selectedTeamId = '';

  orgForm = {
    name: '',
    description: ''
  };

  teamForm = {
    name: '',
    description: ''
  };

  inviteForm: { email: string; role: TeamRole } = {
    email: '',
    role: 'member'
  };

  teamDashboardMembers: Array<{
    user: { _id: string; name: string; email: string; githubUsername?: string };
    role: TeamRole;
    githubScore: number;
    readinessScore: number;
    repositories: number;
    stars: number;
    forks: number;
  }> = [];

  teamAnalytics: {
    totalMembers: number;
    averageReadinessScore: number;
    totals: { repositories: number; stars: number; forks: number };
    roleDistribution: { admin: number; manager: number; member: number };
  } | null = null;

  loading = false;
  status = '';

  constructor(
    private readonly apiService: ApiService,
    private readonly tenantContext: TenantContextService
  ) {}

  ngOnInit(): void {
    this.loadOrganizations();
  }

  get selectedOrganization(): OrganizationItem | null {
    return this.organizations.find((org) => org._id === this.selectedOrganizationId) || null;
  }

  get currentOrgRole(): TeamRole | '' {
    return this.selectedOrganization?.myRole || '';
  }

  get canCreateTeam(): boolean {
    return this.currentOrgRole === 'admin' || this.currentOrgRole === 'manager';
  }

  get canInvite(): boolean {
    return this.currentOrgRole === 'admin' || this.currentOrgRole === 'manager';
  }

  canAssignRole(role: TeamRole): boolean {
    if (this.currentOrgRole === 'admin') return true;
    if (this.currentOrgRole === 'manager') return role === 'member';
    return false;
  }

  loadOrganizations(): void {
    this.loading = true;
    this.apiService.getOrganizations().subscribe({
      next: (res) => {
        this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
        if (this.organizations.length === 0) {
          this.status = 'No organizations found. Create an organization first.';
          this.selectedOrganizationId = '';
          this.tenantContext.clearAll();
          this.teams = [];
          this.members = [];
          this.invitations = [];
          this.teamMembers = [];
          this.teamDashboardMembers = [];
          this.teamAnalytics = null;
        } else if (!this.selectedOrganizationId) {
          // Auto-select first org on initial load
          this.selectedOrganizationId = this.organizations[0]._id;
          this.onOrganizationChange();
        } else {
          // Preserve existing selection after a reload (e.g. after creating org/team)
          const stillExists = this.organizations.some(o => o._id === this.selectedOrganizationId);
          if (!stillExists) {
            this.selectedOrganizationId = this.organizations[0]._id;
            this.onOrganizationChange();
          }
        }
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.status = error?.error?.message || 'Failed to load organizations.';
      }
    });
  }

  selectOrganization(organizationId: string): void {
    this.selectedOrganizationId = organizationId;
    this.onOrganizationChange();
  }

  createOrganization(): void {
    const name = this.orgForm.name.trim();
    if (!name) {
      this.status = 'Organization name is required.';
      return;
    }

    this.apiService.createOrganization({ name, description: this.orgForm.description.trim() }).subscribe({
      next: () => {
        this.status = 'Organization created successfully.';
        this.orgForm = { name: '', description: '' };
        this.loadOrganizations();
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to create organization.';
      }
    });
  }

  onOrganizationChange(): void {
    if (!this.selectedOrganizationId) {
      this.tenantContext.clearAll();
      this.selectedTeamId = '';
      this.teams = [];
      this.members = [];
      this.invitations = [];
      this.teamMembers = [];
      this.teamDashboardMembers = [];
      this.teamAnalytics = null;
      return;
    }
    const selectedOrg = this.selectedOrganization;
    if (selectedOrg) {
      this.tenantContext.setOrganization({
        id: selectedOrg._id,
        name: selectedOrg.name,
        myRole: selectedOrg.myRole
      });
    }

    this.selectedTeamId = '';
    this.teamMembers = [];
    this.teamDashboardMembers = [];
    this.teamAnalytics = null;
    this.loadTeams();
    this.loadOrganizationMembers();
    this.loadInvitations();
  }

  loadTeams(): void {
    this.apiService.getTeams(this.selectedOrganizationId).subscribe({
      next: (res) => {
        this.teams = Array.isArray(res?.teams) ? res.teams : [];
        const savedTeamId = this.tenantContext.snapshot.teamId;
        if (savedTeamId && this.teams.some((team) => team._id === savedTeamId)) {
          this.selectedTeamId = savedTeamId;
          this.onTeamChange();
        }
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to load teams.';
      }
    });
  }

  createTeam(): void {
    if (!this.canCreateTeam) {
      this.status = 'Only admin or manager can create teams.';
      return;
    }

    const name = this.teamForm.name.trim();
    if (!this.selectedOrganizationId) {
      this.status = 'Select an organization first.';
      return;
    }
    if (!name) {
      this.status = 'Team name is required.';
      return;
    }

    this.apiService.createTeam(this.selectedOrganizationId, {
      name,
      description: this.teamForm.description.trim()
    }).subscribe({
      next: () => {
        this.status = 'Team created successfully.';
        this.teamForm = { name: '', description: '' };
        this.loadTeams();
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to create team.';
      }
    });
  }

  loadOrganizationMembers(): void {
    if (!this.selectedOrganizationId) return;

    this.apiService.getOrganizationMembers(this.selectedOrganizationId).subscribe({
      next: (res) => {
        this.members = Array.isArray(res?.members) ? res.members : [];
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to load members.';
      }
    });
  }

  inviteMember(): void {
    if (!this.canInvite) {
      this.status = 'Only admin or manager can invite members.';
      return;
    }

    const email = this.inviteForm.email.trim();
    if (!this.selectedOrganizationId) {
      this.status = 'Select an organization first.';
      return;
    }
    if (!email) {
      this.status = 'Email is required for invitations.';
      return;
    }

    this.apiService.inviteUser(this.selectedOrganizationId, {
      email,
      role: this.inviteForm.role,
      teamId: this.selectedTeamId || undefined
    }).subscribe({
      next: (res) => {
        const emailDelivery = res?.emailDelivery;
        if (emailDelivery?.sent) {
          this.status = String(res?.message || 'Invitation email sent successfully.');
          this.invitationLink = '';
        } else if (res?.invitationLink) {
          // No email provider — show the link for manual sharing
          this.invitationLink = res.invitationLink;
          this.status = 'Invitation created. No email provider configured — share the link below with the invitee.';
        } else {
          const reason = emailDelivery?.reason ? ` Reason: ${emailDelivery.reason}` : '';
          this.status = `Invitation was created but email was not delivered.${reason}`;
          this.invitationLink = '';
        }
        this.inviteForm.email = '';
        this.loadInvitations();
      },
      error: (error) => {
        this.status = String(error?.error?.message || 'Failed to invite member.');
        this.invitationLink = '';
      }
    });
  }

  loadInvitations(): void {
    if (!this.selectedOrganizationId) return;

    this.apiService.getInvitations(this.selectedOrganizationId).subscribe({
      next: (res) => {
        this.invitations = Array.isArray(res?.invitations) ? res.invitations : [];
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to load invitations.';
      }
    });
  }

  revokeInvitation(invitationId: string): void {
    if (!this.selectedOrganizationId) {
      this.status = 'Select an organization first.';
      return;
    }

    this.invitations = this.invitations.filter((invitation) => invitation._id !== invitationId);

    this.apiService.revokeInvitation(this.selectedOrganizationId, invitationId).subscribe({
      next: (res) => {
        this.status = String(res?.message || 'Invitation deleted successfully.');
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to revoke invitation.';
        this.loadInvitations();
      }
    });
  }

  onTeamChange(): void {
    if (!this.selectedTeamId) {
      this.tenantContext.clearTeam();
      this.teamMembers = [];
      this.teamDashboardMembers = [];
      this.teamAnalytics = null;
      return;
    }

    const team = this.teams.find((item) => item._id === this.selectedTeamId);
    if (team) {
      this.tenantContext.setTeam({ id: team._id, name: team.name });
    }

    this.apiService.getTeamMembers(this.selectedTeamId).subscribe({
      next: (res) => {
        this.teamMembers = Array.isArray(res?.members) ? res.members : [];
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to load team members.';
      }
    });

    this.apiService.getTeamSharedDashboard(this.selectedTeamId).subscribe({
      next: (res) => {
        this.teamDashboardMembers = Array.isArray(res?.members) ? res.members : [];
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to load team dashboard.';
      }
    });

    this.apiService.getTeamAnalytics(this.selectedTeamId).subscribe({
      next: (res) => {
        this.teamAnalytics = res || null;
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to load team analytics.';
      }
    });
  }

  updateOrgRole(member: OrganizationMemberItem, role: TeamRole): void {
    if (!this.canAssignRole(role)) {
      this.status = `Your role (${this.currentOrgRole || 'member'}) cannot assign ${role}.`;
      return;
    }

    const membershipId = member.organizationMembershipId;
    if (!membershipId) {
      this.status = 'No organization membership found for this user.';
      return;
    }

    this.apiService.updateMembershipRole(membershipId, role).subscribe({
      next: () => {
        this.status = 'Organization role updated.';
        this.loadOrganizationMembers();
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to update role.';
      }
    });
  }

  updateTeamRole(membershipId: string, role: TeamRole): void {
    if (!this.canAssignRole(role)) {
      this.status = `Your role (${this.currentOrgRole || 'member'}) cannot assign ${role}.`;
      return;
    }

    this.apiService.updateMembershipRole(membershipId, role).subscribe({
      next: () => {
        this.status = 'Team role updated.';
        this.onTeamChange();
      },
      error: (error) => {
        this.status = error?.error?.message || 'Failed to update role.';
      }
    });
  }

  copyInviteLink(): void {
    navigator.clipboard.writeText(this.invitationLink).then(() => {
      this.status = 'Invitation link copied to clipboard!';
    });
  }

  roleBadgeClass(role: TeamRole | ''): string {
    if (role === 'admin') return 'badge-admin';
    if (role === 'manager') return 'badge-manager';
    return 'badge-member';
  }
}
