import {
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationDirectoryMember } from '../../../../shared/models/organization-governance.model';
import { OrganizationShellComponent } from '../../components/organization-shell/organization-shell.component';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { deduplicateOrganizationMembers } from '../../utils/organization-directory';

@Component({
  selector: 'app-organization-members',
  standalone: true,
  imports: [FormsModule, RouterLink, OrganizationShellComponent],
  templateUrl: './organization-members.component.html',
  styleUrl: '../../styles/organization-page.scss',
})
export class OrganizationMembersComponent {
  readonly store = inject(OrganizationConfigurationStore);
  private readonly destroy = inject(DestroyRef);
  @ViewChild('details') private details?: ElementRef<HTMLDialogElement>;
  readonly rows = signal<OrganizationDirectoryMember[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly search = signal('');
  readonly accountRole = signal('');
  readonly membershipRole = signal('');
  readonly membershipStatus = signal('');
  readonly accountStatus = signal('');
  readonly team = signal('');
  readonly page = signal(1);
  readonly pageSize = 20;
  readonly selected = signal<OrganizationDirectoryMember | null>(null);
  private request = 0;
  private loadedContext = '';
  readonly teamOptions = computed(() =>
    [
      ...new Map(
        this.rows().flatMap((row) => row.teams.map((team) => [team.teamId, team] as const)),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name)),
  );
  readonly accountRoles = computed(() =>
    [...new Set(this.rows().map((row) => row.accountRole))].sort(),
  );
  readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.rows().filter(
      (row) =>
        (!query ||
          [row.name, row.email, ...row.teams.map((team) => team.name)]
            .join(' ')
            .toLowerCase()
            .includes(query)) &&
        (!this.accountRole() || row.accountRole === this.accountRole()) &&
        (!this.accountStatus() || row.isActive === (this.accountStatus() === 'active')) &&
        (!this.team() || row.teams.some((team) => team.teamId === this.team())) &&
        (!this.membershipRole() ||
          row.organizationMembership?.role === this.membershipRole() ||
          row.teams.some((team) => team.role === this.membershipRole())) &&
        (!this.membershipStatus() ||
          row.organizationMembership?.status === this.membershipStatus() ||
          row.teams.some((team) => team.status === this.membershipStatus())),
    );
  });
  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
  readonly visible = computed(() =>
    this.filtered().slice(
      (Math.min(this.page(), this.pages()) - 1) * this.pageSize,
      Math.min(this.page(), this.pages()) * this.pageSize,
    ),
  );
  readonly activeCount = computed(() => this.rows().filter((row) => row.isActive).length);
  constructor() {
    effect(() => {
      this.store.context();
      untracked(() => {
        this.close();
        this.load();
      });
    });
  }
  load(): void {
    const request = ++this.request;
    const context = this.store.context();
    if (context !== this.loadedContext) {
      this.rows.set([]);
      this.total.set(0);
      this.page.set(1);
    }
    this.loading.set(true);
    this.error.set('');
    this.store.api
      .getMembers()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (request !== this.request || context !== this.store.context()) return;
          this.rows.set(deduplicateOrganizationMembers(result.members));
          this.total.set(result.total);
          this.loadedContext = context;
          this.page.set(Math.min(this.page(), this.pages()));
          this.loading.set(false);
        },
        error: (error) => {
          if (request !== this.request || context !== this.store.context()) return;
          this.loading.set(false);
          this.rows.set([]);
          this.total.set(0);
          this.page.set(1);
          this.close();
          this.error.set(
            error.status === 403
              ? 'The internal directory requires current organization Admin authority.'
              : 'Unable to load members. Retry to refresh authorized data.',
          );
        },
      });
  }
  show(row: OrganizationDirectoryMember): void {
    this.selected.set(row);
    const dialog = this.details?.nativeElement;
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
  }
  close(): void {
    const dialog = this.details?.nativeElement;
    if (dialog && typeof dialog.close === 'function') {
      dialog.close();
    }
    this.selected.set(null);
  }
}
