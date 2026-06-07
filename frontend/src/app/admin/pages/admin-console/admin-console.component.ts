import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, of } from 'rxjs';

import {
  AdminConsoleService,
  ConsoleOverview,
  ConsolePreferences,
  ConsoleTeam
} from './admin-console.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import {
  AdminHiringService,
  AdminRecruiter,
  AdminTeamOption,
  PendingInvitation
} from '../../services/admin-hiring.service';

type Tab = 'overview' | 'teams' | 'recruiters' | 'invitations' | 'activity' | 'preferences';
type DataTab = Exclude<Tab, 'activity'>;
type RecruiterSort = 'activity' | 'name' | 'jobs' | 'completion' | 'recent';

interface TabState {
  loading: boolean;
  loaded: boolean;
  error: string;
  requestId: number;
}

@Component({
  selector: 'app-admin-console-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-console.component.html',
  styleUrl: './admin-console.component.scss'
})
export class AdminConsolePageComponent implements OnInit {
  activeTab: Tab = 'overview';
  loading = false;
  error = '';
  successMsg = '';

  overview: ConsoleOverview | null = null;
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

  recruiters: AdminRecruiter[] = [];
  editingRecruiterId = '';
  selectedRecruiter: AdminRecruiter | null = null;
  inviteForm = { name: '', email: '', teamId: '' };
  editForm = { name: '', email: '', githubUsername: '', linkedin: '', phoneNumber: '' };
  recruiterFilters: {
    search: string;
    status: 'all' | 'active' | 'inactive';
    teamId: string;
    sortBy: RecruiterSort;
  } = {
    search: '',
    status: 'all',
    teamId: '',
    sortBy: 'activity'
  };

  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  private pendingConfirmAction: (() => void) | null = null;

  pendingInvitations: PendingInvitation[] = [];

  preferences: ConsolePreferences | null = null;
  prefForm = {
    name: '',
    description: '',
    preferredDateRangeDays: 30,
    defaultTeamId: '',
    showKpiCards: true,
    showTeamAnalytics: true,
    showRecruiterPerformance: true,
    showJobTrends: true,
    showActivityFeed: true
  };

  organizationId = '';
  orgName = '';

  private readonly destroyRef = inject(DestroyRef);
  private readonly allowedDateRanges = [7, 14, 30, 60, 90];
  private readonly tabStates: Record<Tab, TabState> = {
    overview: this.createTabState(),
    teams: this.createTabState(),
    recruiters: this.createTabState(),
    invitations: this.createTabState(),
    activity: this.createTabState(),
    preferences: this.createTabState()
  };
  private teamOptionsRequestId = 0;
  private teamOptionsLoading = false;
  private mutationCount = 0;

