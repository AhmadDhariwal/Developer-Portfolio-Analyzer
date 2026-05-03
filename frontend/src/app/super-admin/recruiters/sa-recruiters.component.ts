import { Component, OnInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminService } from '../shared/super-admin.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-sa-recruiters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sa-recruiters.component.html',
  styleUrls: ['./sa-recruiters.component.scss']
})
export class SaRecruitersComponent implements OnInit {
  recruiters: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false; search = '';

  constructor(
    private readonly sa: SuperAdminService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef
  ) {}
  ngOnInit(): void { this.load(); }

  load(page = 1): void {
    this.loading = true; this.page = page;
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (this.search) params['search'] = this.search;
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

  toggle(user: any): void {
    this.sa.toggleUserActive(user._id).subscribe({ next: () => this.load(this.page) });
  }
}
