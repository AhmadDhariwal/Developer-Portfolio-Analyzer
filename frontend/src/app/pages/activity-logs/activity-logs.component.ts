import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../shared/services/auth.service';
import { SuperAdminService } from '../../super-admin/shared/super-admin.service';
import { SearchableSelectComponent, SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';

interface AuditActor {
  _id?: string;
  name?: string;
  email?: string;
  githubUsername?: string;
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

interface OrganizationItem {
  _id: string;
  name: string;
  myRole: 'admin' | 'manager' | 'member';
}

interface TeamItem {
  _id: string;
  name: string;
  organizationId?: string | { _id?: string; name?: string };
}

interface ActorOption {
  _id: string;
  name?: string;
  email?: string;
  githubUsername?: string;
  role?: 'super_admin' | 'admin' | 'recruiter' | 'developer' | 'manager' | 'member';
}

@Component({
  selector: 'app-activity-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  templateUrl: './activity-logs.component.html',
  styleUrl: './activity-logs.component.scss'
})
export class ActivityLogsComponent implements OnInit {
  logs: AuditLogItem[] = [];
  selectedLog: AuditLogItem | null = null;
  organizations: OrganizationItem[] = [];
  teams: TeamItem[] = [];
  actorOptions: ActorOption[] = [];
  actionOptions: string[] = [];
  selectedOrganizationId = '';
  selectedTeamId = '';
  page = 1;
  totalPages = 1;
  total = 0;
  loading = false;
  statusMessage = '';

  actor = '';
  action = '';
  from = '';
  to = '';
  selectedRole = '';
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly superAdminService: SuperAdminService
  ) {}

  ngOnInit(): void {
    this.ensureDefaultDateRange();
    this.loadOrganizations();
  }

  private ensureDefaultDateRange(): void {
    if (this.from && this.to) return;
    const today = new Date();
    const todayText = this.toDateString(today);
    if (!this.from) this.from = todayText;
    if (!this.to) this.to = todayText;
  }

  get hasOrgScopedActorOptions(): boolean {
    return this.actorOptions.length > 0;
  }

  get organizationSelectOptions(): SearchableSelectOption[] {
    return this.organizations.map((organization) => ({
      value: organization._id,
      label: organization.name
    }));
  }

  get teamSelectOptions(): SearchableSelectOption[] {
    return this.teams.map((team) => ({
      value: team._id,
      label: team.name
    }));
  }

  get roleSelectOptions(): SearchableSelectOption[] {
    return [
      { value: 'super_admin', label: 'Super Admin' },
      { value: 'admin', label: 'Admin' },
      { value: 'recruiter', label: 'Recruiter' },
      { value: 'developer', label: 'Developer' }
    ];
  }

  get actorSelectOptions(): SearchableSelectOption[] {
    return this.actorOptions.map((actor) => ({
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

  get isSuperAdmin(): boolean {
    const role = String(this.authService.getCurrentUser()?.role || '').toLowerCase();
    return role === 'super_admin' || role === 'superadmin';
  }

  private toDateString(d: Date): string {
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
      role?: string;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    } = {
      actor: this.actor || undefined,
      action: this.action || undefined,
      organizationId: this.selectedOrganizationId || undefined,
      teamId: this.selectedTeamId || undefined,
      role: this.selectedRole || undefined,
      page: this.page,
      limit: 20
    };

    if (this.from) {
      params.from = this.toStartOfDayIso(this.from);
    }

    if (this.to) {
      params.to = this.toEndOfDayIso(this.to);
    }

    this.apiService.getAuditLogs(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        this.logs = Array.isArray(res?.logs) ? res.logs : [];
        this.total = Number(res?.total || 0);
        this.totalPages = Number(res?.totalPages || 1);
        this.actorOptions = Array.isArray(res?.actorOptions) ? res.actorOptions : [];
        this.actionOptions = Array.isArray(res?.actionOptions)
          ? res.actionOptions.map((value: unknown) => String(value || '')).filter(Boolean)
          : [];
        this.selectedLog = this.logs[0] || null;
        this.loading = false;
        this.cdr.markForCheck();
        this.statusMessage = '';
      },
      error: () => {
        this.logs = [];
        this.actorOptions = [];
        this.selectedLog = null;
        this.loading = false;
        this.cdr.markForCheck();
        this.statusMessage = 'Failed to load activity logs.';
      }
    });
  }

  loadOrganizations(): void {
    if (this.isSuperAdmin) {
      this.superAdminService.getOrganizations({ page: '1', limit: '100' })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.ensureDefaultDateRange();
            this.organizations = Array.isArray(res?.organizations)
              ? res.organizations.map((org: any) => ({
                  _id: org._id,
                  name: org.name,
                  myRole: 'admin'
                }))
              : [];
            this.loadTeams();
            this.loadActorOptions();
            this.cdr.markForCheck();
            this.fetchLogs();
          },
          error: () => {
            this.ensureDefaultDateRange();
            this.organizations = [];
            this.teams = [];
            this.actorOptions = [];
            this.cdr.markForCheck();
            this.fetchLogs();
          }
        });
      return;
    }

    this.apiService.getOrganizations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        this.ensureDefaultDateRange();
        this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
        this.cdr.markForCheck();
        this.fetchLogs();
      },
      error: () => {
        this.ensureDefaultDateRange();
        this.organizations = [];
        this.cdr.markForCheck();
        this.fetchLogs();
      }
    });
  }

  onOrganizationChange(): void {
    this.selectedTeamId = '';
    this.actor = '';
    this.actorOptions = [];
    this.loadTeams();
    this.loadActorOptions();
    this.cdr.markForCheck();
  }

  onTeamChange(): void {
    this.actor = '';
    this.actorOptions = [];
    this.loadActorOptions();
    this.cdr.markForCheck();
  }

  onRoleChange(): void {
    this.actor = '';
    this.actorOptions = [];
    this.loadActorOptions();
    this.cdr.markForCheck();
  }

  applyFilters(): void {
    this.fetchLogs(1);
  }

  resetFilters(): void {
    this.actor  = '';
    this.action = '';
    this.selectedRole = '';
    this.selectedOrganizationId = '';
    this.selectedTeamId = '';
    this.actorOptions = [];
    this.actionOptions = [];
    const today = new Date();
    this.from = this.toDateString(today);
    this.to   = this.toDateString(today);
    this.loadTeams();
    this.loadActorOptions();
    this.fetchLogs(1);
  }

  private loadTeams(): void {
    if (!this.isSuperAdmin) return;

    const params: Record<string, string> = { page: '1', limit: '200' };
    if (this.selectedOrganizationId) {
      params['organizationId'] = this.selectedOrganizationId;
    }

    this.superAdminService.getTeams(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.teams = Array.isArray(res?.teams)
            ? res.teams.map((team: any) => ({
                _id: String(team._id || ''),
                name: String(team.name || 'Unnamed team'),
                organizationId: team.organizationId
              })).filter((team: TeamItem) => team._id)
            : [];

          if (this.selectedTeamId && !this.teams.some((team) => team._id === this.selectedTeamId)) {
            this.selectedTeamId = '';
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.teams = [];
          this.selectedTeamId = '';
          this.cdr.markForCheck();
        }
      });
  }

  private loadActorOptions(): void {
    if (!this.isSuperAdmin) return;

    const requests: any[] = [];
    const appendUsers = (items: any[] = [], fallbackRole = '') => items.map((item) => ({
      _id: String(item._id || ''),
      name: item.name,
      email: item.email,
      githubUsername: item.githubUsername,
      role: String(item.role || fallbackRole || '').toLowerCase() as ActorOption['role']
    })).filter((item) => item._id);

    const organizationId = this.selectedOrganizationId || '';
    const teamId = this.selectedTeamId || '';
    const commonParams: Record<string, string> = {
      page: '1',
      limit: '200'
    };
    if (organizationId) {
      commonParams['organizationId'] = organizationId;
    }
    if (teamId) {
      commonParams['teamId'] = teamId;
    }

    if (!this.selectedRole || this.selectedRole === 'admin') {
      requests.push(this.superAdminService.getAdmins(commonParams));
    }
    if (!this.selectedRole || this.selectedRole === 'recruiter') {
      requests.push(this.superAdminService.getRecruiters(commonParams));
    }
    if (!this.selectedRole || this.selectedRole === 'developer') {
      requests.push(this.superAdminService.getDevelopers(commonParams));
    }

    if ((!organizationId && !teamId) && (!this.selectedRole || this.selectedRole === 'super_admin')) {
      this.actorOptions = this.selectedRole === 'super_admin'
        ? [{
            _id: String(this.authService.getCurrentUser()?._id || ''),
            name: String(this.authService.getCurrentUser()?.name || 'Super Admin'),
            email: String(this.authService.getCurrentUser()?.email || ''),
            role: 'super_admin' as const
          }].filter((item) => item._id)
        : this.actorOptions;
    }

    if (requests.length === 0) {
      this.cdr.markForCheck();
      return;
    }

    forkJoin(requests)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (responses) => {
          const options = new Map<string, ActorOption>();
          responses.forEach((res: any) => {
            const list = appendUsers(res?.admins || res?.recruiters || res?.developers || []);
            list.forEach((item) => options.set(item._id, item));
          });

          if ((!organizationId && !teamId) && (!this.selectedRole || this.selectedRole === 'super_admin')) {
            const me = this.authService.getCurrentUser();
            const myId = String(me?._id || '');
            if (myId) {
              options.set(myId, {
                _id: myId,
                name: String(me?.name || 'Super Admin'),
                email: String(me?.email || ''),
                role: 'super_admin'
              });
            }
          }

          this.actorOptions = Array.from(options.values());
          this.cdr.markForCheck();
        },
        error: () => {
          this.actorOptions = [];
          this.cdr.markForCheck();
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
      organizationId: this.selectedOrganizationId || undefined
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: () => {
        this.logs = this.logs.filter((item) => item._id !== log._id);
        if (this.selectedLog?._id === log._id) {
          this.selectedLog = this.logs[0] || null;
        }
        this.cdr.markForCheck();
        if (this.logs.length === 0 && this.page > 1) {
          this.fetchLogs(this.page - 1);
        }
      },
      error: () => {
        this.statusMessage = 'Failed to delete log.';
        this.cdr.markForCheck();
      }
    });
  }

  fmtActor(actor: AuditActor | null): string {
    if (!actor) return 'System';
    return actor.name || actor.githubUsername || actor.email || 'User';
  }

  fmtActorOption(actor: ActorOption): string {
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