  constructor(
    private readonly consoleService: AdminConsoleService,
    private readonly adminService: AdminHiringService,
    private readonly tenantContext: TenantContextService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.tenantContext.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ctx) => {
        const nextOrgId = ctx.organizationId || '';
        const orgChanged = nextOrgId !== this.organizationId;

        this.organizationId = nextOrgId;
        this.orgName = ctx.organizationName || 'Organization';

        if (orgChanged) {
          this.resetTabData();
          this.loadTeamOptions(true);
          this.loadActiveTab(true);
        }
      });

    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const tab = params['tab'] as Tab | undefined;
        const nextTab = tab && this.isValidTab(tab) ? tab : 'overview';

        if (nextTab === 'activity') {
          this.goToActivityLogs();
          return;
        }

        const shouldLoad = this.activeTab !== nextTab || !this.tabStates[nextTab].loaded;
        this.activeTab = nextTab;

        if (!tab) {
          this.navigateToTab(nextTab, true);
          return;
        }

        if (shouldLoad) {
          this.loadActiveTab();
        }
      });
  }

  get filteredRecruiters(): AdminRecruiter[] {
    const search = this.recruiterFilters.search.trim().toLowerCase();
    const teamId = this.recruiterFilters.teamId;
    const status = this.recruiterFilters.status;

    const filtered = this.recruiters.filter((recruiter) => {
      if (status === 'active' && !recruiter.isActive) {
        return false;
      }
      if (status === 'inactive' && recruiter.isActive) {
        return false;
      }
      if (teamId && !(recruiter.teams || []).some((team) => String(team._id) === teamId)) {
        return false;
      }
      if (!search) {
        return true;
      }

      const haystack = [
        recruiter.name,
        recruiter.email,
        recruiter.githubUsername,
        recruiter.jobTitle,
        recruiter.location,
        recruiter.bio,
        recruiter.linkedin,
        ...(recruiter.teams || []).map((team) => team.name),
        ...(recruiter.recruiterDetails?.specialties || []),
        ...(recruiter.recruiterDetails?.toolsAndPlatforms || []),
        ...(recruiter.recruiterDetails?.languages || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(search);
    });

    return filtered.sort((left, right) => this.compareRecruiters(left, right, this.recruiterFilters.sortBy));
  }

  get activeTabError(): string {
    return this.tabStates[this.activeTab].error;
  }

  setTab(tab: Tab): void {
    if (tab === 'activity') {
      this.goToActivityLogs();
      return;
    }

    this.dismissMessages();
    this.activeTab = tab;
    this.navigateToTab(tab, true);
  }

  refreshActiveTab(): void {
    this.dismissMessages();
    this.clearTabError(this.activeTab);
    if (this.activeTab === 'activity') {
      this.goToActivityLogs();
      return;
    }
    this.loadActiveTab(true);
  }

  toggleTeam(teamId: string): void {
    this.expandedTeamId = this.expandedTeamId === teamId ? '' : teamId;
  }

  inviteRecruiter(): void {
    if (!this.inviteForm.name.trim() || !this.inviteForm.email.trim()) {
      this.error = 'Name and email are required.';
      return;
    }

    this.runMutation(() => this.adminService.inviteRecruiter({
      name: this.inviteForm.name.trim(),
      email: this.inviteForm.email.trim(),
      role: 'recruiter',
      teamId: this.inviteForm.teamId || undefined
    }), {
      success: (result) => {
        this.inviteForm = { name: '', email: '', teamId: '' };
        this.successMsg = result.emailSent
          ? 'Invitation sent successfully.'
          : `Invitation created. Share this link: ${result.invitationLink}`;
        this.invalidateTabs(['overview', 'recruiters', 'invitations', 'teams']);
        this.loadRecruiters(true);
      },
      failure: 'Failed to invite recruiter.'
    });
  }

  startEdit(recruiter: AdminRecruiter): void {
    this.editingRecruiterId = recruiter._id;
    this.editForm = {
      name: recruiter.name,
      email: recruiter.email,
      githubUsername: recruiter.githubUsername || '',
      linkedin: recruiter.linkedin || '',
      phoneNumber: recruiter.phoneNumber || ''
    };
  }

  cancelEdit(): void {
    this.editingRecruiterId = '';
  }

  saveRecruiter(id: string): void {
    if (!this.editForm.name.trim() || !this.editForm.email.trim()) {
      this.error = 'Name and email are required.';
      return;
    }

    this.runMutation(() => this.adminService.updateRecruiter(id, {
      name: this.editForm.name.trim(),
      email: this.editForm.email.trim(),
      githubUsername: this.editForm.githubUsername.trim(),
      linkedin: this.editForm.linkedin.trim(),
      phoneNumber: this.editForm.phoneNumber.trim()
    }), {
      success: () => {
        this.successMsg = 'Recruiter updated.';
        this.cancelEdit();
        this.invalidateTabs(['overview', 'recruiters', 'teams']);
        this.loadRecruiters(true);
      },
      failure: 'Failed to update recruiter.'
    });
  }

  toggleActive(recruiter: AdminRecruiter): void {
    this.runMutation(() => this.adminService.setRecruiterActive(recruiter._id, !recruiter.isActive), {
      success: () => {
        this.successMsg = recruiter.isActive ? 'Recruiter deactivated.' : 'Recruiter activated.';
        this.invalidateTabs(['overview', 'recruiters', 'teams']);
        this.loadRecruiters(true);
      },
      failure: 'Failed to update recruiter status.'
    });
  }

  revokeAccess(recruiter: AdminRecruiter): void {
    this.openConfirm(
      'Revoke Recruiter Access',
      `Revoke access for ${recruiter.name}? They will lose admin console access until re-enabled.`,
      () => {
        this.runMutation(() => this.adminService.revokeRecruiterAccess(recruiter._id), {
          success: () => {
            this.successMsg = 'Access revoked.';
            this.invalidateTabs(['overview', 'recruiters', 'teams']);
            this.loadRecruiters(true);
          },
          failure: 'Failed to revoke recruiter access.'
        });
      }
    );
  }

  deleteRecruiter(recruiter: AdminRecruiter): void {
    this.openConfirm('Delete Recruiter', `Delete ${recruiter.name}? This cannot be undone.`, () => {
      this.runMutation(() => this.adminService.deleteRecruiter(recruiter._id), {
        success: () => {
          this.successMsg = 'Recruiter deleted.';
          if (this.selectedRecruiter?._id === recruiter._id) {
            this.selectedRecruiter = null;
          }
          this.invalidateTabs(['overview', 'recruiters', 'invitations', 'teams']);
          this.loadRecruiters(true);
        },
        failure: 'Failed to delete recruiter.'
      });
    });
  }

  revokeInvitation(invitation: PendingInvitation): void {
    this.openConfirm('Revoke Invitation', `Revoke invitation for ${invitation.email}?`, () => {
      this.runMutation(() => this.adminService.revokeInvitation(invitation._id), {
        success: () => {
          this.successMsg = `Invitation for ${invitation.email} revoked.`;
          this.invalidateTabs(['overview', 'recruiters', 'invitations']);
          this.loadInvitations(true);
        },
        failure: 'Failed to revoke invitation.'
      });
    });
  }

  expireInvitation(invitation: PendingInvitation): void {
    this.openConfirm('Expire Invitation', `Expire invitation for ${invitation.email} now?`, () => {
      this.runMutation(() => this.adminService.expireInvitation(invitation._id), {
        success: () => {
          this.successMsg = `Invitation for ${invitation.email} expired.`;
          this.invalidateTabs(['overview', 'recruiters', 'invitations']);
          this.loadInvitations(true);
        },
        failure: 'Failed to expire invitation.'
      });
    });
  }

  deleteInvitation(invitation: PendingInvitation): void {
    this.openConfirm('Delete Invitation', `Delete invitation for ${invitation.email}?`, () => {
      this.runMutation(() => this.adminService.deleteInvitation(invitation._id), {
        success: () => {
          this.successMsg = 'Invitation deleted.';
          this.invalidateTabs(['overview', 'recruiters', 'invitations']);
          this.loadInvitations(true);
        },
        failure: 'Failed to delete invitation.'
      });
    });
  }

  isExpired(invitation: PendingInvitation): boolean {
    return new Date(invitation.expiresAt) < new Date();
  }

  createTeam(): void {
    if (!this.teamForm.name.trim()) {
      this.error = 'Team name is required.';
      return;
    }

    this.runMutation(() => this.consoleService.createTeam({
      name: this.teamForm.name.trim(),
      slug: this.teamForm.slug.trim() || undefined,
      description: this.teamForm.description.trim(),
      recruiterId: this.teamForm.recruiterId || undefined
    }), {
      success: () => {
        this.successMsg = 'Team created successfully.';
        this.teamForm = { name: '', slug: '', description: '', recruiterId: '' };
        this.invalidateTabs(['overview', 'teams', 'recruiters', 'preferences']);
        this.loadTeamOptions(true);
        this.loadTeams(true);
      },
      failure: 'Failed to create team.'
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
    if (!this.teamEditForm.name.trim()) {
      this.error = 'Team name is required.';
      return;
    }

    this.runMutation(() => this.consoleService.updateTeam(teamId, {
      name: this.teamEditForm.name.trim(),
      slug: this.teamEditForm.slug.trim() || undefined,
      description: this.teamEditForm.description.trim()
    }), {
      success: () => {
        this.successMsg = 'Team updated successfully.';
        this.cancelTeamEdit();
        this.invalidateTabs(['overview', 'teams', 'preferences']);
        this.loadTeamOptions(true);
        this.loadTeams(true);
      },
      failure: 'Failed to update team.'
    });
  }

  toggleTeamActive(team: ConsoleTeam): void {
    this.runMutation(() => this.consoleService.setTeamActive(team._id, !team.isActive), {
      success: () => {
        this.successMsg = team.isActive ? 'Team deactivated.' : 'Team activated.';
        this.invalidateTabs(['overview', 'teams', 'preferences']);
        this.loadTeamOptions(true);
        this.loadTeams(true);
      },
      failure: 'Failed to update team status.'
    });
  }

  deleteTeam(team: ConsoleTeam): void {
    this.openConfirm('Delete Team', `Delete team ${team.name}? This cannot be undone.`, () => {
      this.runMutation(() => this.consoleService.deleteTeam(team._id), {
        success: () => {
          this.successMsg = 'Team deleted successfully.';
          if (this.expandedTeamId === team._id) {
            this.expandedTeamId = '';
          }
          this.invalidateTabs(['overview', 'teams', 'recruiters', 'preferences']);
          this.loadTeamOptions(true);
          this.loadTeams(true);
        },
        failure: 'Failed to delete team.'
      });
    });
  }

  assignRecruiterToTeam(team: ConsoleTeam): void {
    const recruiterId = this.teamRecruiterSelections[team._id] || '';
    if (!recruiterId) {
      this.error = 'Select a recruiter first.';
      return;
    }

    this.runMutation(() => this.consoleService.assignRecruiterToTeam(team._id, recruiterId), {
      success: () => {
        this.successMsg = 'Recruiter assigned to team.';
        this.teamRecruiterSelections[team._id] = '';
        this.invalidateTabs(['overview', 'teams', 'recruiters', 'preferences']);
        this.loadTeamOptions(true);
        this.loadTeams(true);
      },
      failure: 'Failed to assign recruiter to team.'
    });
  }

  removeRecruiterFromTeam(team: ConsoleTeam, member: ConsoleTeam['members'][number]): void {
    this.openConfirm('Remove Recruiter', `Remove ${member.name} from ${team.name}?`, () => {
      this.runMutation(() => this.consoleService.removeRecruiterFromTeam(team._id, member._id), {
        success: () => {
          this.successMsg = 'Recruiter removed from team.';
          this.invalidateTabs(['overview', 'teams', 'recruiters', 'preferences']);
          this.loadTeamOptions(true);
          this.loadTeams(true);
        },
        failure: 'Failed to remove recruiter from team.'
      });
    });
  }

  recruiterAssignedTeamName(recruiter: AdminRecruiter): string {
    return recruiter?.teams?.[0]?.name || '';
  }

  recruiterAssignedToAnotherTeam(recruiter: AdminRecruiter, team?: ConsoleTeam): boolean {
    const teams = recruiter?.teams || [];
    if (teams.length === 0) {
      return false;
    }
    if (!team?._id) {
      return true;
    }
    return !teams.some((assigned) => String(assigned._id) === String(team._id));
  }

  recruiterOptionTitle(recruiter: AdminRecruiter, team?: ConsoleTeam): string {
    if (!this.recruiterAssignedToAnotherTeam(recruiter, team)) {
      return '';
    }
    const assignedTeam = this.recruiterAssignedTeamName(recruiter);
    return assignedTeam ? `Already assigned to ${assignedTeam}` : 'Already assigned to another team';
  }

  recruitersForTeamDropdown(team: ConsoleTeam): AdminRecruiter[] {
    return this.recruiters.filter((recruiter) => {
      const teams = recruiter?.teams || [];
      if (teams.length === 0) {
        return true;
      }
      return teams.some((assigned) => String(assigned._id) === String(team._id));
    });
  }

  recruitersBlockedForTeam(team: ConsoleTeam): AdminRecruiter[] {
    return this.recruiters.filter((recruiter) => this.recruiterAssignedToAnotherTeam(recruiter, team));
  }

  recruiterTeamsLabel(recruiter: AdminRecruiter): string {
    const names = (recruiter.teams || []).map((team) => team.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'Unassigned';
  }

  recruiterProfileCompletion(recruiter: AdminRecruiter): number {
    return Number(recruiter.metrics?.profileCompletion || 0);
  }

  recruiterPrimaryMetric(recruiter: AdminRecruiter): number {
    return Number(recruiter.metrics?.recruiterScore || recruiter.metrics?.activityScore || 0);
  }

  recruiterLastActive(recruiter: AdminRecruiter): string {
    return recruiter.metrics?.lastActive || recruiter.createdAt;
  }

  clearRecruiterFilters(): void {
    this.recruiterFilters = {
      search: '',
      status: 'all',
      teamId: '',
      sortBy: 'activity'
    };
  }

  openRecruiterDetails(recruiter: AdminRecruiter): void {
    this.selectedRecruiter = recruiter;
  }

  closeRecruiterDetails(): void {
    this.selectedRecruiter = null;
  }

  savePreferences(): void {
    if (!this.prefForm.name.trim()) {
      this.error = 'Organization name is required.';
      return;
    }

    if (!this.allowedDateRanges.includes(this.prefForm.preferredDateRangeDays)) {
      this.error = 'Choose a valid default dashboard range.';
      return;
    }

    if (this.prefForm.defaultTeamId && !this.teamOptions.some((team) => String(team._id) === this.prefForm.defaultTeamId)) {
      this.error = 'Default team must belong to this organization.';
      return;
    }

    this.runMutation(() => this.consoleService.updatePreferences({
      name: this.prefForm.name.trim(),
      description: this.prefForm.description.trim(),
      dashboardConfig: {
        preferredDateRangeDays: this.prefForm.preferredDateRangeDays,
        defaultTeamId: this.prefForm.defaultTeamId,
        showKpiCards: this.prefForm.showKpiCards,
        showTeamAnalytics: this.prefForm.showTeamAnalytics,
        showRecruiterPerformance: this.prefForm.showRecruiterPerformance,
        showJobTrends: this.prefForm.showJobTrends,
        showActivityFeed: this.prefForm.showActivityFeed
      }
    }), {
      success: (res) => {
        this.successMsg = res.message || 'Preferences saved.';
        this.preferences = res;
        this.prefForm = {
          name: res.organization.name,
          description: res.organization.description || '',
          preferredDateRangeDays: res.organization.dashboardConfig?.preferredDateRangeDays || 30,
          defaultTeamId: res.organization.dashboardConfig?.defaultTeamId || '',
          showKpiCards: res.organization.dashboardConfig?.showKpiCards !== false,
          showTeamAnalytics: res.organization.dashboardConfig?.showTeamAnalytics !== false,
          showRecruiterPerformance: res.organization.dashboardConfig?.showRecruiterPerformance !== false,
          showJobTrends: res.organization.dashboardConfig?.showJobTrends !== false,
          showActivityFeed: res.organization.dashboardConfig?.showActivityFeed !== false
        };
        this.tenantContext.syncOrganization({
          id: res.organization._id,
          name: res.organization.name,
          myRole: 'admin'
        });
        this.invalidateTabs(['overview', 'preferences']);
        this.tabStates.preferences.loaded = true;
      },
      failure: 'Failed to save preferences.'
    });
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

  goToPerformanceStatistics(): void {
    this.router.navigate(['/app/admin/console/performance-statistics']);
  }

  goToActivityLogs(): void {
    this.router.navigate(['/app/admin/activity-logs']);
  }

  isTabLoading(tab: Tab): boolean {
    return this.tabStates[tab].loading;
  }

  hasTabData(tab: Tab): boolean {
    return this.tabStates[tab].loaded;
  }

  hasCurrentTabError(): boolean {
    return Boolean(this.activeTabError);
  }

  private isValidTab(tab: string): tab is Tab {
    return ['overview', 'teams', 'recruiters', 'invitations', 'activity', 'preferences'].includes(tab);
  }

  private createTabState(): TabState {
    return {
      loading: false,
      loaded: false,
      error: '',
      requestId: 0
    };
  }

  private navigateToTab(tab: DataTab, replaceUrl = false): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl
    });
  }

  private loadActiveTab(force = false): void {
    switch (this.activeTab) {
      case 'overview':
        this.loadOverview(force);
        break;
      case 'teams':
        this.loadTeams(force);
        break;
      case 'recruiters':
        this.loadRecruiters(force);
        break;
      case 'invitations':
        this.loadInvitations(force);
        break;
      case 'preferences':
        this.loadPreferences(force);
        break;
      case 'activity':
        break;
    }
  }

  private loadOverview(force = false): void {
    if (!this.startTabRequest('overview', force)) {
      return;
    }

    const requestId = this.tabStates.overview.requestId;
    this.consoleService.getOverview().subscribe({
      next: (data) => {
        if (!this.isLatestRequest('overview', requestId)) {
          return;
        }
        this.overview = data;
        this.finishTabRequest('overview', requestId);
      },
      error: (err) => {
        this.failTabRequest('overview', requestId, err?.error?.message || 'Failed to load overview.');
      }
    });
  }

  private loadTeams(force = false): void {
    if (!this.startTabRequest('teams', force)) {
      return;
    }

    const requestId = this.tabStates.teams.requestId;
    forkJoin({
      teamResponse: this.consoleService.getTeams(),
      recruiters: this.adminService.getRecruiters(),
      teamOptions: this.getTeamOptionsRequest()
    }).subscribe({
      next: ({ teamResponse, recruiters, teamOptions }) => {
        if (!this.isLatestRequest('teams', requestId)) {
          return;
        }
        this.teams = teamResponse.teams || [];
        this.recruiters = recruiters || [];
        this.teamOptions = teamOptions || [];
        this.finishTabRequest('teams', requestId);
      },
      error: (err) => {
        this.failTabRequest('teams', requestId, err?.error?.message || 'Failed to load teams.');
      }
    });
  }

  private loadRecruiters(force = false): void {
    if (!this.startTabRequest('recruiters', force)) {
      return;
    }

    const requestId = this.tabStates.recruiters.requestId;
    forkJoin({
      recruiters: this.adminService.getRecruiters(),
      invitations: this.adminService.getPendingInvitations(),
      teamOptions: this.getTeamOptionsRequest()
    }).subscribe({
      next: ({ recruiters, invitations, teamOptions }) => {
        if (!this.isLatestRequest('recruiters', requestId)) {
          return;
        }
        this.recruiters = recruiters || [];
        this.pendingInvitations = invitations || [];
        this.teamOptions = teamOptions || [];
        if (this.selectedRecruiter?._id) {
          this.selectedRecruiter = this.recruiters.find((item) => item._id === this.selectedRecruiter?._id) || null;
        }
        this.finishTabRequest('recruiters', requestId);
      },
      error: (err) => {
        this.failTabRequest('recruiters', requestId, err?.error?.message || 'Failed to load recruiters.');
      }
    });
  }

  private loadInvitations(force = false): void {
    if (!this.startTabRequest('invitations', force)) {
      return;
    }

    const requestId = this.tabStates.invitations.requestId;
    this.adminService.getPendingInvitations().subscribe({
      next: (invitations) => {
        if (!this.isLatestRequest('invitations', requestId)) {
          return;
        }
        this.pendingInvitations = invitations || [];
        this.finishTabRequest('invitations', requestId);
      },
      error: (err) => {
        this.failTabRequest('invitations', requestId, err?.error?.message || 'Failed to load invitations.');
      }
    });
  }

  private loadPreferences(force = false): void {
    if (!this.startTabRequest('preferences', force)) {
      return;
    }

    const requestId = this.tabStates.preferences.requestId;
    forkJoin({
      preferences: this.consoleService.getPreferences(),
      teamOptions: this.getTeamOptionsRequest()
    }).subscribe({
      next: ({ preferences, teamOptions }) => {
        if (!this.isLatestRequest('preferences', requestId)) {
          return;
        }
        const config = preferences.organization.dashboardConfig || {
          preferredDateRangeDays: 30,
          defaultTeamId: '',
          showKpiCards: true,
          showTeamAnalytics: true,
          showRecruiterPerformance: true,
          showJobTrends: true,
          showActivityFeed: true
        };
        this.preferences = preferences;
        this.teamOptions = teamOptions || [];
        this.prefForm = {
          name: preferences.organization.name,
          description: preferences.organization.description || '',
          preferredDateRangeDays: config.preferredDateRangeDays || 30,
          defaultTeamId: config.defaultTeamId || '',
          showKpiCards: config.showKpiCards !== false,
          showTeamAnalytics: config.showTeamAnalytics !== false,
          showRecruiterPerformance: config.showRecruiterPerformance !== false,
          showJobTrends: config.showJobTrends !== false,
          showActivityFeed: config.showActivityFeed !== false
        };
        this.finishTabRequest('preferences', requestId);
      },
      error: (err) => {
        this.failTabRequest('preferences', requestId, err?.error?.message || 'Failed to load preferences.');
      }
    });
  }

  private getTeamOptionsRequest(): Observable<AdminTeamOption[]> {
    if (!this.organizationId) {
      return of([]);
    }
    return this.adminService.getTeams(this.organizationId);
  }

  private loadTeamOptions(force = false): void {
    if (!this.organizationId) {
      this.teamOptions = [];
      return;
    }
    if (this.teamOptionsLoading && !force) {
      return;
    }
    if (!force && this.teamOptions.length > 0) {
      return;
    }

    const requestId = ++this.teamOptionsRequestId;
    this.teamOptionsLoading = true;
    this.adminService.getTeams(this.organizationId).subscribe({
      next: (teams) => {
        if (requestId !== this.teamOptionsRequestId) {
          return;
        }
        this.teamOptions = teams || [];
        this.teamOptionsLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (requestId !== this.teamOptionsRequestId) {
          return;
        }
        this.teamOptions = [];
        this.teamOptionsLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private compareRecruiters(left: AdminRecruiter, right: AdminRecruiter, sortBy: RecruiterSort): number {
    switch (sortBy) {
      case 'name':
        return left.name.localeCompare(right.name);
      case 'jobs':
        return Number(right.metrics?.jobsCreated || 0) - Number(left.metrics?.jobsCreated || 0);
      case 'completion':
        return this.recruiterProfileCompletion(right) - this.recruiterProfileCompletion(left);
      case 'recent':
        return new Date(this.recruiterLastActive(right)).getTime() - new Date(this.recruiterLastActive(left)).getTime();
      case 'activity':
      default:
        return this.recruiterPrimaryMetric(right) - this.recruiterPrimaryMetric(left);
    }
  }

  private startTabRequest(tab: DataTab, force: boolean): boolean {
    const state = this.tabStates[tab];
    if (state.loading && !force) {
      return false;
    }
    if (state.loaded && !force) {
      this.syncLoading();
      return false;
    }

    state.loading = true;
    state.error = '';
    state.requestId += 1;
    this.syncLoading();
    return true;
  }

  private finishTabRequest(tab: DataTab, requestId: number): void {
    if (!this.isLatestRequest(tab, requestId)) {
      return;
    }
    const state = this.tabStates[tab];
    state.loading = false;
    state.loaded = true;
    state.error = '';
    this.syncLoading();
    this.cdr.detectChanges();
  }

  private failTabRequest(tab: DataTab, requestId: number, message: string): void {
    if (!this.isLatestRequest(tab, requestId)) {
      return;
    }
    const state = this.tabStates[tab];
    state.loading = false;
    state.loaded = false;
    state.error = message;
    this.syncLoading();
    this.cdr.detectChanges();
  }

  private clearTabError(tab: Tab): void {
    this.tabStates[tab].error = '';
  }

  private isLatestRequest(tab: DataTab, requestId: number): boolean {
    return this.tabStates[tab].requestId === requestId;
  }

  private invalidateTabs(tabs: DataTab[]): void {
    tabs.forEach((tab) => {
      this.tabStates[tab].loaded = false;
      this.tabStates[tab].error = '';
    });
  }

  private resetTabData(): void {
    (['overview', 'teams', 'recruiters', 'invitations', 'preferences'] as DataTab[]).forEach((tab) => {
      this.tabStates[tab] = this.createTabState();
    });
    this.teamOptions = [];
    this.selectedRecruiter = null;
  }

  private runMutation<T>(
    request: () => Observable<T>,
    options: {
      success: (result: T) => void;
      failure: string;
    }
  ): void {
    this.dismissMessages();
    this.mutationCount += 1;
    this.syncLoading();

    request().subscribe({
      next: (result) => {
        this.mutationCount = Math.max(0, this.mutationCount - 1);
        options.success(result);
        this.syncLoading();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.mutationCount = Math.max(0, this.mutationCount - 1);
        this.error = err?.error?.message || options.failure;
        this.syncLoading();
        this.cdr.detectChanges();
      }
    });
  }

  private syncLoading(): void {
    const tabLoading = (Object.values(this.tabStates) as TabState[]).some((state) => state.loading);
    this.loading = tabLoading || this.mutationCount > 0 || this.teamOptionsLoading;
  }

  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.pendingConfirmAction = action;
    this.confirmOpen = true;
  }
}
