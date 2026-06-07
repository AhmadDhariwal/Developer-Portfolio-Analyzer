import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { Subscription } from 'rxjs';
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
  actionCategory?: string;
  method: string;
  route: string;
  before: unknown;
  after: unknown;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

interface UserOption {
  _id: string;
  name?: string;
  email?: string;
  githubUsername?: string;
  role?: string;
}

interface ActiveFilter {
  type: string;
  label: string;
  clear: () => void;
}

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /otp/i,
  /passcode/i,
  /pwd/i,
  /pass[_-]?phrase/i,
  /private[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i
];

@Component({
  selector: 'app-admin-activity-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  templateUrl: './admin-activity-logs.component.html',
  styleUrls: [
    '../../../pages/activity-logs/activity-logs.component.scss',
    './admin-activity-logs.component.scss'
  ]
})
export class AdminActivityLogsComponent implements OnInit {
  logs: AuditLogItem[] = [];
  filteredLogs: AuditLogItem[] = [];
  selectedLog: AuditLogItem | null = null;
  teams: ConsoleTeam[] = [];
  userOptions: UserOption[] = [];
  actionOptions: string[] = [];
  readonly actionCategoryOptions = ['auth', 'organization', 'team', 'job', 'candidate', 'invitation', 'ai', 'email', 'settings', 'admin', 'recruiter', 'developer', 'system', 'other'];
  readonly methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  selectedTeamId = '';
  selectedActorId = '';
  page = 1;
  totalPages = 1;
  total = 0;
  limit = 20;
  loading = false;
  exporting = false;
  statusMessage = '';

  action = '';
  selectedMethod = '';
  selectedStatusCode = '';
  selectedActionCategory = '';
  from = '';
  to = '';
  quickSearch = '';

  orgName = 'Organization';
  organizationId = '';
  currentUserId = '';

  private pendingRequest: Subscription | null = null;
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

  get activeFilters(): ActiveFilter[] {
    const filters: ActiveFilter[] = [];
    if (this.selectedTeamId) {
      const team = this.teams.find((t) => t._id === this.selectedTeamId);
      filters.push({ type: 'Team', label: team?.name || 'Team', clear: () => { this.selectedTeamId = ''; this.applyFilters(); } });
    }
    if (this.selectedActorId && this.selectedActorId !== this.currentUserId) {
      const user = this.userOptions.find((u) => u._id === this.selectedActorId);
      filters.push({ type: 'User', label: user?.name || user?.email || 'User', clear: () => { this.selectedActorId = ''; this.applyFilters(); } });
    }
    if (this.action) {
      filters.push({ type: 'Action', label: this.action, clear: () => { this.action = ''; this.applyFilters(); } });
    }
    if (this.selectedMethod) {
      filters.push({ type: 'Method', label: this.selectedMethod, clear: () => { this.selectedMethod = ''; this.applyFilters(); } });
    }
    if (this.selectedStatusCode) {
      filters.push({ type: 'Status', label: this.selectedStatusCode, clear: () => { this.selectedStatusCode = ''; this.applyFilters(); } });
    }
    if (this.selectedActionCategory) {
      filters.push({ type: 'Category', label: this.titleCase(this.selectedActionCategory), clear: () => { this.selectedActionCategory = ''; this.applyFilters(); } });
    }
    if (this.from || this.to) {
      filters.push({
        type: 'Date',
        label: `${this.from || 'Any'} to ${this.to || 'Any'}`,
        clear: () => {
          const today = new Date();
          this.from = this.toDateString(today);
          this.to = this.toDateString(today);
          this.applyFilters();
        }
      });
    }
    return filters;
  }

  get hasActiveFilters(): boolean {
    return !!this.selectedTeamId
      || (!!this.selectedActorId && this.selectedActorId !== this.currentUserId)
      || !!this.action
      || !!this.selectedMethod
      || !!this.selectedStatusCode
      || !!this.selectedActionCategory;
  }

  methodBadgeClass(method: string): string {
    switch (method?.toUpperCase()) {
      case 'POST': return 'method-badge--post';
      case 'PUT':
      case 'PATCH': return 'method-badge--put';
      case 'DELETE': return 'method-badge--delete';
      default: return 'method-badge--get';
    }
  }

