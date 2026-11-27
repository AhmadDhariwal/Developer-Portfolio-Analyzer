import { Component, DestroyRef, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { OrganizationShellComponent } from '../../components/organization-shell/organization-shell.component';
import { OrganizationCapacityComponent } from '../../components/organization-capacity/organization-capacity.component';
@Component({
  selector: 'app-organization-usage',
  standalone: true,
  imports: [RouterLink, OrganizationShellComponent, OrganizationCapacityComponent],
  templateUrl: './organization-usage.component.html',
  styleUrl: '../../styles/organization-page.scss',
})
export class OrganizationUsageComponent {
  readonly store = inject(OrganizationConfigurationStore);
  private readonly destroy = inject(DestroyRef);
  constructor() {
    effect(() => {
      this.store.context();
      untracked(() => this.load());
    });
  }
  load(): void {
    this.store
      .load()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({ error: () => {} });
  }
}
