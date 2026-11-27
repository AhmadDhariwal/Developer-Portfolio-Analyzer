import {
  Component,
  DestroyRef,
  HostListener,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationPolicyId } from '../../../../shared/models/organization-governance.model';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { OrganizationShellComponent } from '../../components/organization-shell/organization-shell.component';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { ORGANIZATION_POLICIES } from '../../utils/organization-policy-catalog';

@Component({
  selector: 'app-organization-policies',
  standalone: true,
  imports: [CommonModule, RouterLink, ConfirmDialogComponent, OrganizationShellComponent],
  templateUrl: './organization-policies.component.html',
  styleUrl: '../../styles/organization-page.scss',
})
export class OrganizationPoliciesComponent {
  readonly store = inject(OrganizationConfigurationStore);
  private readonly destroy = inject(DestroyRef);
  readonly catalog = ORGANIZATION_POLICIES;
  readonly groups = [...new Set(this.catalog.map((policy) => policy.group))];
  readonly draft = signal<Partial<Record<OrganizationPolicyId, boolean>>>({});
  private baseline = '';
  readonly message = signal('');
  readonly conflict = signal(false);
  readonly confirming = signal(false);
  constructor() {
    effect(() => {
      this.store.context();
      untracked(() => {
        this.draft.set({});
        this.baseline = '{}';
        if (this.store.context()) this.load();
      });
    });
  }
  get dirty(): boolean {
    return JSON.stringify(this.draft()) !== this.baseline;
  }
  get confirmation(): string {
    return this.catalog
      .filter((policy) => this.draft()[policy.id] !== this.store.committed()?.policies[policy.id])
      .map(
        (policy) =>
          `${policy.title}: ${this.draft()[policy.id] ? 'enable; only still-valid permissions can return.' : policy.warning}`,
      )
      .join('\n\n');
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  load(preserve = false): void {
    if (!preserve && this.dirty && !window.confirm('Discard unsaved policy changes and refresh?'))
      return;
    const context = this.store.context();
    this.store
      .load()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          if (context === this.store.context() && !preserve) this.reset();
        },
        error: () => {},
      });
  }
  reset(): void {
    this.draft.set({ ...this.store.committed()!.policies });
    this.baseline = JSON.stringify(this.draft());
    this.conflict.set(false);
    this.confirming.set(false);
  }
  toggle(id: OrganizationPolicyId, event: Event): void {
    this.draft.update((value) => ({ ...value, [id]: (event.target as HTMLInputElement).checked }));
    this.message.set('');
  }
  save(): void {
    this.confirming.set(false);
    if (!this.dirty || this.conflict() || !this.store.committed()) return;
    const policies = Object.fromEntries(
      this.catalog
        .filter((policy) => this.draft()[policy.id] !== this.store.committed()!.policies[policy.id])
        .map((policy) => [policy.id, this.draft()[policy.id]]),
    );
    const context = this.store.context();
    this.store
      .save({ policies })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          if (context !== this.store.context()) return;
          this.reset();
          this.message.set(
            'Organization policies saved. Dependent operations use the committed policies.',
          );
        },
        error: (error) => {
          if (context !== this.store.context()) return;
          if (error.status === 409) {
            this.conflict.set(true);
            this.message.set(
              'The server configuration changed. Your staged toggles are preserved. Review current values before another Save.',
            );
            this.load(true);
          } else {
            this.message.set(
              error.status === 403
                ? 'Permission denied. Your staged changes are preserved.'
                : error.error?.message || 'Unable to save policies.',
            );
            if (error.status === 403) this.load(true);
          }
        },
      });
  }
}
