import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AdminHiringService, AdminRecruiter, AdminTeamOption, PendingInvitation } from '../../services/admin-hiring.service';
import { SharedLoaderComponent } from '../../../shared/components/loader/loader.component';
import { SharedMessageComponent } from '../../../shared/components/message/message.component';
import { SharedEmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { RecruiterSharedModule } from '../../../supervisors/recruiter-shared/recruiter-shared.module';

@Component({
  selector: 'app-admin-recruiters-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SharedLoaderComponent, SharedMessageComponent, SharedEmptyStateComponent, RecruiterSharedModule],
  templateUrl: './admin-recruiters.component.html',
  styleUrls: ['./admin-recruiters.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminRecruitersPageComponent implements OnInit {
  loading = false;
  directLoading = false;
  message = '';
  messageType: 'success' | 'error' | 'warning' = 'success';
  recruiters: AdminRecruiter[] = [];
  pendingInvitations: PendingInvitation[] = [];
  teams: AdminTeamOption[] = [];
  organizationId = '';
  editingRecruiterId = '';
  searchTerm = '';
  teamFilter = '';
  statusFilter: 'all' | 'active' | 'inactive' | 'profile-complete' | 'profile-pending' = 'all';

  visibleRecruiters: AdminRecruiter[] = [];
  visibleInvitations: PendingInvitation[] = [];
  invitationExpired: Record<string, boolean> = {};
  activeCount = 0;
  inactiveCount = 0;
  profilePendingCount = 0;

  // ── Confirm dialog state ────────────────────────────────────────────────
  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmText = 'Delete';
  private pendingConfirmAction: (() => void) | null = null;

  form = {
    name: '',
    email: ''
  };

  directForm = {
    name: '',
    email: '',
    password: '',
    teamId: ''
  };

  editForm = {
    name: '',
    email: '',
    githubUsername: '',
    linkedin: '',
    phoneNumber: ''
  };

  constructor(
    private readonly adminService: AdminHiringService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadContext();
    this.loadAll();
  }

  loadContext(): void {
    this.adminService.getOverview().subscribe({
      next: (overview) => {
        this.organizationId = overview.organizationId || '';
        if (this.organizationId) {
          this.loadTeams();
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.organizationId = '';
        this.teams = [];
        this.cdr.markForCheck();
      }
    });
  }

  loadTeams(): void {
    if (!this.organizationId) {
      this.teams = [];
      this.cdr.markForCheck();
      return;
    }

    this.adminService.getTeams(this.organizationId).subscribe({
      next: (teams) => {
        this.teams = teams;
        this.cdr.markForCheck();
      },
      error: () => {
        this.teams = [];
        this.cdr.markForCheck();
      }
    });
  }

  loadAll(): void {
    this.loading = true;
    let done = 0;
    const finish = () => {
      if (++done === 2) {
        this.loading = false;
        this.recomputeViews();
        this.cdr.markForCheck();
      }
    };

    this.adminService.getRecruiters().subscribe({
      next: (recruiters) => {
        this.recruiters = recruiters;
        this.updateCounts();
        finish();
      },
      error: () => {
        this.messageType = 'error';
        this.message = 'Failed to load recruiters.';
        this.recruiters = [];
        this.updateCounts();
        finish();
      }
    });

    this.adminService.getPendingInvitations().subscribe({
      next: (invitations) => {
        this.pendingInvitations = invitations;
        this.updateInvitationExpiry();
        finish();
      },
      error: () => { finish(); }
    });
  }

  loadRecruiters(): void {
    this.loadAll();
  }

  onSearchTermChange(value: string): void {
    this.searchTerm = value;
    this.recomputeViews();
    this.cdr.markForCheck();
  }

  onTeamFilterChange(value: string): void {
    this.teamFilter = value;
    this.recomputeViews();
    this.cdr.markForCheck();
  }

  onStatusFilterChange(value: 'all' | 'active' | 'inactive' | 'profile-complete' | 'profile-pending'): void {
    this.statusFilter = value;
    this.recomputeViews();
    this.cdr.markForCheck();
  }

  private recomputeViews(): void {
    const term = this.searchTerm.trim().toLowerCase();

    this.visibleRecruiters = this.recruiters.filter((recruiter) => {
      const teamNames = (recruiter.teams || []).map((team) => team.name.toLowerCase());
      const matchesSearch = !term || [
        recruiter.name,
        recruiter.email,
        recruiter.githubUsername,
        recruiter.linkedin,
        recruiter.phoneNumber,
        ...teamNames
      ].some((value) => String(value || '').toLowerCase().includes(term));

      const matchesTeam = !this.teamFilter || (recruiter.teams || []).some((team) => String(team._id) === this.teamFilter);

      const matchesStatus = (() => {
        switch (this.statusFilter) {
          case 'active': return recruiter.isActive;
          case 'inactive': return !recruiter.isActive;
          case 'profile-complete': return recruiter.profileCompleted;
          case 'profile-pending': return !recruiter.profileCompleted;
          default: return true;
        }
      })();

      return matchesSearch && matchesTeam && matchesStatus;
    });

    this.visibleInvitations = this.pendingInvitations.filter((inv) => {
      if (!term) return true;
      return [inv.name, inv.email, inv.role, inv.status].some((value) => String(value || '').toLowerCase().includes(term));
    });
  }

  private updateInvitationExpiry(): void {
    const now = Date.now();
    const expired: Record<string, boolean> = {};
    for (const inv of this.pendingInvitations) {
      expired[inv._id] = new Date(inv.expiresAt).getTime() < now;
    }
    this.invitationExpired = expired;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.teamFilter = '';
    this.statusFilter = 'all';
    this.recomputeViews();
    this.cdr.markForCheck();
  }

  trackByRecruiterId(_: number, recruiter: AdminRecruiter): string {
    return recruiter._id;
  }

  teamLabel(recruiter: AdminRecruiter): string {
    return (recruiter.teams || []).map((team) => team.name).join(', ') || 'Organization only';
  }

  inviteRecruiter(): void {
    if (!this.form.name || !this.form.email) {
      this.messageType = 'warning';
      this.message = 'Name and email are required.';
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.adminService.inviteRecruiter({
      name: this.form.name,
      email: this.form.email,
      role: 'recruiter'
    }).subscribe({
      next: (result) => {
        this.form = { name: '', email: '' };
        this.messageType = 'success';
        this.message = result.emailSent
          ? 'Recruiter invitation sent successfully.'
          : `Invitation created. Share this link manually: ${result.invitationLink}`;
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to invite recruiter.');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  addRecruiterDirect(): void {
    if (!this.directForm.name || !this.directForm.email || !this.directForm.password) {
      this.messageType = 'warning';
      this.message = 'Name, email, and password are required for direct creation.';
      this.cdr.markForCheck();
      return;
    }

    if (!this.organizationId) {
      this.messageType = 'error';
      this.message = 'Organization context is not available.';
      this.cdr.markForCheck();
      return;
    }

    this.directLoading = true;
    this.adminService.createRecruiterDirect({
      name: this.directForm.name,
      email: this.directForm.email,
      password: this.directForm.password,
      teamId: this.directForm.teamId || undefined
    }).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = 'Recruiter added successfully without invitation.';
        this.directForm = { name: '', email: '', password: '', teamId: '' };
        this.directLoading = false;
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to add recruiter directly.');
        this.directLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  startEdit(recruiter: AdminRecruiter): void {
    this.editingRecruiterId = recruiter._id;
    this.editForm = {
      name: recruiter.name || '',
      email: recruiter.email || '',
      githubUsername: recruiter.githubUsername || '',
      linkedin: recruiter.linkedin || '',
      phoneNumber: recruiter.phoneNumber || ''
    };
  }

  cancelEdit(): void {
    this.editingRecruiterId = '';
    this.editForm = {
      name: '',
      email: '',
      githubUsername: '',
      linkedin: '',
      phoneNumber: ''
    };
  }

  saveRecruiter(recruiterId: string): void {
    if (!this.editForm.name || !this.editForm.email) {
      this.messageType = 'warning';
      this.message = 'Name and email are required.';
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.adminService.updateRecruiter(recruiterId, {
      name: this.editForm.name,
      email: this.editForm.email,
      githubUsername: this.editForm.githubUsername,
      linkedin: this.editForm.linkedin,
      phoneNumber: this.editForm.phoneNumber
    }).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = 'Recruiter updated successfully.';
        this.cancelEdit();
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to update recruiter.');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  toggleActive(recruiter: AdminRecruiter): void {
    this.loading = true;
    this.adminService.setRecruiterActive(recruiter._id, !recruiter.isActive).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = recruiter.isActive ? 'Recruiter deactivated.' : 'Recruiter activated.';
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to update recruiter status.');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  revokeAccess(recruiter: AdminRecruiter): void {
    this.loading = true;
    this.adminService.revokeRecruiterAccess(recruiter._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = 'Recruiter access revoked.';
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to revoke recruiter access.');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  deleteRecruiter(recruiter: AdminRecruiter): void {
    this.openConfirm(
      'Delete Recruiter',
      `Delete recruiter ${recruiter.name}? This cannot be undone.`,
      () => {
        this.loading = true;
        this.adminService.deleteRecruiter(recruiter._id).subscribe({
          next: () => {
            this.messageType = 'success';
            this.message = 'Recruiter deleted successfully.';
            this.loadAll();
          },
          error: (err) => {
            this.messageType = 'error';
            this.message = String(err?.error?.message || 'Failed to delete recruiter.');
            this.loading = false;
            this.cdr.markForCheck();
          }
        });
      }
    );
  }

  // ── Pending invitation actions ──────────────────────────────────────────

  revokeInvitation(inv: PendingInvitation): void {
    this.loading = true;
    this.adminService.revokeInvitation(inv._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = `Invitation for ${inv.email} revoked.`;
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to revoke invitation.');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  expireInvitation(inv: PendingInvitation): void {
    this.loading = true;
    this.adminService.expireInvitation(inv._id).subscribe({
      next: () => {
        this.messageType = 'success';
        this.message = `Invitation for ${inv.email} expired.`;
        this.loadAll();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to expire invitation.');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  deleteInvitation(inv: PendingInvitation): void {
    this.openConfirm(
      'Delete Invitation',
      `Delete invitation for ${inv.email}? This cannot be undone.`,
      () => {
        this.loading = true;
        this.adminService.deleteInvitation(inv._id).subscribe({
          next: () => {
            this.messageType = 'success';
            this.message = `Invitation for ${inv.email} deleted.`;
            this.loadAll();
          },
          error: (err) => {
            this.messageType = 'error';
            this.message = String(err?.error?.message || 'Failed to delete invitation.');
            this.loading = false;
            this.cdr.markForCheck();
          }
        });
      }
    );
  }

  trackByInvitationId(_: number, inv: PendingInvitation): string {
    return inv._id;
  }

  private updateCounts(): void {
    let active = 0;
    let inactive = 0;
    let profilePending = 0;

    for (const recruiter of this.recruiters) {
      if (recruiter.isActive) active += 1;
      else inactive += 1;
      if (!recruiter.profileCompleted) profilePending += 1;
    }

    this.activeCount = active;
    this.inactiveCount = inactive;
    this.profilePendingCount = profilePending;
  }

  // ── Confirm dialog helpers ──────────────────────────────────────────────

  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.pendingConfirmAction = action;
    this.confirmOpen = true;
    this.cdr.markForCheck();
  }

  onConfirmed(): void {
    this.confirmOpen = false;
    if (this.pendingConfirmAction) {
      this.pendingConfirmAction();
      this.pendingConfirmAction = null;
    }
    this.cdr.markForCheck();
  }

  onCancelled(): void {
    this.confirmOpen = false;
    this.pendingConfirmAction = null;
    this.cdr.markForCheck();
  }
}
