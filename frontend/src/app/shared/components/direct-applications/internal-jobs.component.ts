import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import { formatInitials, truncateSha256 } from './direct-application-ui.utils';
import { SubmittedPortfolioComponent } from './submitted-portfolio.component';
import {
  ApplicationOptions,
  DirectApplication,
  InternalJob,
  JobApplicationsService,
} from '../../services/job-applications.service';

@Component({
  selector: 'app-internal-jobs',
  standalone: true,
  imports: [CommonModule, FormsModule, SubmittedPortfolioComponent],
  templateUrl: './internal-jobs.component.html',
  styleUrl: './internal-jobs.component.scss',
})
export class InternalJobsComponent implements OnInit {
  private readonly api = inject(JobApplicationsService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router, { optional: true });
  readonly jobsState = { loading: false, loaded: false, error: '', request: new Subscription() };
  readonly optionsState = { loading: false, loaded: false, error: '', request: new Subscription() };
  readonly historyState = { loading: false, loaded: false, error: '', request: new Subscription() };
  get loading() {
    return this.jobsState.loading || this.optionsState.loading || this.historyState.loading;
  }
  get canApply() {
    return this.jobsState.loaded && this.optionsState.loaded && this.historyState.loaded;
  }
  busy = false;
  error = '';
  notice = '';
  withdrawal: DirectApplication | null = null;
  jobs: InternalJob[] = [];
  applications: DirectApplication[] = [];
  options: ApplicationOptions = { resumes: [], portfolio: null, portfolioHash: '' };
  selected: InternalJob | null = null;
  resumeId = '';
  consent = false;
  sharePortfolio = false;
  ngOnInit() {
    this.load();
  }
  load() {
    if (this.busy) return;
    this.selected = null;
    this.loadJobs();
    this.loadOptions();
    this.loadHistory();
  }
  loadJobs() {
    if (this.busy) return;
    this.loadResource(this.jobsState, this.api.discover(), 'Unable to load internal jobs.', (r) => {
      this.jobs = r.jobs;
    });
  }
  loadOptions() {
    if (this.busy) return;
    this.selected = null;
    this.loadResource(
      this.optionsState,
      this.api.options(),
      'Unable to load resume and portfolio options.',
      (r) => {
        this.options = r;
      },
    );
  }
  loadHistory() {
    if (this.busy) return;
    this.loadResource(
      this.historyState,
      this.api.mine(),
      'Unable to load application history.',
      (r) => {
        this.applications = r.applications;
      },
    );
  }
  private loadResource<T>(
    state: typeof this.jobsState,
    request: Observable<T>,
    message: string,
    accept: (value: T) => void,
  ) {
    state.request.unsubscribe();
    state.loading = true;
    state.loaded = false;
    state.error = '';
    state.request = request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (value) => {
        accept(value);
        state.loading = false;
        state.loaded = true;
        this.cdr.markForCheck();
      },
      error: () => {
        state.loading = false;
        state.error = message;
        this.cdr.markForCheck();
      },
    });
  }
  applied(id: string) {
    return this.applications.find((a) => a.jobId === id);
  }
  choose(job: InternalJob) {
    this.selected = job;
    this.resumeId = '';
    this.consent = false;
    this.sharePortfolio = false;
    this.error = '';
    this.notice = '';
  }
  submit() {
    if (!this.selected || !this.resumeId || !this.consent || this.busy || !this.canApply) return;
    this.busy = true;
    this.error = '';
    this.api
      .submit(this.selected._id, this.resumeId, this.sharePortfolio, this.options.portfolioHash)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.applications = [
            result.application,
            ...this.applications.filter((a) => a._id !== result.application._id),
          ];
          this.busy = false;
          this.selected = null;
          this.notice =
            'Application submitted. The recruiter can access only your submitted evidence.';
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.error = error.error?.message || 'Submission failed. You can safely retry.';
          this.busy = false;
          this.cdr.markForCheck();
        },
      });
  }

  confirmWithdrawal() {
    const application = this.withdrawal;
    if (!application || this.busy) return;
    this.busy = true;
    this.error = '';
    this.api
      .withdraw(application._id, application.status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ application: updated }) => {
          this.applications = this.applications.map((item) =>
            item._id === updated._id ? updated : item,
          );
          this.withdrawal = null;
          this.busy = false;
          this.notice = 'Application withdrawn. Reapplication is unavailable for this job.';
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.busy = false;
          this.withdrawal = null;
          this.error =
            error.status === 409
              ? 'Application changed. History has been refreshed; review its current status.'
              : error.error?.message || 'Withdrawal failed. Please retry.';
          if (error.status === 409) this.loadHistory();
          this.cdr.markForCheck();
        },
      });
  }

  initials(value?: string): string {
    return formatInitials(value);
  }

  shortHash(digest?: string): string {
    return truncateSha256(digest);
  }

  openResumePage(event: Event): void {
    if (!this.router) return;
    event.preventDefault();
    void this.router.navigate(['/app/resume']);
  }
}
