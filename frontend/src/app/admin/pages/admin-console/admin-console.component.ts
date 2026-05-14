import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import {
  AdminConsoleService,
  ConsoleOverview,
  ConsoleAnalytics,
  ConsoleTeam,
  ActivityLog,
  ConsolePreferences
} from './admin-console.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import { ApiService } from '../../../shared/services/api.service';
import { AdminHiringService, AdminRecruiter, AdminTeamOption, PendingInvitation } from '../../services/admin-hiring.service';

type Tab = 'overview' | 'teams' | 'recruiters' | 'invitations' | 'analytics' | 'activity' | 'preferences';

@Component({
  selector: 'app-admin-console-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-console.component.html',
  styleUrl: './admin-console.component.scss'
})
export class AdminConsolePageComponent implements OnInit {
  activeTab: Tab = 'overview';

  // ── Loading / error ───────────────────────────────────────────────────
  loading = false;
  error = '';
  successMsg = '';

  // ── Overview ──────────────────────────────────────────────────────────
  overview: ConsoleOverview | null = null;

  // ── Analytics ─────────────────────────────────────────────────────────
  analytics: ConsoleAnalytics | null = null;

  // ── Teams ─────────────────────────────────────────────────────────────
  teams: ConsoleTeam[] = [];
  teamOptions: AdminTeamOption[] = [];
  expandedTeamId = '';
  editingTeamId = '';
  teamForm = {
    name: '',
    slug: '',
    description: '',
    recruiterId: ''
  };
  teamEditForm = {
    name: '',
    slug: '',
    description: ''
  };
  teamRecruiterSelections: Record<string, string> = {};

  // ── Recruiters ────────────────────────────────────────────────────────
  recruiters: AdminRecruiter[] = [];
  editingRecruiterId = '';
  inviteForm = { name: '', email: '', teamId: '' };
  editForm = { name: '', email: '', githubUsername: '', linkedin: '', phoneNumber: '' };
  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  private pendingConfirmAction: (() => void) | null = null;

  // ── Invitations ───────────────────────────────────────────────────────
  pendingInvitations: PendingInvitation[] = [];

  // ── Activity ──────────────────────────────────────────────────────────
  activityLogs: ActivityLog[] = [];
  activityPage = 1;
  activityTotalPages = 1;
  activityTotal = 0;

  // ── Preferences ───────────────────────────────────────────────────────
  preferences: ConsolePreferences | null = null;
  prefForm = { name: '', description: '' };

