import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, combineLatest, of } from 'rxjs';
import { catchError, finalize, shareReplay, tap, takeUntil, timeout } from 'rxjs/operators';
import {
  OrganizationCapabilities,
  OrganizationPolicyId,
} from '../models/organization-governance.model';
import { OrganizationGovernanceService } from './organization-governance.service';
import { AuthService } from './auth.service';
import { TenantContextService } from './tenant-context.service';

@Injectable({ providedIn: 'root' })
export class OrganizationPolicyState {
  private readonly api = inject(OrganizationGovernanceService);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);
  readonly value = signal<OrganizationCapabilities | null>(null);
  readonly loading = signal(false);
  readonly scope = signal('');
  readonly revision = signal(0);
  private request?: Observable<OrganizationCapabilities | null>;
  private loadedAt = 0;
  private audience: 'admin' | 'recruiter' = 'recruiter';
  private readonly contextChanges = new Subject<void>();
  readonly contextChanges$ = this.contextChanges.asObservable();
  private readonly resourceChanges = new Subject<void>();
  readonly resourcesChanged$ = this.resourceChanges.asObservable();
  private requestSequence = 0;
  private recovering = false;

  constructor() {
    combineLatest([this.auth.currentUser$, this.tenant.state$])
      .pipe(takeUntilDestroyed())
      .subscribe(([user, tenant]) => {
        const key = user
          ? [
              user._id,
              user.role,
              user['sessionRevision'],
              user['organizationId'],
              tenant.organizationId || user['organizationId'],
              tenant.myRole,
            ].join(':')
          : '';
        if (key === this.scope()) return;
        this.scope.set(key);
        this.audience = user?.role === 'admin' ? 'admin' : 'recruiter';
        this.invalidate();
        this.contextChanges.next();
      });
  }

  invalidate(): void {
    this.recovering = false;
    this.revision.update((value) => value + 1);
    this.value.set(null);
    this.request = undefined;
    this.loadedAt = 0;
    this.loading.set(false);
  }

  refresh(force = false): Observable<OrganizationCapabilities | null> {
    if (!this.scope()) return of(null);
    if (this.request) return this.request;
    if (!force && this.value() && Date.now() - this.loadedAt < 60000) return of(this.value());
    const scope = this.scope();
    const revision = this.revision();
    const sequence = ++this.requestSequence;
    this.loading.set(true);
    this.request = this.api.getCapabilities(this.audience).pipe(
      timeout(15000),
      tap((value) => {
        if (scope !== this.scope() || revision !== this.revision()) return;
        const previous = this.value();
        const changed = !!previous && JSON.stringify(previous) !== JSON.stringify(value);
        if (changed) this.revision.update((version) => version + 1);
        this.value.set(value);
        this.loadedAt = Date.now();
        if (changed) this.resourceChanges.next();
      }),
      catchError(() => {
        if (scope === this.scope() && revision === this.revision()) this.value.set(null);
        return of(null);
      }),
      finalize(() => {
        if (scope === this.scope() && sequence === this.requestSequence) {
          this.request = undefined;
          this.loading.set(false);
          this.recovering = false;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    return this.request;
  }
  recover(): Observable<OrganizationCapabilities | null> {
    if (this.recovering && this.request) return this.request;
    this.invalidate();
    this.recovering = true;
    return this.refresh(true);
  }

  allowed(id: OrganizationPolicyId): boolean {
    return this.value()?.capabilities[id]?.allowed === true;
  }
  scoped<T>(source: Observable<T>): Observable<T> {
    return source.pipe(takeUntil(this.contextChanges));
  }

  explanation(id: OrganizationPolicyId): string {
    if (!this.value())
      return this.loading()
        ? 'Checking organization permissions…'
        : 'Permission information is unavailable. Refresh to try again.';
    const reason = this.value()!.capabilities[id]?.reason;
    if (!reason) return '';
    return reason === 'organization_policy'
      ? 'Restricted by organization policy.'
      : reason === 'platform_policy'
        ? 'Restricted by platform policy.'
        : 'Restricted by your account or membership role.';
  }

  canGenerate(
    access: { evaluationManage?: boolean; isOwner?: boolean } | null | undefined,
  ): boolean {
    return (
      this.allowed('candidateMatching') &&
      access?.evaluationManage === true &&
      (access.isOwner === true ||
        (this.allowed('teamSharedJobs') &&
          this.allowed('sharedPublicEvaluations') &&
          this.allowed('teamManagerEvaluationManagement')))
    );
  }

  publicEvaluations<T extends { access?: { isOwner?: boolean; manage?: boolean } }>(
    rows: T[],
  ): T[] {
    return rows
      .filter(
        (row) =>
          row.access?.isOwner === true ||
          (this.allowed('teamSharedJobs') && this.allowed('sharedPublicEvaluations')),
      )
      .map((row) => ({
        ...row,
        access: {
          ...row.access,
          manage:
            row.access?.manage === true &&
            !!this.value() &&
            (row.access?.isOwner === true || this.allowed('teamManagerEvaluationManagement')),
        },
      }));
  }

  canManagePublic(access: { isOwner?: boolean; manage?: boolean } | undefined): boolean {
    return (
      !!this.value() &&
      this.value()!.capabilities.teamManagerEvaluationManagement.reason !== 'platform_policy' &&
      access?.manage === true &&
      (access.isOwner === true ||
        (this.allowed('teamSharedJobs') &&
          this.allowed('sharedPublicEvaluations') &&
          this.allowed('teamManagerEvaluationManagement')))
    );
  }

  permissionError(
    error: { status?: number; error?: { reason?: string; message?: string } },
    fallback: string,
  ): string {
    if (error.status === 404)
      return 'This resource is unavailable. Refresh the authorized workspace.';
    if (error.error?.reason === 'organization_policy')
      return 'Restricted by organization policy. Refresh permissions before trying another action.';
    if (error.error?.reason === 'platform_policy') return 'Restricted by platform policy.';
    if (error.status === 403)
      return 'Access is unavailable under the current account, membership, ownership or consent permissions.';
    return error.error?.message || fallback;
  }
}
