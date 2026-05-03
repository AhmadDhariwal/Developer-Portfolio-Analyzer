import { Component, OnInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuperAdminService } from '../shared/super-admin.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-sa-developers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sa-developers.component.html',
  styleUrls: ['./sa-developers.component.scss']
})
export class SaDevelopersComponent implements OnInit {
  developers: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false; search = ''; careerStack = ''; experienceLevel = '';

  readonly stacks = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
  readonly levels = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];

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
    if (this.careerStack) params['careerStack'] = this.careerStack;
    if (this.experienceLevel) params['experienceLevel'] = this.experienceLevel;
    this.sa.getDevelopers(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.developers = res.developers || [];
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

  reset(): void { this.search = ''; this.careerStack = ''; this.experienceLevel = ''; this.load(1); }
}