  // ── Org context ───────────────────────────────────────────────────────
  organizationId = '';
  orgName = '';

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly consoleService: AdminConsoleService,
    private readonly adminService: AdminHiringService,
    private readonly tenantContext: TenantContextService,
    private readonly apiService: ApiService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.tenantContext.state$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ctx) => {
      this.organizationId = ctx.organizationId || '';
      this.orgName = ctx.organizationName || 'Organization';
      this.loadTeamOptions();
    });

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const tab = params['tab'] as Tab;
      if (tab && this.isValidTab(tab)) {
        this.activeTab = tab;
      }
      this.loadActiveTab();
    });
  }

  setTab(tab: Tab): void {
    this.activeTab = tab;
    this.error = '';
    this.successMsg = '';
    this.router.navigate([], { queryParams: { tab }, replaceUrl: true });
    this.loadActiveTab();
  }

  private isValidTab(tab: string): tab is Tab {
    return ['overview', 'teams', 'recruiters', 'invitations', 'analytics', 'activity', 'preferences'].includes(tab);
  }

  private loadActiveTab(): void {
    switch (this.activeTab) {
      case 'overview':    this.loadOverview(); break;
      case 'teams':       this.loadTeams(); break;
      case 'recruiters':  this.loadRecruiters(); break;
      case 'invitations': this.loadInvitations(); break;
      case 'analytics':   this.loadAnalytics(); break;
      case 'activity':    this.loadActivity(1); break;
      case 'preferences': this.loadPreferences(); break;
    }
  }

  // ── Overview ──────────────────────────────────────────────────────────
  loadOverview(): void {
    this.loading = true;
    this.consoleService.getOverview().pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (data) => { this.overview = data; },
      error: (err) => { this.error = err?.error?.message || 'Failed to load overview.'; }
    });
  }

  // ── Teams ─────────────────────────────────────────────────────────────
  loadTeams(): void {
    this.loading = true;
    let done = 0;
    const finish = () => { if (++done === 3) { this.loading = false; this.cdr.detectChanges(); } };

    this.consoleService.getTeams().subscribe({
      next: (res) => { this.teams = res.teams || []; finish(); },
      error: (err) => { this.error = err?.error?.message || 'Failed to load teams.'; finish(); }
    });

    this.adminService.getRecruiters().subscribe({
      next: (recruiters) => { this.recruiters = recruiters; finish(); },
      error: () => { finish(); }
    });

    this.loadTeamOptions(() => finish());
  }

  toggleTeam(teamId: string): void {
    this.expandedTeamId = this.expandedTeamId === teamId ? '' : teamId;
  }

  // ── Recruiters ────────────────────────────────────────────────────────
  loadRecruiters(): void {
    this.loading = true;
    let done = 0;
    const finish = () => { if (++done === 2) { this.loading = false; this.cdr.detectChanges(); } };

    this.adminService.getRecruiters().subscribe({
      next: (r) => { this.recruiters = r; finish(); },
      error: () => { this.error = 'Failed to load recruiters.'; finish(); }
    });
    this.adminService.getPendingInvitations().subscribe({
      next: (inv) => { this.pendingInvitations = inv; finish(); },
      error: () => { finish(); }
    });
  }

  inviteRecruiter(): void {
    if (!this.inviteForm.name || !this.inviteForm.email) {
      this.error = 'Name and email are required.';
      return;
    }
    this.loading = true;
    this.adminService.inviteRecruiter({
      name: this.inviteForm.name,
      email: this.inviteForm.email,
      role: 'recruiter',
      teamId: this.inviteForm.teamId || undefined
    }).subscribe({
      next: (result) => {
        this.inviteForm = { name: '', email: '', teamId: '' };
        this.successMsg = result.emailSent
          ? 'Invitation sent successfully.'
          : `Invitation created. Share this link: ${result.invitationLink}`;
        this.loadRecruiters();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to invite recruiter.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  startEdit(r: AdminRecruiter): void {
    this.editingRecruiterId = r._id;
    this.editForm = { name: r.name, email: r.email, githubUsername: r.githubUsername || '', linkedin: r.linkedin || '', phoneNumber: r.phoneNumber || '' };
  }

  cancelEdit(): void {
    this.editingRecruiterId = '';
  }

  saveRecruiter(id: string): void {
    if (!this.editForm.name || !this.editForm.email) { this.error = 'Name and email are required.'; return; }
    this.loading = true;
    this.adminService.updateRecruiter(id, this.editForm).subscribe({
      next: () => { this.successMsg = 'Recruiter updated.'; this.cancelEdit(); this.loadRecruiters(); },
      error: (err) => { this.error = err?.error?.message || 'Failed to update.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  toggleActive(r: AdminRecruiter): void {
    this.loading = true;
    this.adminService.setRecruiterActive(r._id, !r.isActive).subscribe({
      next: () => { this.successMsg = r.isActive ? 'Recruiter deactivated.' : 'Recruiter activated.'; this.loadRecruiters(); },
      error: (err) => { this.error = err?.error?.message || 'Failed.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  revokeAccess(r: AdminRecruiter): void {
    this.loading = true;
    this.adminService.revokeRecruiterAccess(r._id).subscribe({
      next: () => { this.successMsg = 'Access revoked.'; this.loadRecruiters(); },
      error: (err) => { this.error = err?.error?.message || 'Failed.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  deleteRecruiter(r: AdminRecruiter): void {
    this.openConfirm('Delete Recruiter', `Delete ${r.name}? This cannot be undone.`, () => {
      this.loading = true;
      this.adminService.deleteRecruiter(r._id).subscribe({
        next: () => { this.successMsg = 'Recruiter deleted.'; this.loadRecruiters(); },
        error: (err) => { this.error = err?.error?.message || 'Failed.'; this.loading = false; this.cdr.detectChanges(); }
      });
    });
  }

  // ── Invitations ───────────────────────────────────────────────────────
  loadInvitations(): void {
    this.loading = true;
    this.adminService.getPendingInvitations().pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (inv) => { this.pendingInvitations = inv; },
      error: (err) => { this.error = err?.error?.message || 'Failed to load invitations.'; }
    });
  }

  revokeInvitation(inv: PendingInvitation): void {
    this.loading = true;
    this.adminService.revokeInvitation(inv._id).subscribe({
      next: () => { this.successMsg = `Invitation for ${inv.email} revoked.`; this.loadInvitations(); },
      error: (err) => { this.error = err?.error?.message || 'Failed.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  expireInvitation(inv: PendingInvitation): void {
    this.loading = true;
    this.adminService.expireInvitation(inv._id).subscribe({
      next: () => { this.successMsg = `Invitation for ${inv.email} expired.`; this.loadInvitations(); },
      error: (err) => { this.error = err?.error?.message || 'Failed.'; this.loading = false; this.cdr.detectChanges(); }
    });
  }

  deleteInvitation(inv: PendingInvitation): void {
    this.openConfirm('Delete Invitation', `Delete invitation for ${inv.email}?`, () => {
      this.loading = true;
      this.adminService.deleteInvitation(inv._id).subscribe({
        next: () => { this.successMsg = 'Invitation deleted.'; this.loadInvitations(); },
        error: (err) => { this.error = err?.error?.message || 'Failed.'; this.loading = false; this.cdr.detectChanges(); }
      });
    });
  }

  isExpired(inv: PendingInvitation): boolean {
    return new Date(inv.expiresAt) < new Date();
  }

  // ── Teams ─────────────────────────────────────────────────────────────
  loadTeamOptions(done?: () => void): void {
    if (!this.organizationId) {
      this.teamOptions = [];
      done?.();
      return;
    }

    this.adminService.getTeams(this.organizationId).subscribe({
      next: (teams) => {
        this.teamOptions = teams;
        done?.();
      },
      error: () => {
        this.teamOptions = [];
        done?.();
      }
    });
  }

  createTeam(): void {
    if (!this.teamForm.name) {
      this.error = 'Team name is required.';
      return;
    }

    this.loading = true;
    this.consoleService.createTeam({
      name: this.teamForm.name,
      slug: this.teamForm.slug || undefined,
      description: this.teamForm.description,
      recruiterId: this.teamForm.recruiterId || undefined
    }).subscribe({
      next: () => {
        this.successMsg = 'Team created successfully.';
        this.teamForm = { name: '', slug: '', description: '', recruiterId: '' };
        this.loadTeams();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to create team.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  startTeamEdit(team: ConsoleTeam): void {
    this.editingTeamId = team._id;
    this.teamEditForm = {
      name: team.name || '',
      slug: team.slug || '',
      description: team.description || ''
    };
  }

  cancelTeamEdit(): void {
    this.editingTeamId = '';
    this.teamEditForm = { name: '', slug: '', description: '' };
  }

  saveTeam(teamId: string): void {
    if (!this.teamEditForm.name) {
      this.error = 'Team name is required.';
      return;
    }

    this.loading = true;
    this.consoleService.updateTeam(teamId, {
      name: this.teamEditForm.name,
      slug: this.teamEditForm.slug || undefined,
      description: this.teamEditForm.description
    }).subscribe({
      next: () => {
        this.successMsg = 'Team updated successfully.';
        this.cancelTeamEdit();
        this.loadTeams();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to update team.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  toggleTeamActive(team: ConsoleTeam): void {
    this.loading = true;
    this.consoleService.setTeamActive(team._id, !team.isActive).subscribe({
      next: () => {
        this.successMsg = team.isActive ? 'Team deactivated.' : 'Team activated.';
        this.loadTeams();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to update team status.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  deleteTeam(team: ConsoleTeam): void {
    this.openConfirm('Delete Team', `Delete team ${team.name}? This cannot be undone.`, () => {
      this.loading = true;
      this.consoleService.deleteTeam(team._id).subscribe({
        next: () => {
          this.successMsg = 'Team deleted successfully.';
          this.loadTeams();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Failed to delete team.';
          this.loading = false;
          this.cdr.detectChanges();
        }
      });
    });
  }

  assignRecruiterToTeam(team: ConsoleTeam): void {
    const recruiterId = this.teamRecruiterSelections[team._id] || '';
    if (!recruiterId) {
      this.error = 'Select a recruiter first.';
      return;
    }

    this.loading = true;
    this.consoleService.assignRecruiterToTeam(team._id, recruiterId).subscribe({
      next: () => {
        this.successMsg = 'Recruiter assigned to team.';
        this.teamRecruiterSelections[team._id] = '';
        this.loadTeams();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Failed to assign recruiter to team.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  removeRecruiterFromTeam(team: ConsoleTeam, member: ConsoleTeam['members'][number]): void {
    this.openConfirm('Remove Recruiter', `Remove ${member.name} from ${team.name}?`, () => {
      this.loading = true;
      this.consoleService.removeRecruiterFromTeam(team._id, member._id).subscribe({
        next: () => {
          this.successMsg = 'Recruiter removed from team.';
          this.loadTeams();
        },
        error: (err) => {
          this.error = err?.error?.message || 'Failed to remove recruiter from team.';
          this.loading = false;
          this.cdr.detectChanges();
        }
      });
    });
  }

  recruiterAssignedTeamName(recruiter: AdminRecruiter): string {
    return recruiter?.teams?.[0]?.name || '';
  }

  recruiterAssignedToAnotherTeam(recruiter: AdminRecruiter, team?: ConsoleTeam): boolean {
    const teams = recruiter?.teams || [];
    if (teams.length === 0) return false;
    if (!team?._id) return true;
    return !teams.some((assigned) => String(assigned._id) === String(team._id));
  }

  recruiterOptionTitle(recruiter: AdminRecruiter, team?: ConsoleTeam): string {
    if (!this.recruiterAssignedToAnotherTeam(recruiter, team)) return '';
    const assignedTeam = this.recruiterAssignedTeamName(recruiter);
    return assignedTeam
      ? `Already assigned to ${assignedTeam}`
      : 'Already assigned to another team';
  }

  recruitersForTeamDropdown(team: ConsoleTeam): AdminRecruiter[] {
    return this.recruiters.filter((recruiter) => {
      const teams = recruiter?.teams || [];
      if (teams.length === 0) return true;
      return teams.some((assigned) => String(assigned._id) === String(team._id));
    });
  }

  // ── Analytics ─────────────────────────────────────────────────────────
  loadAnalytics(): void {
    this.loading = true;
    this.consoleService.getAnalytics().pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (data) => { this.analytics = data; },
      error: (err) => { this.error = err?.error?.message || 'Failed to load analytics.'; }
    });
  }

  // ── Activity ──────────────────────────────────────────────────────────
  loadActivity(page: number): void {
    this.loading = true;
    this.activityPage = page;
    this.consoleService.getActivity(page).pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (res) => {
        this.activityLogs = res.logs || [];
        this.activityTotal = res.total || 0;
        this.activityTotalPages = res.totalPages || 1;
      },
      error: (err) => { this.error = err?.error?.message || 'Failed to load activity.'; }
    });
  }

  fmtActor(actor: ActivityLog['actor']): string {
    if (!actor) return 'System';
    return actor.name || actor.email || 'Unknown';
  }

  // ── Preferences ───────────────────────────────────────────────────────
  loadPreferences(): void {
    this.loading = true;
    this.consoleService.getPreferences().pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (data) => {
        this.preferences = data;
        this.prefForm = { name: data.organization.name, description: data.organization.description || '' };
      },
      error: (err) => { this.error = err?.error?.message || 'Failed to load preferences.'; }
    });
  }

  savePreferences(): void {
    if (!this.prefForm.name) { this.error = 'Organization name is required.'; return; }
    this.loading = true;
    this.consoleService.updatePreferences(this.prefForm).pipe(
      finalize(() => { this.loading = false; this.cdr.detectChanges(); })
    ).subscribe({
      next: (res) => {
        this.successMsg = res.message || 'Preferences saved.';
        this.preferences = res;
        this.tenantContext.setOrganization({
          id: res.organization._id,
          name: res.organization.name,
          myRole: 'admin'
        });
      },
      error: (err) => { this.error = err?.error?.message || 'Failed to save preferences.'; }
    });
  }

  // ── Confirm dialog ────────────────────────────────────────────────────
  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.pendingConfirmAction = action;
    this.confirmOpen = true;
  }

  onConfirmed(): void {
    this.confirmOpen = false;
    this.pendingConfirmAction?.();
    this.pendingConfirmAction = null;
  }

  onCancelled(): void {
    this.confirmOpen = false;
    this.pendingConfirmAction = null;
  }

  dismissMessages(): void {
    this.error = '';
    this.successMsg = '';
  }
}
