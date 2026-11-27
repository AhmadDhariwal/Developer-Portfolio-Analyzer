import { DestroyRef as PolicyDestroyRef } from '@angular/core';
import { takeUntilDestroyed as takeUntilPolicyDestroyed } from '@angular/core/rxjs-interop';
import { OrganizationPolicyState } from '../../../../shared/services/organization-policy-state.service';
import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { RecruiterJobService } from '../../services/recruiter-job.service';

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
};

@Component({
  selector: 'app-recruiter-jobs',
  standalone: false,
  templateUrl: './jobs.component.html',
  styleUrl: './jobs.component.scss',
})
export class JobsComponent implements OnInit {
  readonly policies = inject(OrganizationPolicyState);
  private readonly policyDestroy = inject(PolicyDestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly cdr = inject(ChangeDetectorRef);

  jobs: any[] = [];
  teams: { _id: string; name: string }[] = [];
  editingAccess: Record<string, boolean> | null = null;
  editingVersion: number | undefined;
  editingNeedsReview = false;
  loading = true;
  saving = false;
  editorOpen = false;
  statusFilter: 'all' | 'open' | 'draft' | 'closed' = 'all';
  searchTerm = '';
  error = '';
  notice = '';
  fieldErrors: Record<string, string> = {};
  editingJobId = '';
  editingJobTitle = '';

  readonly confirmState = signal<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
  });

  readonly jobForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    role: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(2000)]],
    stack: ['', [Validators.required, Validators.maxLength(120)]],
    location: ['', [Validators.required, Validators.maxLength(120)]],
    employmentType: ['full-time', [Validators.required]],
    status: ['open', [Validators.required]],
    minExperienceYears: [0, [Validators.required, Validators.min(0)]],
    requiredSkills: ['', [Validators.required]],
    preferredSkills: [''],
    teamId: [''],
    teamShared: [false],
    evaluationShared: [false],
  });

  private pendingConfirmAction: (() => void) | null = null;

  constructor(
    private readonly jobService: RecruiterJobService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.policies.resourcesChanged$
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe(() => {
        if (this.editingJobId) this.editingNeedsReview = true;
        this.jobs = [];
        this.loadJobs();
        this.cdr.markForCheck();
      });
    this.policies.contextChanges$
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe(() => {
        this.jobs = [];
        this.teams = [];
        this.resetForm();
        this.editorOpen = false;
        this.loadJobs();
        this.cdr.markForCheck();
      });
    this.loadJobs();
  }

  get canManageSharing(): boolean {
    return !this.editingJobId || this.editingAccess?.['manageSharing'] === true;
  }
  get unavailableTeam(): boolean {
    const id = this.jobForm.controls.teamId.value;
    return !!id && !this.teams.some((team) => team._id === id);
  }
  get submitLabel(): string {
    return this.editingJobId ? 'Update Job' : 'Create Job';
  }

  get isSubmitDisabled(): boolean {
    return (
      this.saving ||
      this.editingNeedsReview ||
      (!this.editingJobId && !this.policies.allowed('recruiterJobCreation')) ||
      this.jobForm.invalid ||
      (!!this.editingJobId && this.editingAccess?.['edit'] !== true)
    );
  }

  get openJobsCount(): number {
    return this.jobs.filter((job) => String(job?.status || '').toLowerCase() === 'open').length;
  }

  get draftJobsCount(): number {
    return this.jobs.filter((job) => String(job?.status || '').toLowerCase() === 'draft').length;
  }

  get closedJobsCount(): number {
    return this.jobs.filter((job) => String(job?.status || '').toLowerCase() === 'closed').length;
  }

  get filteredJobs(): any[] {
    const query = this.searchTerm.trim().toLowerCase();
    return this.jobs
      .filter((job) => job.access?.isOwner === true || this.policies.allowed('teamSharedJobs'))
      .filter((job) => {
        const status = String(job?.status || 'open').toLowerCase();
        if (this.statusFilter !== 'all' && status !== this.statusFilter) return false;
        if (!query) return true;
        const hay = [
          job?.title,
          job?.role,
          job?.stack,
          job?.location,
          ...(job?.requiredSkills || []),
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(query);
      });
  }

  statusRatio(count: number): number {
    if (!this.jobs.length) return 0;
    return Math.round((count / this.jobs.length) * 100);
  }

  toggleEditor(): void {
    if (!this.editorOpen && !this.editingJobId && !this.policies.allowed('recruiterJobCreation'))
      return;
    if (this.editorOpen && this.editingJobId) {
      this.resetForm();
    }
    this.editorOpen = !this.editorOpen;
  }

  setStatusFilter(status: 'all' | 'open' | 'draft' | 'closed'): void {
    this.statusFilter = status;
  }

  loadJobs(): void {
    this.loading = true;
    this.error = '';
    this.jobService
      .listJobs(true)
      .pipe(finalize(() => this.cdr.markForCheck()))
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe({
        next: (response) => {
          this.jobs = this.sortJobs(response?.jobs || []);
          this.teams = response?.teams || [];
          this.loading = false;
        },
        error: (err) => {
          this.jobs = [];
          this.error = this.extractApiError(err, 'Unable to load jobs right now.');
          this.loading = false;
        },
      });
  }

  saveJob(): void {
    if (this.editingNeedsReview) return;
    if (this.saving || (this.editingJobId && !this.editingAccess?.['edit'])) return;
    if (!this.editingJobId && !this.policies.allowed('recruiterJobCreation')) return;
    if (
      this.editingJobId &&
      this.jobForm.controls.status.value === 'open' &&
      this.jobs.find((job) => job._id === this.editingJobId)?.published &&
      this.jobs.find((job) => job._id === this.editingJobId)?.status !== 'open' &&
      !this.policies.allowed('recruiterJobPublication')
    ) {
      this.error = this.policies.explanation('recruiterJobPublication');
      return;
    }
    this.clearMessages();
    this.fieldErrors = {};

    if (this.jobForm.invalid) {
      this.jobForm.markAllAsTouched();
      return;
    }

    if (this.editingJobId) {
      this.openConfirm(
        'Confirm update',
        'Apply these changes to this job posting?',
        'Update job',
        () => this.persistJob(),
      );
      return;
    }

    this.persistJob();
  }

  editJob(job: any): void {
    if (!job?.access?.edit) return;
    this.editingAccess = job.access;
    this.editingVersion = job.version;
    this.editingNeedsReview = false;
    this.clearMessages();
    this.fieldErrors = {};
    this.editingJobId = String(job?._id || '');
    this.editingJobTitle = String(job?.title || 'Job posting');
    this.editorOpen = true;
    this.jobForm.reset(
      {
        title: job?.title || '',
        role: job?.role || '',
        description: job?.description || '',
        stack: job?.stack || '',
        location: job?.location || '',
        employmentType: job?.employmentType || 'full-time',
        status: job?.status || 'open',
        minExperienceYears: Number(job?.minExperienceYears || 0),
        requiredSkills: (job?.requiredSkills || []).join(', '),
        preferredSkills: (job?.preferredSkills || []).join(', '),
        teamId: job?.teamId || '',
        teamShared: job?.teamShared === true,
        evaluationShared: job?.evaluationShared === true,
      },
      { emitEvent: false },
    );
    this.jobForm.markAsPristine();
  }

  archiveJob(job: any): void {
    if (!job?.access?.archive) return;
    if (String(job?.status || '').toLowerCase() === 'closed') return;
    this.openConfirm(
      'Archive job',
      `Archive ${job?.title || 'this job'}? It will be moved to closed status.`,
      'Archive',
      () => {
        this.clearMessages();
        this.jobService
          .archiveJob(job._id)
          .pipe(finalize(() => this.cdr.markForCheck()))
          .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
          .subscribe({
            next: (response) => {
              this.notice = `${job?.title || 'Job'} archived.`;
              this.replaceJob(response?.job || { ...job, status: 'closed' });
            },
            error: (err) => {
              this.error = this.extractApiError(err, 'Unable to archive this job.');
            },
          });
      },
    );
  }

  deleteJob(job: any): void {
    if (!job?.access?.delete) return;
    this.openConfirm(
      'Delete job',
      `Delete ${job?.title || 'this job'}? This action cannot be undone.`,
      'Delete',
      () => {
        this.clearMessages();
        this.jobService
          .deleteJob(job._id)
          .pipe(finalize(() => this.cdr.markForCheck()))
          .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
          .subscribe({
            next: () => {
              this.notice = `${job?.title || 'Job'} deleted.`;
              this.jobs = this.jobs.filter(
                (entry) => String(entry?._id || '') !== String(job?._id || ''),
              );
              if (this.editingJobId === String(job?._id || '')) {
                this.resetForm();
              }
            },
            error: (err) => {
              this.error = this.extractApiError(err, 'Unable to delete this job.');
            },
          });
      },
    );
  }

  openJob(job: any): void {
    this.router.navigate(['/app/recruiter/jobs', job._id]);
  }

  resetForm(): void {
    this.editingNeedsReview = false;
    this.editingAccess = null;
    this.editingVersion = undefined;
    this.editingJobId = '';
    this.editingJobTitle = '';
    this.fieldErrors = {};
    this.jobForm.reset({
      title: '',
      role: '',
      description: '',
      stack: '',
      location: '',
      employmentType: 'full-time',
      status: 'open',
      minExperienceYears: 0,
      requiredSkills: '',
      preferredSkills: '',
      teamId: '',
      teamShared: false,
      evaluationShared: false,
    });
    this.jobForm.markAsPristine();
    this.jobForm.markAsUntouched();
  }

  onConfirmAccepted(): void {
    const action = this.pendingConfirmAction;
    this.closeConfirm();
    action?.();
  }

  onConfirmCancelled(): void {
    this.closeConfirm();
  }

  showControlError(controlName: string): boolean {
    if (this.fieldErrors[controlName]) return true;
    const control = this.jobForm.get(controlName);
    return Boolean(control && control.invalid && (control.touched || control.dirty));
  }

  controlError(controlName: string, fallback = 'This field is required.'): string {
    if (this.fieldErrors[controlName]) return this.fieldErrors[controlName];
    const control = this.jobForm.get(controlName);
    if (!control?.errors) return '';
    if (control.errors['required']) return fallback;
    if (control.errors['min']) return 'Value must be 0 or greater.';
    if (control.errors['maxlength']) return 'Value is too long.';
    return fallback;
  }

  private persistJob(): void {
    if (!this.editingJobId && !this.policies.allowed('recruiterJobCreation')) return;
    this.saving = true;
    const payload: Record<string, unknown> = {
      ...this.jobForm.getRawValue(),
      requiredSkills: this.toArray(this.jobForm.getRawValue().requiredSkills),
      preferredSkills: this.toArray(this.jobForm.getRawValue().preferredSkills),
    };

    if (this.editingJobId) {
      payload['expectedVersion'] = this.editingVersion;
      if (!this.canManageSharing) {
        delete payload['teamId'];
        delete payload['teamShared'];
        delete payload['evaluationShared'];
      }
    }
    if (this.editingJobId) {
      const original = this.jobs.find((job) => job._id === this.editingJobId);
      if (
        payload['teamShared'] === original?.teamShared ||
        !this.policies.allowed('teamSharedJobs')
      )
        delete payload['teamShared'];
      if (
        payload['evaluationShared'] === original?.evaluationShared ||
        !this.policies.allowed('sharedPublicEvaluations')
      )
        delete payload['evaluationShared'];
    } else {
      if (!this.policies.allowed('teamSharedJobs')) payload['teamShared'] = false;
      if (!this.policies.allowed('sharedPublicEvaluations')) payload['evaluationShared'] = false;
    }
    const request$ = this.editingJobId
      ? this.jobService.updateJob(this.editingJobId, payload)
      : this.jobService.createJob(payload);

    request$
      .pipe(finalize(() => this.cdr.markForCheck()))
      .pipe(takeUntilPolicyDestroyed(this.policyDestroy))
      .subscribe({
        next: (response) => {
          const savedJob = response?.job;
          const isEditing = Boolean(this.editingJobId);
          this.notice = isEditing ? 'Job updated successfully.' : 'Job created successfully.';
          if (savedJob) {
            if (isEditing) {
              this.replaceJob(savedJob);
            } else {
              this.jobs = this.sortJobs([savedJob, ...this.jobs]);
            }
          }
          this.resetForm();
          this.editorOpen = false;
          this.saving = false;
        },
        error: (err) => {
          this.saving = false;
          this.applyApiErrors(err, 'Unable to save this job.');
          if ([403, 404, 409].includes(err?.status)) {
            this.editingNeedsReview = true;
            const message = this.error;
            this.loadJobs();
            this.error = message;
          }
        },
      });
  }

  reviewCurrentJob(): void {
    const current = this.jobs.find((job) => job._id === this.editingJobId);
    if (!current?.access?.edit) {
      this.error =
        'Current job management access is unavailable. Your local draft is preserved until you cancel it.';
      return;
    }
    this.editingAccess = current.access;
    this.editingVersion = current.version;
    this.editingNeedsReview = false;
    this.notice =
      'Current resource permissions loaded. Review your preserved draft and save explicitly.';
  }

  private openConfirm(
    title: string,
    message: string,
    confirmText: string,
    action: () => void,
  ): void {
    this.pendingConfirmAction = action;
    this.confirmState.set({ open: true, title, message, confirmText });
  }

  private closeConfirm(): void {
    this.pendingConfirmAction = null;
    this.confirmState.set({
      open: false,
      title: '',
      message: '',
      confirmText: 'Confirm',
    });
  }

  private replaceJob(job: any): void {
    const id = String(job?._id || '');
    const index = this.jobs.findIndex((entry) => String(entry?._id || '') === id);
    if (index < 0) {
      this.jobs = this.sortJobs([job, ...this.jobs]);
      return;
    }

    const next = [...this.jobs];
    next[index] = job;
    this.jobs = this.sortJobs(next);
  }

  private sortJobs(jobs: any[]): any[] {
    return [...jobs].sort((left, right) => {
      const leftTime = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
      const rightTime = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
  }

  private applyApiErrors(err: any, fallbackMessage: string): void {
    this.error = this.extractApiError(err, fallbackMessage);
    const errors = err?.error?.errors;
    if (errors && typeof errors === 'object') {
      this.fieldErrors = Object.fromEntries(
        Object.entries(errors).map(([key, value]) => [key, String(value || '')]),
      );
    }
  }

  private extractApiError(err: any, fallbackMessage: string): string {
    return String(err?.error?.message || err?.message || fallbackMessage);
  }

  private clearMessages(): void {
    this.error = '';
    this.notice = '';
  }

  private toArray(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  trackByJob(index: number, job: any): string {
    return String(job?._id || index);
  }
}
