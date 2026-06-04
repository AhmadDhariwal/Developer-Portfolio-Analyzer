import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import { AdminConsoleService, ConsoleTeam } from '../admin-console/admin-console.service';
import { SearchableSelectComponent, SearchableSelectOption } from '../../../shared/components/searchable-select/searchable-select.component';

interface AuditActor {
  _id: string;
  name?: string;
  email?: string;
  githubUsername?: string;
  role?: string;
}

interface AuditLogItem {
  _id: string;
  actor: AuditActor | null;
  action: string;
  method: string;
  route: string;
  before: unknown;
  after: unknown;
  statusCode: number;
  timestamp: string;
}

interface EmailDeliveryDetails {
  provider: string | null;
  deliveryStatus: string;
}

interface UserOption {
  _id: string;
  name?: string;
  email?: string;
  githubUsername?: string;
  role?: string;
}

@Component({
  selector: 'app-admin-activity-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  templateUrl: './admin-activity-logs.component.html',
  styleUrl: '../../../pages/activity-logs/activity-logs.component.scss'
})
export class AdminActivityLogsComponent implements OnInit {
  logs: AuditLogItem[] = [];
  selectedLog: AuditLogItem | null = null;
  teams: ConsoleTeam[] = [];
  userOptions: UserOption[] = [];
  actionOptions: string[] = [];
  selectedTeamId = '';
  selectedActorId = '';
  page = 1;
  totalPages = 1;
  total = 0;
  loading = false;
  statusMessage = '';

  action = '';
  from = '';
  to = '';

  orgName = 'Organization';
  organizationId = '';
  currentUserId = '';

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly tenantContext: TenantContextService,
    private readonly consoleService: AdminConsoleService
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUser();
    this.currentUserId = String(currentUser?._id || '');
    const role = String(currentUser?.role || '').toLowerCase();
    this.selectedActorId = role === 'admin' ? '' : this.currentUserId;
    this.ensureDefaultDateRange();

