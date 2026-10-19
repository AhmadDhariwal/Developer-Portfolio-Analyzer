import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  EMPTY,
  Subject,
  Subscription,
  catchError,
  combineLatest,
  finalize,
  startWith,
  switchMap,
} from 'rxjs';
import { Job, JobActionField } from '../../shared/models/job.model';
import { JobService } from '../../shared/services/job.service';
import { JobActionsService } from '../../shared/services/job-actions.service';
import { AuthService } from '../../shared/services/auth.service';
import {
  jobDate,
  jobExpired,
  jobSalary,
  jobRequestError,
  safeJobUrl,
} from '../../shared/utils/job-presentation';
@Component({
  selector: 'app-job-details',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './job-details.component.html',
  styleUrl: './job-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobDetailsComponent implements OnInit, OnDestroy {
  job: Job | null = null;
  isLoading = true;
  errorMessage = '';
  notice = '';
  retryAt = 0;
  now = Date.now();
  readonly date = jobDate;
  readonly salary = jobSalary;
  readonly safeUrl = safeJobUrl;
  private readonly reload = new Subject<void>();
  private readonly subscriptions = new Subscription();
  private identity = '';
  private timer?: ReturnType<typeof setInterval>;
  private loadedAt = 0;
  constructor(
    private readonly route: ActivatedRoute,
    private readonly jobs: JobService,
    readonly actions: JobActionsService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}
  get applyLink(): string {
    return this.job && !jobExpired(this.job) ? safeJobUrl(this.job.applyUrl || this.job.url) : '';
  }
  get stale(): boolean {
    return !!this.job?.freshUntil && Date.parse(this.job.freshUntil) <= this.now;
  }
  get offline(): boolean {
    return !navigator.onLine;
  }
  get blocked(): boolean {
    return this.now < Math.max(this.retryAt, this.actions.retryAt) || !navigator.onLine;
  }
  ngOnInit(): void {
    this.subscriptions.add(
      combineLatest([
        this.route.paramMap,
        this.auth.currentUser$,
        this.reload.pipe(startWith(undefined)),
      ])
        .pipe(
          switchMap(([params, user]) => {
            const id = params.get('id') || '';
            const identity = JSON.stringify([
              id,
              user?._id || user?.['id'],
              user?.activeGithubUsername,
              user?.activeCareerStack || user?.careerStack,
              user?.activeExperienceLevel || user?.experienceLevel,
              user?.['activeResumeFileId'] || user?.['defaultResumeFileId'],
              user?.['updatedAt'],
            ]);
            if (this.identity !== identity) {
              this.job = null;
              this.identity = identity;
            }
            this.errorMessage = '';
            this.notice = '';
            this.isLoading = true;
            this.cdr.markForCheck();
            if (!user) {
              this.job = null;
              this.isLoading = false;
              return EMPTY;
            }
            return this.jobs.getJobById(id).pipe(
              catchError((error) => {
                const failure = jobRequestError(error);
                this.errorMessage = failure.message;
                this.retryAt = failure.retryAt;
                if ([401, 403, 404].includes(error.status)) this.job = null;
                return EMPTY;
              }),
              finalize(() => {
                this.isLoading = false;
                this.cdr.markForCheck();
              }),
            );
          }),
        )
        .subscribe((job) => {
          this.job = job;
          this.actions.seed([job]);
          this.loadedAt = Date.now();
          this.cdr.markForCheck();
        }),
    );
    this.subscriptions.add(this.actions.changes$.subscribe(() => this.cdr.markForCheck()));
    this.timer = setInterval(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }, 1000);
  }
  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }
  @HostListener('window:focus') focus(): void {
    if (!this.isLoading && Date.now() - this.loadedAt > 30000) this.retry();
  }
  @HostListener('window:online') online(): void {
    this.retry();
  }
  retry(): void {
    if (this.blocked) return;
    this.jobs.clearCache();
    this.reload.next();
  }
  mutate(field: JobActionField): void {
    if (!this.job || this.blocked) return;
    const id = this.job.id;
    const value = !this.actions.state(id)[field];
    this.subscriptions.add(
      this.actions.update(id, { [field]: value }).subscribe({
        next: () => {
          this.notice =
            field === 'applied'
              ? 'Your tracker was updated. No application was submitted.'
              : 'Activity synced to your account.';
          if (field === 'hidden' && value) this.job = null;
          this.cdr.markForCheck();
        },
        error: (error) => {
          const failure = jobRequestError(error);
          this.errorMessage = failure.message;
          this.retryAt = failure.retryAt;
          this.cdr.markForCheck();
        },
      }),
    );
  }
}
