import { CommonModule } from '@angular/common';
import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { OrganizationCapacityComponent } from '../../components/organization-capacity/organization-capacity.component';
import { OrganizationShellComponent } from '../../components/organization-shell/organization-shell.component';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { ORGANIZATION_POLICIES } from '../../utils/organization-policy-catalog';
import { organizationUrlError } from '../../utils/organization-settings-validation';
import {
  ActivityLog,
  AdminConsoleService,
  ConsoleOverview,
} from '../admin-console/admin-console.service';

@Component({
  selector: 'app-organization-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, OrganizationShellComponent, OrganizationCapacityComponent],
  templateUrl: './organization-overview.component.html',
  styleUrl: './organization-overview.component.scss',
})
export class OrganizationOverviewComponent {
  readonly store = inject(OrganizationConfigurationStore);
  private readonly console = inject(AdminConsoleService);
  private readonly destroy = inject(DestroyRef);

  readonly overview = signal<ConsoleOverview | null>(null);
  readonly owner = signal('');
  readonly activity = signal<ActivityLog[]>([]);
  readonly catalog = ORGANIZATION_POLICIES;
  readonly error = signal('');
  readonly loading = signal(false);
  readonly logoFailed = signal(false);

  private request = 0;
  private loadedContext = '';

  constructor() {
    effect(() => {
      this.store.context();
      untracked(() => this.load());
    });
  }

  get safeLogo(): string {
    const value = this.store.committed()?.organization.branding.logoUrl || '';
    return value && !organizationUrlError(value) ? value : '';
  }

  load(): void {
    const request = ++this.request;
    this.loading.set(true);
    this.logoFailed.set(false);
    if (this.store.context() !== this.loadedContext) {
      this.overview.set(null);
      this.owner.set('');
      this.activity.set([]);
    }
    this.error.set('');
    const context = this.store.context();
    forkJoin({
      configuration: this.store.load(),
      overview: this.console.getOverview(),
      members: this.store.api.getMembers(),
      activity: this.console.getActivity(1, 5),
    })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (context !== this.store.context() || request !== this.request) return;
          this.overview.set(result.overview);
          this.owner.set(
            result.members.members.find((member) => member.isOwner)?.name ||
              'Ownership identity is unavailable',
          );
          this.activity.set(result.activity.logs);
          this.loadedContext = context;
          this.loading.set(false);
        },
        error: () => {
          if (context !== this.store.context() || request !== this.request) return;
          this.loading.set(false);
          this.overview.set(null);
          this.owner.set('');
          this.activity.set([]);
          this.error.set(
            'Unable to load the organization overview. Retry to refresh authorized data.',
          );
        },
      });
  }
}
