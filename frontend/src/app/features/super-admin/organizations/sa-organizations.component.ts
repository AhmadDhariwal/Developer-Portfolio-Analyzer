import { Component, OnInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminService } from '../shared/super-admin.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SaPagerComponent } from '../shared/components/sa-pager/sa-pager.component';

@Component({
  selector: 'app-sa-organizations',
  standalone: true,
  imports: [CommonModule, FormsModule, SaPagerComponent],
  templateUrl: './sa-organizations.component.html',
  styleUrls: ['./sa-organizations.component.scss']
})
export class SaOrganizationsComponent implements OnInit {
  organizations: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false; search = ''; suspended = '';
  readonly pageSize = 30;

  constructor(
    private readonly sa: SuperAdminService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef
  ) {}

  ngOnInit(): void { this.load(); }

  load(page = 1): void {
    this.loading = true;
    this.page = page;
    const params: Record<string, string> = { page: String(page), limit: String(this.pageSize) };
    if (this.search) params['search'] = this.search;
    if (this.suspended) params['suspended'] = this.suspended;
    this.sa.getOrganizations(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.organizations = res.organizations || [];
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

  toggleSuspend(org: any): void {
    const obs = org.isSuspended ? this.sa.activateOrganization(org._id) : this.sa.suspendOrganization(org._id);
    obs.subscribe({ next: () => this.load(this.page) });
  }
}
