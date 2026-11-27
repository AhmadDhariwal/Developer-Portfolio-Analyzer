import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { OrganizationInvitation } from '../../../../shared/models/organization-governance.model';
import { ApiService } from '../../../../shared/services/api.service';
import { OrganizationShellComponent } from '../../components/organization-shell/organization-shell.component';
import { AdminHiringService } from '../../services/admin-hiring.service';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { AdminConsoleService } from '../admin-console/admin-console.service';

@Component({
  selector: 'app-organization-invitations',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ConfirmDialogComponent,
    OrganizationShellComponent,
  ],
  templateUrl: './organization-invitations.component.html',
  styleUrl: './organization-invitations.component.scss',
})
export class OrganizationInvitationsComponent {
  readonly store = inject(OrganizationConfigurationStore);
  private readonly admin = inject(AdminHiringService);
  private readonly api = inject(ApiService);
  private readonly console = inject(AdminConsoleService);
  private readonly destroy = inject(DestroyRef);

  readonly rows = signal<OrganizationInvitation[]>([]);
  readonly names = signal<Record<string, string>>({});
  readonly teams = signal<Array<{ _id: string; name: string }>>([]);
  readonly search = signal('');
  readonly status = signal('');
  readonly role = signal('');
  readonly team = signal('');
  readonly page = signal(1);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly deliveryLink = signal('');
  readonly pendingAction = signal<{
    row: OrganizationInvitation;
    action: 'revoke' | 'expire';
  } | null>(null);
  form = { name: '', email: '', teamId: '' };

  readonly filtered = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.rows().filter(
      (row) =>
        (!this.status() || row.status === this.status()) &&
        (!this.role() || row.role === this.role()) &&
        (!this.team() || row.teamId === this.team()) &&
        (!search ||
          [row.name, row.email, this.names()[row.invitedBy]]
            .join(' ')
            .toLowerCase()
            .includes(search)),
    );
  });
  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / 20)));
  readonly visible = computed(() =>
    this.filtered().slice(
      (Math.min(this.page(), this.pages()) - 1) * 20,
      Math.min(this.page(), this.pages()) * 20,
    ),
  );
  readonly invitationAllowed = computed(
    () => this.store.committed()?.policies.invitationCreation === true,
  );

  private request = 0;
  private loadedContext = '';

  constructor() {
    effect(() => {
      this.store.context();
      untracked(() => {
        this.form = { name: '', email: '', teamId: '' };
        this.deliveryLink.set('');
        this.pendingAction.set(null);
        this.load();
      });
    });
  }

  load(): void {
    const request = ++this.request;
    const context = this.store.context();
    if (context !== this.loadedContext) {
      this.rows.set([]);
      this.names.set({});
      this.teams.set([]);
      this.page.set(1);
    }
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      configuration: this.store.load(),
      rows: this.store.api.getInvitations(),
      members: this.store.api.getMembers(),
      teams: this.console.getTeams(),
    })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (request !== this.request || context !== this.store.context()) return;
          this.rows.set(result.rows.invitations);
          this.names.set(
            Object.fromEntries(result.members.members.map((member) => [member._id, member.name])),
          );
          this.teams.set(result.teams.teams);
          this.loadedContext = context;
          this.page.set(Math.min(this.page(), this.pages()));
          this.loading.set(false);
        },
        error: (error) => {
          if (request !== this.request || context !== this.store.context()) return;
          this.loading.set(false);
          this.rows.set([]);
          this.names.set({});
          this.teams.set([]);
          this.page.set(1);
          this.error.set(
            error.status === 403
              ? 'Invitation history requires current organization Admin authority.'
              : 'Unable to load invitations. Retry to refresh authorized data.',
          );
        },
      });
  }
  create(): void {
    if (
      !this.invitationAllowed() ||
      this.busy() ||
      this.loading() ||
      !this.form.name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email.trim())
    )
      return;
    this.mutate(
      this.admin.inviteRecruiter({
        name: this.form.name.trim(),
        email: this.form.email.trim(),
        teamId: this.form.teamId || undefined,
        role: 'recruiter',
      }),
      'Invitation created',
      true,
    );
  }

  resend(row: OrganizationInvitation): void {
    if (row.status === 'pending' && row.role === 'recruiter' && this.invitationAllowed())
      this.mutate(this.admin.resendInvitation(row._id), 'Invitation renewed', true);
  }

  confirmAction(): void {
    const pending = this.pendingAction();
    this.pendingAction.set(null);
    if (!pending || pending.row.status !== 'pending') return;
    const action =
      pending.action === 'expire'
        ? this.admin.expireInvitation(pending.row._id)
        : this.api.revokeInvitation(this.store.committed()!.organization._id, pending.row._id);
    this.mutate(
      action,
      pending.action === 'expire' ? 'Invitation expired.' : 'Invitation revoked.',
    );
  }

  teamName(id: string | null): string {
    return (
      this.teams().find((team) => team._id === id)?.name ||
      (id ? 'Team unavailable' : 'Organization')
    );
  }

  private mutate(action: Observable<unknown>, success: string, delivery = false): void {
    if (this.busy() || this.loading()) return;
    const context = this.store.context();
    this.busy.set(true);
    this.message.set('');
    this.deliveryLink.set('');
    action
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (result) => {
          if (context !== this.store.context()) return;
          if (delivery) {
            const receipt = result as { invitationLink: string; emailSent: boolean };
            this.message.set(
              `${success}. ${receipt.emailSent ? 'Email sent by the configured provider.' : 'Email was not delivered. Use the secure invitation link if provided.'}`,
            );
            this.deliveryLink.set(receipt.invitationLink || '');
            this.form = { name: '', email: '', teamId: '' };
          } else this.message.set(success);
          this.load();
        },
        error: (error) => {
          if (context !== this.store.context()) return;
          this.message.set(
            error.status === 404
              ? 'The requested invitation is unavailable. Refresh authorized data.'
              : error.error?.message || 'Unable to complete the invitation action.',
          );
          if ([403, 404, 409].includes(error.status)) this.load();
        },
      });
  }
}