    this.tenantContext.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.organizationId = state.organizationId || '';
        this.orgName = state.organizationName || 'Organization';
        this.loadTeams();
      });
  }

  private ensureDefaultDateRange(): void {
    if (this.from && this.to) return;
    const today = new Date();
    const todayText = this.toDateString(today);
    if (!this.from) this.from = todayText;
    if (!this.to) this.to = todayText;
  }

  private toDateString(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private toStartOfDayIso(dateInput: string): string {
    const [y, m, d] = dateInput.split('-').map((value) => Number.parseInt(value, 10));
    if (!y || !m || !d) return new Date(dateInput).toISOString();
    return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
  }

  private toEndOfDayIso(dateInput: string): string {
    const [y, m, d] = dateInput.split('-').map((value) => Number.parseInt(value, 10));
    if (!y || !m || !d) return new Date(dateInput).toISOString();
    return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
  }

  get availableActors(): UserOption[] {
    if (!this.selectedTeamId) {
      return this.userOptions;
    }

    const team = this.teams.find((item) => item._id === this.selectedTeamId);
    return Array.isArray(team?.members)
      ? team.members.map((member) => ({
          _id: member._id,
          name: member.name,
          email: member.email,
          role: member.role
        }))
      : [];
  }

  private refreshActorSelection(): void {
    if (!this.selectedActorId) return;
    if (this.availableActors.some((actor) => actor._id === this.selectedActorId)) return;
    this.selectedActorId = this.selectedTeamId ? '' : this.currentUserId;
    if (this.selectedActorId && this.availableActors.some((actor) => actor._id === this.selectedActorId)) return;
    if (this.selectedActorId === this.currentUserId && !this.selectedTeamId) return;
    this.selectedActorId = '';
  }

  loadTeams(): void {
    if (!this.organizationId) {
      this.teams = [];
      this.userOptions = this.currentUserId ? [{ _id: this.currentUserId, name: 'My activity only' }] : [];
      this.refreshActorSelection();
      this.fetchLogs();
      return;
    }

    this.consoleService.getTeams()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.teams = Array.isArray(res?.teams) ? res.teams : [];
          const users = new Map<string, UserOption>();
          this.teams.forEach((team) => {
            team.members.forEach((member) => {
              users.set(member._id, {
                _id: member._id,
                name: member.name,
                email: member.email,
                role: member.role
              });
            });
          });
          const currentUser = this.authService.getCurrentUser();
          if (this.currentUserId) {
            users.set(this.currentUserId, {
              _id: this.currentUserId,
              name: String(currentUser?.name || 'My activity'),
              email: String(currentUser?.email || ''),
              role: String(currentUser?.role || 'admin')
            });
          }
          this.userOptions = Array.from(users.values());
          this.refreshActorSelection();
          this.cdr.markForCheck();
          this.fetchLogs();
        },
        error: () => {
          this.teams = [];
          this.userOptions = this.currentUserId ? [{ _id: this.currentUserId, name: 'My activity only' }] : [];
          this.refreshActorSelection();
          this.cdr.markForCheck();
          this.fetchLogs();
        }
      });
  }

  onTeamChange(): void {
    this.selectedActorId = '';
    this.refreshActorSelection();
    this.cdr.markForCheck();
  }

  get teamSelectOptions(): SearchableSelectOption[] {
    return this.teams.map((team) => ({
      value: team._id,
      label: team.name,
      meta: `${team.members?.length || 0} members`
    }));
  }

  get actorSelectOptions(): SearchableSelectOption[] {
    return this.availableActors.map((actor) => ({
      value: actor._id,
      label: this.fmtActorOption(actor),
      meta: [actor.email, actor.role].filter(Boolean).join(' • ')
    }));
  }

  get actionSelectOptions(): SearchableSelectOption[] {
    return this.actionOptions.map((action) => ({
      value: action,
      label: action
    }));
  }

  applyFilters(): void {
    this.fetchLogs(1);
  }

  resetFilters(): void {
    this.selectedTeamId = '';
    const currentUser = this.authService.getCurrentUser();
    const role = String(currentUser?.role || '').toLowerCase();
    this.selectedActorId = role === 'admin' ? '' : this.currentUserId;
    this.action = '';
    this.actionOptions = [];
    const today = new Date();
    this.from = this.toDateString(today);
    this.to = this.toDateString(today);
    this.fetchLogs(1);
  }

  fetchLogs(page = this.page): void {
    this.ensureDefaultDateRange();
    this.loading = true;
    this.cdr.markForCheck();
    this.page = page;

    const params: {
      actor?: string;
      action?: string;
      organizationId?: string;
      teamId?: string;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    } = {
      actor: this.selectedActorId || undefined,
      action: this.action || undefined,
      organizationId: this.organizationId || undefined,
      teamId: this.selectedTeamId || undefined,
      page: this.page,
      limit: 20
    };

    if (this.from) params.from = this.toStartOfDayIso(this.from);
    if (this.to) params.to = this.toEndOfDayIso(this.to);

    this.apiService.getAuditLogs(params)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (res) => {
          this.logs = Array.isArray(res?.logs) ? res.logs : [];
          this.total = Number(res?.total || 0);
          this.totalPages = Number(res?.totalPages || 1);
          this.actionOptions = Array.isArray(res?.actionOptions)
            ? res.actionOptions.map((value: unknown) => String(value || '')).filter(Boolean)
            : [];
          const actors = Array.isArray(res?.actorOptions) ? res.actorOptions : [];
          if (!this.selectedTeamId) {
            const scopedUsers = new Map<string, UserOption>();
            actors.forEach((actor: UserOption) => {
              if (!actor?._id) return;
              scopedUsers.set(actor._id, actor);
            });
            if (this.currentUserId && !scopedUsers.has(this.currentUserId)) {
              const currentUser = this.authService.getCurrentUser();
              scopedUsers.set(this.currentUserId, {
                _id: this.currentUserId,
                name: String(currentUser?.name || 'My activity'),
                email: String(currentUser?.email || ''),
                role: String(currentUser?.role || 'admin')
              });
            }
            this.userOptions = Array.from(scopedUsers.values());
            this.refreshActorSelection();
          }
          this.selectedLog = this.logs[0] || null;
          this.statusMessage = '';
        },
        error: (err) => {
          this.logs = [];
          this.selectedLog = null;
          this.statusMessage = err?.error?.message || 'Failed to load activity logs.';
        }
      });
  }

  openDetail(log: AuditLogItem): void {
    this.selectedLog = log;
  }

  deleteLog(log: AuditLogItem): void {
    if (!log?._id) return;
    const confirmed = globalThis.confirm('Delete this activity log?');
    if (!confirmed) return;

    this.apiService.deleteAuditLog(log._id, {
      organizationId: this.organizationId || undefined
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.logs = this.logs.filter((item) => item._id !== log._id);
          if (this.selectedLog?._id === log._id) {
            this.selectedLog = this.logs[0] || null;
          }
          if (this.logs.length === 0 && this.page > 1) {
            this.fetchLogs(this.page - 1);
          } else {
            this.cdr.markForCheck();
          }
        },
        error: (err) => {
          this.statusMessage = err?.error?.message || 'Failed to delete log.';
          this.cdr.markForCheck();
        }
      });
  }

  fmtActor(actor: AuditActor | null): string {
    if (!actor) return 'System';
    return actor.name || actor.githubUsername || actor.email || 'User';
  }

  fmtActorOption(actor: UserOption): string {
    return actor.name || actor.githubUsername || actor.email || 'User';
  }

  toJson(data: unknown): string {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return 'Unable to render payload';
    }
  }

  isEmailDeliveryLog(log: AuditLogItem): boolean {
    return String(log?.action || '') === 'EMAIL_INVITATION_DELIVERY';
  }

  getEmailDeliveryDetails(log: AuditLogItem): EmailDeliveryDetails | null {
    if (!this.isEmailDeliveryLog(log)) return null;
    const after = (log?.after as Record<string, unknown>) || {};
    const provider = typeof after['provider'] === 'string' ? after['provider'] : null;
    let deliveryStatus = 'failed';
    if (typeof after['deliveryStatus'] === 'string') {
      deliveryStatus = after['deliveryStatus'];
    } else if (after['sent']) {
      deliveryStatus = 'delivered';
    }

    return { provider, deliveryStatus };
  }

  formatDeliveryLabel(status: string): string {
    return status.replaceAll('_', ' ');
  }

  deliveryBadgeClass(status: string): string {
    if (status === 'delivered') return 'delivery-delivered';
    if (status === 'provider_not_configured') return 'delivery-provider-not-configured';
    return 'delivery-failed';
  }
}
