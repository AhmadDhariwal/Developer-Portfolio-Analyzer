import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, finalize, switchMap } from 'rxjs';
import { Job } from '../../shared/models/job.model';
import { JobService } from '../../shared/services/job.service';

@Component({
  selector: 'app-job-details',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './job-details.component.html',
  styleUrl: './job-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobDetailsComponent implements OnInit, OnDestroy {
  job: Job | null = null;
  isLoading = true;
  errorMessage = '';

  private readonly subscription = new Subscription();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly jobService: JobService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  get applyLink(): string {
    return String(this.job?.applyUrl || this.job?.url || '').trim();
  }

  get hasApplyLink(): boolean {
    return /^https?:\/\//i.test(this.applyLink);
  }

  get postedLabel(): string {
    if (!this.job?.postedDate) return 'Recently posted';
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(this.job.postedDate));
  }

  ngOnInit(): void {
    this.subscription.add(
      this.route.paramMap.pipe(
        switchMap((params) => {
          this.isLoading = true;
          this.errorMessage = '';
          this.job = null;
          this.cdr.markForCheck();
          return this.jobService.getJobById(params.get('id') || '').pipe(
            finalize(() => {
              this.isLoading = false;
              this.cdr.markForCheck();
            })
          );
        })
      ).subscribe({
        next: (job) => {
          this.job = job;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Unable to load this job. Refresh Jobs Hub and try again.';
          this.cdr.markForCheck();
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  applyNow(): void {
    if (!this.hasApplyLink) return;
    window.open(this.applyLink, '_blank', 'noopener,noreferrer');
  }
}
