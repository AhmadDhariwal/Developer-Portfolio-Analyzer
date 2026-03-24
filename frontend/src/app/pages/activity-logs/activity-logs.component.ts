import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../shared/services/api.service';
import { TenantContextService } from '../../shared/services/tenant-context.service';

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

interface ActorOption {
  _id: string;
  name?: string;
  email?: string;
  githubUsername?: string;
  role?: 'admin' | 'manager' | 'member';
}

@Component({
  selector: 'app-activity-logs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './activity-logs.component.html',
  styleUrl: './activity-logs.component.scss'
})
export class ActivityLogsComponent implements OnInit {
  logs: AuditLogItem[] = [];
  selectedLog: AuditLogItem | null = null;
  organizations: OrganizationItem[] = [];
  actorOptions: ActorOption[] = [];
  selectedOrganizationId = '';
  page = 1;
  totalPages = 1;
  total = 0;
  loading = false;
  statusMessage = '';

  actor = '';
  action = '';
  from = '';
  to = '';
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly apiService: ApiService,
    private readonly tenantContext: TenantContextService
  ) {}

  ngOnInit(): void {
    this.ensureDefaultDateRange();
    const ctx = this.tenantContext.snapshot;
    this.selectedOrganizationId = ctx.organizationId || '';
    this.loadOrganizations();

    this.tenantContext.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state.organizationId && state.organizationId !== this.selectedOrganizationId) {
          this.selectedOrganizationId = state.organizationId;
          this.fetchLogs(1);
        }
      });
  }

  private ensureDefaultDateRange(): void {
    if (this.from && this.to) return;
    const today = new Date();
    const todayText = this.toDateString(today);
    if (!this.from) this.from = todayText;
    if (!this.to) this.to = todayText;
  }

  get hasOrgScopedActorOptions(): boolean {
    return !!this.selectedOrganizationId && this.actorOptions.length > 0;
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
      from?: string;
      to?: string;
      page: number;
      limit: number;
    } = {
      actor: this.actor || undefined,
      action: this.action || undefined,
      organizationId: this.selectedOrganizationId || undefined,
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
    this.apiService.getOrganizations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        this.ensureDefaultDateRange();
        this.organizations = Array.isArray(res?.organizations) ? res.organizations : [];
        if (!this.selectedOrganizationId && this.organizations.length > 0) {
          this.selectedOrganizationId = this.organizations[0]._id;
          this.tenantContext.setOrganization({
            id: this.organizations[0]._id,
            name: this.organizations[0].name,
            myRole: this.organizations[0].myRole
          });
        }
        const savedOrgId = this.tenantContext.snapshot.organizationId;
        if (savedOrgId && this.organizations.some((org) => org._id === savedOrgId)) {
          this.selectedOrganizationId = savedOrgId;
        }
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
    this.actor = '';
    this.actorOptions = [];
    this.fetchLogs(1);
  }

  applyFilters(): void {
    this.fetchLogs(1);
  }

  resetFilters(): void {
    this.actor  = '';
    this.action = '';
    const today = new Date();
    this.from = this.toDateString(today);
    this.to   = this.toDateString(today);
    this.fetchLogs(1);
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
