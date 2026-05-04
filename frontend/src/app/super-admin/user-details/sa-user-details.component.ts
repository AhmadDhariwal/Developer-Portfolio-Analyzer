import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SuperAdminService } from '../shared/super-admin.service';

@Component({
  selector: 'app-sa-user-details',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sa-user-details.component.html',
  styleUrls: ['./sa-user-details.component.scss']
})
export class SaUserDetailsComponent implements OnInit {
  loading = true;
  user: any = null;
  memberships: any[] = [];
  error = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly sa: SuperAdminService,
    private readonly destroyRef: DestroyRef,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    if (!id) {
      this.loading = false;
      this.error = 'Invalid user id.';
      return;
    }

    this.sa.getUserDetails(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.user = res?.user || null;
        this.memberships = res?.memberships || [];
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Failed to load user details.';
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }
}

