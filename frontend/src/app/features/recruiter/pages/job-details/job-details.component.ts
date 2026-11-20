import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
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

  loading = true;
  generating = false;
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
      return;
    }

    this.loading = true;
    this.error = '';
    this.jobService.getJob(this.currentJobId).subscribe({
      next: (response) => {
        this.job = response?.job || null;
        this.loading = false;
        this.loadExistingMatches();
      },
      error: (err) => {
        this.job = null;
        this.error = err?.error?.message || 'Unable to load this job.';
        this.loading = false;
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
        this.router.navigate(['/app/recruiter/matches'], {
          queryParams: { jobId: this.job._id },
        });
      },
      error: (err) => {
        this.generating = false;
        this.error = err?.error?.message || 'Unable to generate matches for this job.';
      },
    });
  }

  private loadExistingMatches(): void {
    if (!this.job?._id) return;
    this.matchService.listMatches({ jobId: this.job._id }).subscribe({
      next: (response) => {
        this.jobMatches = (response?.matches || []).slice(0, 5);
      },
      error: () => {
        this.jobMatches = [];
      },
    });
  }
}
