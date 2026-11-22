import { ChangeDetectorRef, Component, DestroyRef, Input, OnChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DirectApplication, JobApplicationsService } from '../../services/job-applications.service';
import { formatInitials, truncateSha256 } from './direct-application-ui.utils';
import { SubmittedPortfolioComponent } from './submitted-portfolio.component';
@Component({
  selector: 'app-job-applicants',
  standalone: true,
  imports: [CommonModule, SubmittedPortfolioComponent],
  templateUrl: './job-applicants.component.html',
  styleUrl: './job-applicants.component.scss',
})
export class JobApplicantsComponent implements OnChanges {
  @Input({ required: true }) jobId = '';
  private readonly api = inject(JobApplicationsService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  applications: DirectApplication[] = [];
  loading = false;
  busy = false;
  error = '';
  actionError = '';
  private loadVersion = 0;
  filterStatus: 'all' | 'submitted' | 'reviewing' | 'rejected' | 'withdrawn' = 'all';

  get filteredApplications(): DirectApplication[] {
    if (this.filterStatus === 'all') return this.applications;
    return this.applications.filter((app) => app.status === this.filterStatus);
  }

  countByStatus(status: 'submitted' | 'reviewing' | 'rejected' | 'withdrawn'): number {
    return this.applications.filter((app) => app.status === status).length;
  }

  initials(name?: string): string {
    return formatInitials(name);
  }

  shortHash(digest?: string): string {
    return truncateSha256(digest);
  }
  ngOnChanges() {
    this.load();
  }
  load() {
    if (!this.jobId) return;
    const version = ++this.loadVersion;
    const jobId = this.jobId;
    this.loading = true;
    this.applications = [];
    this.error = '';
    this.api
      .applicants(this.jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          if (jobId !== this.jobId || version !== this.loadVersion) return;
          this.applications = r.applications;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          if (jobId !== this.jobId || version !== this.loadVersion) return;
          this.error = 'Unable to load applicants. Please retry.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }
  status(application: DirectApplication, status: string) {
    if (this.busy || this.loading) return;
    this.busy = true;
    this.actionError = '';
    this.api
      .status(this.jobId, application._id, status, application.status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy = false;
          this.load();
        },
        error: (e) => {
          this.busy = false;
          if (e.status === 409) {
            this.load();
            this.actionError =
              'Application changed. Refresh and review the current status before trying again.';
          } else this.actionError = e.error?.message || 'Unable to change status.';
          this.cdr.markForCheck();
        },
      });
  }
  download(application: DirectApplication) {
    if (this.busy || this.loading) return;
    this.busy = true;
    this.actionError = '';
    this.api
      .resume(this.jobId, application._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'submitted-resume.pdf';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          this.busy = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.busy = false;
          this.actionError = 'Unable to download submitted resume.';
          this.cdr.markForCheck();
        },
      });
  }
}