  statusBadgeClass(code: number): string {
    if (code >= 200 && code < 300) return 'status-code--ok';
    if (code >= 300 && code < 400) return 'status-code--warn';
    if (code >= 400) return 'status-code--err';
    return '';
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

  get methodSelectOptions(): SearchableSelectOption[] {
    return this.methodOptions.map((method) => ({
      value: method,
      label: method
    }));
  }

  get actionCategorySelectOptions(): SearchableSelectOption[] {
    return this.actionCategoryOptions.map((category) => ({
      value: category,
      label: this.titleCase(category)
    }));
  }

  onQuickSearchChange(): void {
    this.filteredLogs = this.performQuickSearch();
  }

  private performQuickSearch(): AuditLogItem[] {
    const query = this.quickSearch.trim().toLowerCase();
    if (!query) return [...this.logs];
    return this.logs.filter(
      (log) =>
        this.fmtActor(log.actor).toLowerCase().includes(query) ||
        (log.action || '').toLowerCase().includes(query) ||
        (log.actionCategory || '').toLowerCase().includes(query) ||
        (log.method || '').toLowerCase().includes(query) ||
        (log.route || '').toLowerCase().includes(query) ||
        String(log.statusCode || '').includes(query)
    );
  }

  applyFilters(): void {
    this.quickSearch = '';
    this.page = 1;
    this.fetchLogs(1);
  }

  resetFilters(): void {
    this.selectedTeamId = '';
    const currentUser = this.authService.getCurrentUser();
    const role = String(currentUser?.role || '').toLowerCase();
    this.selectedActorId = role === 'admin' ? '' : this.currentUserId;
    this.action = '';
    this.selectedMethod = '';
    this.selectedStatusCode = '';
    this.selectedActionCategory = '';
    this.actionOptions = [];
    this.quickSearch = '';
    const today = new Date();
    this.from = this.toDateString(today);
    this.to = this.toDateString(today);
    this.fetchLogs(1);
  }

  fetchLogs(page = this.page): void {
    // Prevent duplicate API calls
    if (this.pendingRequest) {
      this.pendingRequest.unsubscribe();
      this.pendingRequest = null;
    }

    this.ensureDefaultDateRange();
    this.loading = true;
    this.cdr.markForCheck();
    this.page = page;

    const params: {
      actor?: string;
      action?: string;
      teamId?: string;
      method?: string;
      statusCode?: string;
      actionCategory?: string;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    } = {
      actor: this.selectedActorId || undefined,
      action: this.action || undefined,
      teamId: this.selectedTeamId || undefined,
      method: this.selectedMethod || undefined,
      statusCode: this.selectedStatusCode || undefined,
      actionCategory: this.selectedActionCategory || undefined,
      page: this.page,
      limit: this.limit
    };

    if (this.from) params.from = this.toStartOfDayIso(this.from);
    if (this.to) params.to = this.toEndOfDayIso(this.to);

    this.pendingRequest = this.apiService.getAuditLogs(params)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.loading = false;
          this.pendingRequest = null;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (res) => {
          this.logs = Array.isArray(res?.logs) ? res.logs : [];
          this.filteredLogs = this.performQuickSearch();
          this.total = Number(res?.total || 0);
          this.limit = Number(res?.limit || 20);
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
          const selectedLogId = this.selectedLog?._id;
          this.selectedLog = this.logs.find((entry) => entry._id === selectedLogId) || this.logs[0] || null;
          this.statusMessage = '';
        },
        error: (err) => {
          this.logs = [];
          this.filteredLogs = [];
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
    const confirmed = globalThis.confirm('Archive this activity log entry?');
    if (!confirmed) return;

    this.apiService.deleteAuditLog(log._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.logs = this.logs.filter((item) => item._id !== log._id);
          this.filteredLogs = this.performQuickSearch();
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
          this.statusMessage = err?.error?.message || 'Failed to archive log.';
          this.cdr.markForCheck();
        }
      });
  }

  exportCSV(): void {
    if (this.filteredLogs.length === 0) return;
    this.exporting = true;
    try {
      const headers = ['Timestamp', 'User', 'Method', 'Action', 'Route', 'Status Code', 'IP Address'];
      const rows = this.filteredLogs.map((log) => [
        log.timestamp,
        this.fmtActor(log.actor),
        log.method,
        log.action,
        log.route,
        String(log.statusCode),
        log.ipAddress || ''
      ]);
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      this.exporting = false;
      this.cdr.markForCheck();
    }
  }

  fmtActor(actor: AuditActor | null): string {
    if (!actor) return 'System';
    return actor.name || actor.githubUsername || actor.email || 'User';
  }

  fmtActorOption(actor: UserOption): string {
    return actor.name || actor.githubUsername || actor.email || 'User';
  }

  getFullTimestamp(log: AuditLogItem): string {
    if (!log?.timestamp) return '';
    const date = new Date(log.timestamp);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  }

  titleCase(value: string): string {
    return String(value || '')
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  maskSensitive = (data: unknown): unknown => {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) {
      return data.map((item) => (typeof item === 'object' && item !== null ? this.maskSensitive(item) : item));
    }
    if (typeof data !== 'object') return data;

    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        masked[key] = '***MASKED***';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskSensitive(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  };

  toJson(data: unknown): string {
    try {
      const safe = this.maskSensitive(data);
      return JSON.stringify(safe, null, 2);
    } catch {
      return 'Unable to render payload';
    }
  }

  isEmailDeliveryLog(log: AuditLogItem): boolean {
    return String(log?.action || '') === 'EMAIL_INVITATION_DELIVERY';
  }
}
