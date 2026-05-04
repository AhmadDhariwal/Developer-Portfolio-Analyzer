import { Component, OnInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminService } from '../shared/super-admin.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SaPagerComponent } from '../shared/components/sa-pager/sa-pager.component';
import { SaUserFormModalComponent } from '../shared/components/sa-user-form-modal/sa-user-form-modal.component';

@Component({
  selector: 'app-sa-recruiters',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SaPagerComponent, SaUserFormModalComponent],
  templateUrl: './sa-recruiters.component.html',
  styleUrls: ['./sa-recruiters.component.scss']
})
export class SaRecruitersComponent implements OnInit {
  recruiters: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false;
  search = '';
  organizationId = '';
  active = '';
  organizations: any[] = [];
  readonly pageSize = 30;

  formOpen = false;
  formMode: 'create' | 'edit' = 'create';
  formBusy = false;
  formError = '';
  selected: any = null;

  constructor(
    private readonly sa: SuperAdminService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef
  ) {}
  ngOnInit(): void {
    this.loadOrgs();
    this.load();
  }

  load(page = 1): void {
    this.loading = true; this.page = page;
    const params: Record<string, string> = { page: String(page), limit: String(this.pageSize) };
    if (this.search) params['search'] = this.search;
    if (this.organizationId) params['organizationId'] = this.organizationId;
    if (this.active) params['active'] = this.active;
    this.sa.getRecruiters(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.recruiters = res.recruiters || [];
        this.total = res.total || 0;
        this.totalPages = res.totalPages || 1;
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  loadOrgs(): void {
    this.sa.getOrganizations({ page: '1', limit: '100' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.organizations = res?.organizations || [];
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  openCreate(): void {
    this.selected = null;
    this.formMode = 'create';
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(user: any): void {
    this.selected = user;
    this.formMode = 'edit';
    this.formError = '';
    this.formOpen = true;
  }

  save(payload: Record<string, any>): void {
    this.formBusy = true;
    this.formError = '';

    const req$ = this.formMode === 'create'
      ? this.sa.createUser(payload)
      : this.sa.updateUser(this.selected?._id, payload);

    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.formBusy = false;
        this.formOpen = false;
        this.load(this.page);
        try { this.cdr.detectChanges(); } catch {}
      },
      error: (err) => {
        this.formBusy = false;
        this.formError = err?.error?.message || 'Failed to save.';
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  toggle(user: any): void {
    this.sa.toggleUserActive(user._id).subscribe({ next: () => this.load(this.page) });
  }
}
