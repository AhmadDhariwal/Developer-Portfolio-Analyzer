import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationService, AppNotification } from '../../shared/services/notification.service';
import { ApiService } from '../../shared/services/api.service';
import { TenantContextService } from '../../shared/services/tenant-context.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';

interface OrganizationItem {
  _id: string;
  name: string;
  myRole: 'admin' | 'manager' | 'member';
}

interface TeamItem {
  _id: string;
  name: string;
}

interface UserOption {
  _id: string;
  name?: string;
  email?: string;
  githubUsername?: string;
  role?: 'admin' | 'manager' | 'member';
}

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss'
})
export class NotificationsComponent implements OnInit {
  notifications: AppNotification[] = [];
  loading = false;
  statusMessage = '';
  unreadCount = 0;
  page = 1;
  totalPages = 1;
  total = 0;

  search = '';
  from = '';
  to = '';
  typeFilter = '';
  unreadOnly = false;
  roleFilter = '';
  selectedUserId = '';
  selectedOrganizationId = '';
  selectedTeamId = '';

  organizations: OrganizationItem[] = [];
  teams: TeamItem[] = [];
  userOptions: UserOption[] = [];

  private currentRole: 'admin' | 'manager' | 'member' = 'member';
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly typeOptions = [
    { value: '', label: 'All types' },
    { value: 'profile_update', label: 'Profile update' },
    { value: 'resume_upload', label: 'Resume upload' },
    { value: 'github_update', label: 'GitHub update' },
    { value: 'low_score', label: 'Low score' },
    { value: 'career_update', label: 'Career update' },
    { value: 'system', label: 'System' }
  ];

  constructor(
    private readonly notificationService: NotificationService,
    private readonly apiService: ApiService,
    private readonly tenantContext: TenantContextService
  ) {}

