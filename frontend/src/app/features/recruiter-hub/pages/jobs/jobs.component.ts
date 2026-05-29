import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
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
  private readonly fb = inject(FormBuilder);

  jobs: any[] = [];
  loading = true;
  saving = false;
  error = '';
  notice = '';
  fieldErrors: Record<string, string> = {};
  editingJobId = '';

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
  });

  private pendingConfirmAction: (() => void) | null = null;

  constructor(
    private readonly hubService: RecruiterHubService,
    private readonly jobService: RecruiterJobService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.loadJobs();
  }

  get submitLabel(): string {
    return this.editingJobId ? 'Update Job' : 'Create Job';
  }

  get isSubmitDisabled(): boolean {
    return this.saving || this.jobForm.invalid;
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

  loadJobs(): void {
    this.loading = true;
    this.error = '';
    this.jobService.listJobs().subscribe({
      next: (response) => {
        this.jobs = this.sortJobs(response?.jobs || []);
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
    this.clearMessages();
    this.fieldErrors = {};
    this.editingJobId = String(job?._id || '');
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
      },
      { emitEvent: false },
    );
    this.jobForm.markAsPristine();
  }

  archiveJob(job: any): void {
    if (String(job?.status || '').toLowerCase() === 'closed') return;
    this.openConfirm(
      'Archive job',
      `Archive ${job?.title || 'this job'}? It will be moved to closed status.`,
      'Archive',
      () => {
        this.clearMessages();
        this.jobService.archiveJob(job._id).subscribe({
          next: (response) => {
            this.notice = `${job?.title || 'Job'} archived.`;
            this.replaceJob(response?.job || { ...job, status: 'closed' });
            this.hubService.clearCache();
          },
          error: (err) => {
            this.error = this.extractApiError(err, 'Unable to archive this job.');
          },
        });
      },
    );
  }

  deleteJob(job: any): void {
    this.openConfirm(
      'Delete job',
      `Delete ${job?.title || 'this job'}? This action cannot be undone.`,
      'Delete',
      () => {
        this.clearMessages();
        this.jobService.deleteJob(job._id).subscribe({
          next: () => {
            this.notice = `${job?.title || 'Job'} deleted.`;
            this.jobs = this.jobs.filter(
              (entry) => String(entry?._id || '') !== String(job?._id || ''),
            );
            if (this.editingJobId === String(job?._id || '')) {
              this.resetForm();
            }
            this.hubService.clearCache();
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
    this.editingJobId = '';
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
    this.saving = true;
    const payload = {
      ...this.jobForm.getRawValue(),
      requiredSkills: this.toArray(this.jobForm.getRawValue().requiredSkills),
      preferredSkills: this.toArray(this.jobForm.getRawValue().preferredSkills),
    };

    const request$ = this.editingJobId
      ? this.jobService.updateJob(this.editingJobId, payload)
      : this.jobService.createJob(payload);

    request$.subscribe({
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
        this.saving = false;
        this.hubService.clearCache();
      },
      error: (err) => {
        this.saving = false;
        this.applyApiErrors(err, 'Unable to save this job.');
      },
    });
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
