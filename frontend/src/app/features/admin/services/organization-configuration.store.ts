import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, forkJoin, throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';

import {
  OrganizationConfigurationPatch,
  OrganizationGovernance,
} from '../../../shared/models/organization-governance.model';
import { AuthService } from '../../../shared/services/auth.service';
import { OrganizationGovernanceService } from '../../../shared/services/organization-governance.service';
import { OrganizationPolicyState } from '../../../shared/services/organization-policy-state.service';
import { TenantContextService } from '../../../shared/services/tenant-context.service';
import {
  AdminConsoleService,
  ConsolePreferences,
} from '../pages/admin-console/admin-console.service';

@Injectable({ providedIn: 'root' })
export class OrganizationConfigurationStore {
  readonly api = inject(OrganizationGovernanceService);
  private readonly console = inject(AdminConsoleService);
  private readonly policies = inject(OrganizationPolicyState);
  private readonly tenant = inject(TenantContextService);

  readonly committed = signal<OrganizationGovernance | null>(null);
  readonly preferences = signal<ConsolePreferences | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly denied = signal(false);
  readonly context = signal('');

  private epoch = 0;
  private loadSequence = 0;

  constructor() {
    const auth = inject(AuthService);
    const tenant = this.tenant;
    combineLatest([auth.currentUser$, tenant.state$])
      .pipe(takeUntilDestroyed())
      .subscribe(([user, state]) => {
        const key = user
          ? [
              user._id,
              user.role,
              user['sessionRevision'],
              user['organizationId'],
              state.organizationId || user['organizationId'],
              state.myRole,
            ].join(':')
          : '';
        if (key === this.context()) return;
        this.context.set(key);
        this.epoch++;
        this.committed.set(null);
        this.preferences.set(null);
        this.loading.set(false);
        this.saving.set(false);
        this.error.set('');
        this.denied.set(false);
      });
  }

  load(): Observable<unknown> {
    const epoch = this.epoch;
    const request = ++this.loadSequence;
    this.loading.set(true);
    this.error.set('');
    return forkJoin({
      governance: this.api.getGovernance(),
      preferences: this.console.getPreferences(),
    }).pipe(
      tap(({ governance, preferences }) => {
        if (epoch !== this.epoch || request !== this.loadSequence) return;
        if (preferences.organization.governanceVersion !== governance.version)
          throw new HttpErrorResponse({
            status: 409,
            error: {
              message:
                'Configuration changed while loading. Refresh to load one consistent committed version.',
            },
          });
        this.committed.set(governance);
        this.preferences.set(preferences);
        this.denied.set(false);
      }),
      catchError((error) => {
        if (epoch === this.epoch && request === this.loadSequence) {
          this.denied.set(error.status === 403);
          this.committed.set(null);
          this.preferences.set(null);
          this.error.set(
            error.status === 403
              ? 'Organization settings require current organization Admin authority. Account role alone does not grant access.'
              : error.status === 409
                ? 'Configuration changed while loading. Refresh to load one consistent committed version.'
                : 'Unable to load organization configuration. Try again.',
          );
        }
        return throwError(() => error);
      }),
      finalize(() => {
        if (epoch === this.epoch && request === this.loadSequence) this.loading.set(false);
      }),
    );
  }

  save(patch: Omit<OrganizationConfigurationPatch, 'expectedVersion'>): Observable<unknown> {
    const current = this.committed();
    if (!current || this.saving() || this.loading())
      return throwError(() => new Error('Configuration is unavailable.'));
    const epoch = this.epoch;
    this.saving.set(true);
    return this.api.updateGovernance({ ...patch, expectedVersion: current.version }).pipe(
      tap((response) => {
        if (epoch === this.epoch) {
          this.committed.set({ ...current, ...response });
          this.tenant.syncOrganization?.({
            id: response.organization._id,
            name: response.organization.name,
          });
          this.policies.invalidate();
        }
      }),
      finalize(() => {
        if (epoch === this.epoch) this.saving.set(false);
      }),
    );
  }

  saveDashboard(
    dashboardConfig: NonNullable<ConsolePreferences['organization']['dashboardConfig']>,
  ): Observable<unknown> {
    const current = this.committed();
    if (!current || this.saving() || this.loading())
      return throwError(() => new Error('Configuration is unavailable.'));
    const epoch = this.epoch;
    this.saving.set(true);
    return this.console
      .updatePreferences({
        expectedVersion: current.version,
        name: current.organization.name,
        description: current.organization.description,
        dashboardConfig,
      })
      .pipe(
        tap((response) => {
          if (epoch !== this.epoch) return;
          this.preferences.set(response);
          this.committed.set({
            ...current,
            organization: {
              ...current.organization,
              name: response.organization.name,
              description: response.organization.description,
            },
            version: response.organization.governanceVersion!,
          });
        }),
        finalize(() => {
          if (epoch === this.epoch) this.saving.set(false);
        }),
      );
  }
}