  ngOnInit(): void {
    const ctx = this.tenantContext.snapshot;
    this.selectedOrganizationId = ctx.organizationId || '';
    this.selectedTeamId = ctx.teamId || '';
    this.currentRole = (ctx.myRole || 'member') as 'admin' | 'manager' | 'member';
    
    // Load organizations and teams
    this.loadOrganizations();

    this.tenantContext.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state.organizationId && state.organizationId !== this.selectedOrganizationId) {
          this.selectedOrganizationId = state.organizationId;
          this.currentRole = (state.myRole || this.currentRole) as 'admin' | 'manager' | 'member';
          this.selectedTeamId = state.teamId || '';
          this.loadTeams();
          this.loadUserOptions();
          this.fetchNotifications(1);
        }
      });
  }

  get canFilterUsers(): boolean {
    return this.currentRole !== 'member';
  }

  get canFilterRole(): boolean {
    return this.currentRole === 'admin';
  }

  private toStartOfDayIso(dateInput: string): string {
    const [y, m, d] = dateInput.split('-').map((v) => Number.parseInt(v, 10));
    if (!y || !m || !d) return new Date(dateInput).toISOString();
    return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  }

  private toEndOfDayIso(dateInput: string): string {
    const [y, m, d] = dateInput.split('-').map((v) => Number.parseInt(v, 10));
    if (!y || !m || !d) return new Date(dateInput).toISOString();
    return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
  }

  loadOrganizations(): void {
    this.apiService.getOrganizations().subscribe({
      next: (res) => {
        this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
        const selectedOrg = this.organizations.find((org) => org._id === this.selectedOrganizationId);
        if (selectedOrg) {
          this.currentRole = selectedOrg.myRole;
        }
        this.loadTeams();
        this.loadUserOptions();
        // Always fetch notifications
        this.fetchNotifications(1);
      },
      error: () => {
        this.organizations = [];
        // Fetch notifications even if org loading fails
        this.fetchNotifications(1);
      }
    });
  }

  loadTeams(): void {
    if (!this.selectedOrganizationId) {
      this.teams = [];
      this.selectedTeamId = '';
      return;
    }

    this.apiService.getTeams(this.selectedOrganizationId).subscribe({
      next: (res) => {
        this.teams = Array.isArray(res?.teams) ? res.teams : [];
        if (this.selectedTeamId && !this.teams.some((team) => team._id === this.selectedTeamId)) {
          this.selectedTeamId = '';
        }
      },
      error: () => {
        this.teams = [];
      }
    });
  }

  loadUserOptions(): void {
    if (!this.selectedOrganizationId) {
      this.userOptions = [];
      return;
    }

    if (this.currentRole === 'admin') {
      this.apiService.getOrganizationMembers(this.selectedOrganizationId).subscribe({
        next: (res) => {
          const members = Array.isArray(res?.members) ? res.members : [];
          this.userOptions = members.map((m: any) => ({
            _id: String(m.user?._id || m.userId || m._id || ''),
            name: m.user?.name || m.name,
            email: m.user?.email || m.email,
            githubUsername: m.user?.githubUsername || m.githubUsername,
            role: m.orgRole || m.role
          }));
        },
        error: () => {
          this.userOptions = [];
        }
      });
      return;
    }

    if (this.currentRole === 'manager' && this.selectedTeamId) {
      this.apiService.getTeamMembers(this.selectedTeamId).subscribe({
        next: (res) => {
          const members = Array.isArray(res?.members) ? res.members : [];
          this.userOptions = members.map((m: any) => ({
            _id: String(m.userId?._id || m.userId || ''),
            name: m.userId?.name,
            email: m.userId?.email,
            githubUsername: m.userId?.githubUsername,
            role: m.role
          }));
        },
        error: () => {
          this.userOptions = [];
        }
      });
      return;
    }

    this.userOptions = [];
  }

  onOrganizationChange(): void {
    const selectedOrg = this.organizations.find((org) => org._id === this.selectedOrganizationId);
    this.currentRole = selectedOrg?.myRole || 'member';
    this.selectedTeamId = '';
    this.selectedUserId = '';
    this.roleFilter = '';
    this.loadTeams();
    this.loadUserOptions();
    this.fetchNotifications(1);
  }

  onTeamChange(): void {
    this.selectedUserId = '';
    this.loadUserOptions();
    this.fetchNotifications(1);
  }

  applyFilters(): void {
    this.fetchNotifications(1);
  }

  resetFilters(): void {
    this.search = '';
    this.from = '';
    this.to = '';
    this.typeFilter = '';
    this.unreadOnly = false;
    this.roleFilter = '';
    this.selectedUserId = '';
    this.fetchNotifications(1);
  }

  fetchNotifications(page = this.page): void {
    this.loading = true;
    this.page = page;
    this.statusMessage = '';

    const query: any = {
      page: this.page,
      limit: 10,
      search: this.search || undefined,
      type: this.typeFilter || undefined,
      unread: this.unreadOnly || undefined,
      role: this.canFilterRole ? (this.roleFilter || undefined) : undefined,
      userId: this.selectedUserId || undefined,
      organizationId: this.selectedOrganizationId || undefined,
      teamId: this.selectedTeamId || undefined,
      includeAllOrgs: !this.selectedOrganizationId
    };

    if (this.from) query.from = this.toStartOfDayIso(this.from);
    if (this.to) query.to = this.toEndOfDayIso(this.to);

    this.notificationService.getNotifications(query).subscribe({
      next: (res) => {
        this.notifications = Array.isArray(res?.notifications) ? res.notifications : [];
        this.unreadCount = Number(res?.unreadCount || 0);
        this.total = Number(res?.total || 0);
        this.totalPages = Number(res?.totalPages || 1);
        this.loading = false;
        this.cdr.markForCheck();
        if (this.notifications.length === 0) {
          this.statusMessage = 'No notifications found.';
        }
      },
      error: () => {
        this.notifications = [];
        this.loading = false;
        this.cdr.markForCheck();
        this.statusMessage = 'Failed to load notifications.';
      }
    });
  }

  markAsRead(notification: AppNotification): void {
    if (notification.isRead) return;
    this.notificationService.markAsRead(notification._id, {
      organizationId: this.selectedOrganizationId || undefined,
      teamId: this.selectedTeamId || undefined
    }).subscribe({
      next: () => {
        notification.isRead = true;
        this.unreadCount = Math.max(0, this.unreadCount - 1);
      },
      error: () => null
    });
  }

  deleteNotification(notification: AppNotification): void {
    const confirmed = globalThis.confirm('Delete this notification?');
    if (!confirmed) return;

    this.notificationService.deleteNotification(notification._id, {
      organizationId: this.selectedOrganizationId || undefined,
      teamId: this.selectedTeamId || undefined
    }).subscribe({
      next: () => {
        this.notifications = this.notifications.filter((item) => item._id !== notification._id);
        this.total = Math.max(0, this.total - 1);
        if (!notification.isRead) {
          this.unreadCount = Math.max(0, this.unreadCount - 1);
        }
        if (this.notifications.length === 0 && this.page > 1) {
          this.fetchNotifications(this.page - 1);
          return;
        }
        if (this.notifications.length === 0) {
          this.statusMessage = 'No notifications found.';
        }
      },
      error: () => {
        this.statusMessage = 'Failed to delete notification.';
      }
    });
  }

  formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString();
  }

  fmtUser(option: UserOption): string {
    return option.name || option.githubUsername || option.email || 'User';
  }
}
