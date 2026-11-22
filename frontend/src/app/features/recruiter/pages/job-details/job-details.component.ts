import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-job-details',
  standalone: false,
  templateUrl: './job-details.component.html',
  styleUrl: './job-details.component.scss',
})
export class JobDetailsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  generating = false;
  publishing = false;
  error = '';
  job: any = null;
  jobMatches: any[] = [];
  private currentJobId = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService,
  ) {}

  ngOnInit(): void {
    const paramStream = this.route.paramMap;
    if (paramStream) {
      paramStream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        this.currentJobId = params.get('id') || '';
        this.loadJob();
      });
      return;
    }
    this.currentJobId = this.route.snapshot?.paramMap?.get('id') || '';
    this.loadJob();
  }

  get salaryLabel(): string {
    const min = Number(this.job?.salaryRangeMin || 0);
    const max = Number(this.job?.salaryRangeMax || 0);
    if (min <= 0 && max <= 0) return 'Not specified';
    if (min > 0 && max > 0) return `$${min.toLocaleString()} - $${max.toLocaleString()}`;
    return min > 0 ? `From $${min.toLocaleString()}` : `Up to $${max.toLocaleString()}`;
  }

  get statusToneClass(): string {
    const status = String(this.job?.status || 'open').toLowerCase();
    if (status === 'draft') return 'status-pill status-pill--draft';
    if (status === 'closed') return 'status-pill status-pill--closed';
    return 'status-pill status-pill--open';
  }

  loadJob(): void {
    if (!this.currentJobId) {
      this.loading = false;
      this.error = 'Job identifier is missing.';
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.error = '';
    forkJoin({
      jobResponse: this.jobService.getJob(this.currentJobId),
      matchesResponse: this.matchService
        .listMatches({ jobId: this.currentJobId })
        .pipe(catchError(() => of({ matches: [] }))),
    }).subscribe({
      next: ({ jobResponse, matchesResponse }) => {
        this.job = jobResponse?.job || null;
        this.jobMatches = (matchesResponse?.matches || []).slice(0, 5);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.job = null;
        this.jobMatches = [];
        this.error = err?.error?.message || 'Unable to load this job.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  generateMatches(): void {
    if (!this.job?._id || this.generating) return;
    this.generating = true;
    this.error = '';
    this.matchService.generateMatches({ jobId: this.job._id }).subscribe({
      next: () => {
        this.generating = false;
        this.cdr.markForCheck();
        this.router.navigate(['/app/recruiter/matches'], {
          queryParams: { jobId: this.job._id },
        });
      },
      error: (err) => {
        this.generating = false;
        this.error = err?.error?.message || 'Unable to generate matches for this job.';
        this.cdr.markForCheck();
      },
    });
  }

  togglePublication(): void {
    if (!this.job || this.publishing) return;
    this.publishing = true;
    this.error = '';
    this.jobService.updateJob(this.job._id, { published: !this.job.published }).subscribe({
      next: (response) => {
        this.job = response.job;
        this.publishing = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.error = error.error?.message || 'Unable to update publication.';
        this.publishing = false;
        this.cdr.markForCheck();
      },
    });
  }
}
