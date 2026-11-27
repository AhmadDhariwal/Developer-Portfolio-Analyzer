import {
  DestroyRef as PolicyDestroyRef,
  effect as policyEffect,
  untracked as policyUntracked,
} from '@angular/core';
import { takeUntilDestroyed as takeUntilPolicyDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationPolicyState } from '../../../../shared/services/organization-policy-state.service';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, Subscription, switchMap } from 'rxjs';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-job-details',
  standalone: false,
  templateUrl: './job-details.component.html',
  styleUrl: './job-details.component.scss',
})
export class JobDetailsComponent implements OnInit {
  readonly policies = inject(OrganizationPolicyState);
  private readonly policyDestroy = inject(PolicyDestroyRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  generating = false;
  publishing = false;
  error = '';
  job: any = null;
  jobMatches: any[] = [];
  private currentJobId = '';
  private request?: Subscription;
  get selectedApplicationId(): string {
    return this.route.snapshot?.queryParamMap?.get('applicationId') || '';
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService,
  ) {
    policyEffect(() => {
      const capabilities = this.policies.value();
      policyUntracked(() => {
        if (capabilities && this.job?.access?.isOwner === false) {
          if (!this.policies.allowed('teamSharedJobs')) {
            this.job = null;
            this.jobMatches = [];
            this.error = 'This resource is unavailable. Refresh the authorized workspace.';
          } else if (!this.policies.allowed('sharedPublicEvaluations')) this.jobMatches = [];
        }
        this.cdr.markForCheck();
      });
    });
  }

  ngOnInit(): void {
    this.policies.resourcesChanged$
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe(() => {
        this.loadJob();
        this.cdr.markForCheck();
      });
    this.policies.contextChanges$
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe(() => {
        this.request?.unsubscribe();
        this.job = null;
        this.jobMatches = [];
        this.loadJob();
        this.cdr.markForCheck();
      });
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
    this.request?.unsubscribe();
    this.job = null;
    this.jobMatches = [];
    if (!this.currentJobId) {
      this.loading = false;
      this.error = 'Job identifier is missing.';
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.error = '';
    this.request = this.jobService
      .getJob(this.currentJobId)
      .pipe(
        switchMap((jobResponse) =>
          (jobResponse?.job?.access?.evaluationView
            ? this.matchService
                .listMatches({ jobId: this.currentJobId })
                .pipe(catchError(() => of({ matches: [] })))
            : of({ matches: [] })
          ).pipe(map((matchesResponse) => ({ jobResponse, matchesResponse }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe({
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
    if (!this.job?._id || !this.policies.canGenerate(this.job?.access) || this.generating) return;
    this.generating = true;
    this.error = '';
    this.matchService
      .generateMatches({ jobId: this.job._id })
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe({
        next: () => {
          this.generating = false;
          this.cdr.markForCheck();
          this.router.navigate(['/app/recruiter/matches'], {
            queryParams: { jobId: this.job._id },
          });
        },
        error: (err) => {
          this.generating = false;
          this.error = this.policies.permissionError(
            err,
            'Unable to generate matches for this job.',
          );
          if ([403, 404, 409].includes(err.status)) this.loadJob();
          this.cdr.markForCheck();
        },
      });
  }

  togglePublication(): void {
    if (
      !this.job?.access?.edit ||
      this.publishing ||
      (!this.job.published &&
        (!this.job?.access?.publish || !this.policies.allowed('recruiterJobPublication')))
    )
      return;
    this.publishing = true;
    this.error = '';
    this.jobService
      .updateJob(this.job._id, {
        published: !this.job.published,
        expectedVersion: this.job.version,
      })
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe({
        next: (response) => {
          this.job = response.job;
          this.publishing = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          const message = error.error?.message || 'Unable to update publication.';
          this.publishing = false;
          if ([403, 404, 409].includes(error.status)) this.loadJob();
          this.error = message;
          this.cdr.markForCheck();
        },
      });
  }
}
