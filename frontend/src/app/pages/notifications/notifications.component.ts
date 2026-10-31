import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { notificationTarget } from '../../shared/utils/notification-navigation';
import { NotificationBulkActionsComponent } from './components/notification-bulk-actions/notification-bulk-actions.component';
import {
  NotificationService,
  AppNotification,
  NotificationQuery,
} from '../../shared/services/notification.service';
import { ApiService } from '../../shared/services/api.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationConfirmDialogComponent } from './components/notification-confirm-dialog/notification-confirm-dialog.component';

interface OrganizationItem {
  _id: string;
  name: string;
  myRole: 'admin' | 'manager' | 'member';
}

interface TeamItem {
  _id: string;
  name: string;
}

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NotificationConfirmDialogComponent,
    NotificationBulkActionsComponent,
  ],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent implements OnInit {
  notifications: AppNotification[] = [];
  loading = false;
  loadFailed = false;
  markingAllRead = false;
  statusMessage = '';
  unreadCount = 0;
  page = 1;
  totalPages = 1;
  total = 0;
  filteredUnreadCount = 0;
  selectedIds = new Set<string>();
  showBulkDeleteDialog = false;
  deletingSelected = false;
  private inboxRequest?: Subscription;
  private readonly pageCursors = new Map<number, string>();
  private readonly router = inject(Router);

  showDeleteDialog = false;
  pendingDeleteNotification: AppNotification | null = null;

  search = '';
  from = '';
  to = '';
  typeFilter = '';
  unreadOnly = false;
  selectedOrganizationId = '';
  selectedTeamId = '';

  organizations: OrganizationItem[] = [];
  teams: TeamItem[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly typeOptions = [
    { value: '', label: 'All types' },
    { value: 'profile_update', label: 'Profile update' },
    { value: 'resume_upload', label: 'Resume upload' },
    { value: 'github_update', label: 'GitHub update' },
    { value: 'low_score', label: 'Low score' },
    { value: 'career_update', label: 'Career update' },
    { value: 'system', label: 'System' },
    { value: 'success', label: 'Success' },
    { value: 'warning', label: 'Warning' },
    { value: 'info', label: 'Information' },
    { value: 'error', label: 'Error' },
  ];

  constructor(
    private readonly notificationService: NotificationService,
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    this.loadOrganizations();

    this.destroyRef.onDestroy(() => this.inboxRequest?.unsubscribe());

    this.notificationService.streamEvents$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.fetchNotifications(this.page, true));
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
    this.apiService
      .getOrganizations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
          this.loadTeams();
          // Always fetch notifications
          this.fetchNotifications(1);
        },
        error: () => {
          this.organizations = [];
          // Fetch notifications even if org loading fails
          this.fetchNotifications(1);
        },
      });
  }

  loadTeams(): void {
    if (!this.selectedOrganizationId) {
      this.teams = [];
      this.selectedTeamId = '';
      return;
    }

    this.apiService
      .getTeams(this.selectedOrganizationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.teams = Array.isArray(res?.teams) ? res.teams : [];
          if (this.selectedTeamId && !this.teams.some((team) => team._id === this.selectedTeamId)) {
            this.selectedTeamId = '';
          }
        },
        error: () => {
          this.teams = [];
        },
      });
  }

  onOrganizationChange(): void {
    this.selectedTeamId = '';
    this.loadTeams();
    this.fetchNotifications(1);
  }

  onTeamChange(): void {
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
    this.fetchNotifications(1);
  }

  markAllAsRead(): void {
    if (this.markingAllRead || this.unreadCount === 0) return;
    this.markingAllRead = true;
    this.notificationService
      .markAllAsRead({
        organizationId: this.selectedOrganizationId || undefined,
        teamId: this.selectedTeamId || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.markingAllRead = false;
          this.fetchNotifications(this.page, true);
          this.statusMessage = result.message;
          this.cdr.markForCheck();
        },
        error: () => {
          this.markingAllRead = false;
          this.statusMessage = 'Failed to mark notifications as read.';
          this.cdr.markForCheck();
        },
      });
  }

  toggleSelection(notification: AppNotification): void {
    const selected = new Set(this.selectedIds);
    if (selected.has(notification._id)) selected.delete(notification._id);
    else selected.add(notification._id);
    this.selectedIds = selected;
  }

  clearSelection(): void {
    this.selectedIds = new Set();
  }

  deleteSelected(): void {
    if (!this.selectedIds.size || this.deletingSelected) return;
    this.showBulkDeleteDialog = false;
    this.deletingSelected = true;
    this.notificationService
      .bulkDelete([...this.selectedIds])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deletingSelected = false;
          this.selectedIds = new Set();
          this.fetchNotifications(1, true);
        },
        error: () => {
          this.deletingSelected = false;
          this.statusMessage = 'Failed to delete selected notifications.';
          this.cdr.markForCheck();
        },
      });
  }

  openNotification(notification: AppNotification): void {
    this.markAsRead(notification);
    void this.router.navigateByUrl(notificationTarget(notification));
  }

  fetchNotifications(page = this.page, forceRefresh = false): void {
    this.inboxRequest?.unsubscribe();
    if (page === 1) this.pageCursors.clear();
    this.loading = true;
    this.loadFailed = false;
    this.page = page;
    this.statusMessage = '';

    const query: NotificationQuery = {
      page: this.pageCursors.has(page) ? undefined : this.page,
      cursor: this.pageCursors.get(page),
      limit: 10,
      search: this.search || undefined,
      type: this.typeFilter || undefined,
      unread: this.unreadOnly || undefined,
      organizationId: this.selectedOrganizationId || undefined,
      teamId: this.selectedTeamId || undefined,
    };

    if (this.from) query.from = this.toStartOfDayIso(this.from);
    if (this.to) query.to = this.toEndOfDayIso(this.to);

    const user = this.authService.getCurrentUser();
    const signature = String(user?._id || user?.email || 'current-user');
    this.inboxRequest = this.notificationService
      .getNotifications(query, signature, forceRefresh)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.notifications = Array.isArray(res?.notifications) ? res.notifications : [];
          this.unreadCount = Number(res?.unreadCount || 0);
          this.total = Number(res?.total || 0);
          this.filteredUnreadCount = Number(res?.filteredUnreadCount ?? this.unreadCount);
          this.selectedIds = new Set(
            [...this.selectedIds].filter((id) =>
              this.notifications.some((item) => item._id === id),
            ),
          );
          this.totalPages = Number(res?.totalPages || 1);
          if (res.nextCursor) this.pageCursors.set(page + 1, res.nextCursor);
          this.loading = false;
          this.cdr.markForCheck();
          if (this.notifications.length === 0) {
            this.statusMessage = 'No notifications found.';
          }
        },
        error: () => {
          this.loadFailed = true;
          this.loading = false;
          this.cdr.markForCheck();
          this.statusMessage = 'Failed to load notifications.';
        },
      });
  }

  markAsRead(notification: AppNotification): void {
    if (notification.isRead) return;
    const previousUnread = this.unreadCount;
    notification.isRead = true;
    this.unreadCount = Math.max(0, previousUnread - 1);
    this.notificationService
      .markAsRead(notification._id, {
        organizationId: this.selectedOrganizationId || undefined,
        teamId: this.selectedTeamId || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.cdr.markForCheck(),
        error: () => {
          notification.isRead = false;
          this.unreadCount = previousUnread;
          this.statusMessage = 'Failed to mark notification as read.';
          this.cdr.markForCheck();
        },
      });
  }

  askDelete(notification: AppNotification): void {
    this.pendingDeleteNotification = notification;
    this.showDeleteDialog = true;
  }

  confirmDelete(): void {
    if (!this.pendingDeleteNotification) {
      this.showDeleteDialog = false;
      return;
    }
    const notification = this.pendingDeleteNotification;
    this.showDeleteDialog = false;
    this.pendingDeleteNotification = null;

    const snapshot = [...this.notifications];
    const previousTotal = this.total;
    const previousUnread = this.unreadCount;
    this.notifications = this.notifications.filter((item) => item._id !== notification._id);
    this.total = Math.max(0, this.total - 1);
    if (!notification.isRead) this.unreadCount = Math.max(0, this.unreadCount - 1);

    this.notificationService
      .deleteNotification(notification._id, {
        organizationId: this.selectedOrganizationId || undefined,
        teamId: this.selectedTeamId || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.notifications.length === 0 && this.page > 1) {
            this.fetchNotifications(this.page - 1);
            return;
          }
          if (this.notifications.length === 0) {
            this.statusMessage = 'No notifications found.';
          }
        },
        error: () => {
          this.notifications = snapshot;
          this.total = previousTotal;
          this.unreadCount = previousUnread;
          this.statusMessage = 'Failed to delete notification.';
          this.cdr.markForCheck();
        },
      });
  }

  cancelDelete(): void {
    this.showDeleteDialog = false;
    this.pendingDeleteNotification = null;
  }

  formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString();
  }

  getNotificationTone(notification: AppNotification): string {
    switch (notification.type) {
      case 'low_score':
        return 'warning';
      case 'resume_upload':
        return 'success';
      case 'github_update':
        return 'info';
      case 'career_update':
        return 'purple';
      case 'profile_update':
        return 'neutral';
      default:
        return 'system';
    }
  }

  getNotificationIcon(notification: AppNotification): string {
    switch (notification.type) {
      case 'profile_update':
        return 'user';
      case 'resume_upload':
        return 'file';
      case 'github_update':
        return 'github';
      case 'low_score':
        return 'alert';
      case 'career_update':
        return 'spark';
      default:
        return 'bell';
    }
  }

  getNotificationTypeLabel(notification: AppNotification): string {
    return notification.type.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  getReadRate(): number {
    if (this.total <= 0) return 0;
    return Math.max(
      0,
      Math.min(100, Math.round(((this.total - this.filteredUnreadCount) / this.total) * 100)),
    );
  }

  getActiveFiltersCount(): number {
    return [
      this.search,
      this.from,
      this.to,
      this.typeFilter,
      this.unreadOnly ? 'unread' : '',
      this.selectedOrganizationId,
      this.selectedTeamId,
    ].filter(Boolean).length;
  }

  getRelativeTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }
}
