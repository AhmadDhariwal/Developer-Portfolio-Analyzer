import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';

@Component({
  selector: 'app-recruiter-jobs',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hub-header">
        <div>
          <span class="hub-kicker">Recruiter Hub</span>
          <h1>Jobs</h1>
          <p>Create, update, archive, and manage recruiter-owned jobs with live backend data.</p>
        </div>
        <div class="hub-summary">
          <strong>{{ jobs.length }}</strong>
          <span>Jobs in view</span>
        </div>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <div class="message message--success" *ngIf="notice">{{ notice }}</div>

      <form class="glass-form" (ngSubmit)="saveJob()">
        <div class="field">
          <label>Job title</label>
          <input [(ngModel)]="form.title" name="title" placeholder="Senior React Developer" required />
        </div>
        <div class="field">
          <label>Role label</label>
          <input [(ngModel)]="form.role" name="role" placeholder="Frontend Engineer" />
        </div>
        <div class="field">
          <label>Stack</label>
          <input [(ngModel)]="form.stack" name="stack" placeholder="React, TypeScript" />
        </div>
        <div class="field">
          <label>Location</label>
          <input [(ngModel)]="form.location" name="location" placeholder="Remote or on-site" />
        </div>
        <div class="field">
          <label>Employment type</label>
          <select [(ngModel)]="form.employmentType" name="employmentType">
            <option value="full-time">Full-time</option>
            <option value="part-time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select [(ngModel)]="form.status" name="status">
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div class="field">
          <label>Minimum experience</label>
          <input [(ngModel)]="form.minExperienceYears" name="minExperienceYears" type="number" min="0" placeholder="3" />
        </div>
        <div class="field">
          <label>Required skills</label>
          <input [(ngModel)]="form.requiredSkills" name="requiredSkills" placeholder="React, TypeScript, Testing" />
        </div>
        <div class="field">
          <label>Preferred skills</label>
          <input [(ngModel)]="form.preferredSkills" name="preferredSkills" placeholder="Next.js, GraphQL" />
        </div>
        <div class="field field--wide">
          <label>Description</label>
          <textarea [(ngModel)]="form.description" name="description" placeholder="Describe responsibilities, team setup, and hiring goals." required></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="ghost-btn" (click)="resetForm()">Clear</button>
          <button type="submit" class="primary-btn">{{ editingJobId ? 'Update Job' : 'Create Job' }}</button>
        </div>
      </form>

      <app-recruiter-loader *ngIf="loading" label="Loading jobs..." />

      <div class="card-grid" *ngIf="!loading && jobs.length > 0">
        <app-job-card
          *ngFor="let job of jobs"
          [job]="job"
          (view)="openJob(job)"
          (edit)="editJob(job)"
          (archive)="archiveJob(job)"
          (remove)="deleteJob(job)" />
      </div>

      <app-recruiter-empty-state
        *ngIf="!loading && jobs.length === 0"
        title="No jobs yet"
        message="Create your first recruiter job to start generating match results and shortlist activity." />
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hub-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-end;flex-wrap:wrap}
    .hub-kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;color:#f8fafc;font-size:2rem}
    .hub-header p{margin:.4rem 0 0;color:#94a3b8;max-width:720px}
    .hub-summary{padding:1rem 1.2rem;border-radius:20px;background:linear-gradient(135deg,rgba(79,70,229,.22),rgba(14,165,233,.14));border:1px solid rgba(99,102,241,.22);display:flex;flex-direction:column;align-items:flex-end}
    .hub-summary strong{color:#f8fafc;font-size:1.5rem;line-height:1}
    .hub-summary span{margin-top:.35rem;color:#cbd5e1;font-size:.82rem}
    .message{padding:.85rem 1rem;border-radius:14px;font-size:.88rem}
    .message--error{background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .message--success{background:rgba(6,78,59,.45);border:1px solid rgba(52,211,153,.2);color:#bbf7d0}
    .glass-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.9rem;padding:1rem 1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .field{display:flex;flex-direction:column;gap:.4rem}
    .field--wide{grid-column:1/-1}
    label{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
    input,textarea,select{width:100%;border-radius:12px;border:1px solid rgba(71,85,105,.75);background:rgba(15,23,42,.86);color:#f8fafc;padding:.78rem .9rem;outline:none}
    textarea{min-height:120px;resize:vertical}
    .form-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:.75rem;flex-wrap:wrap}
    .primary-btn,.ghost-btn{min-height:42px;border:none;border-radius:12px;font-weight:700;cursor:pointer;padding:0 1rem}
    .primary-btn{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff}
    .ghost-btn{background:rgba(30,41,59,.92);color:#e2e8f0}
    .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}
  `]
})
export class JobsComponent implements OnInit {
  jobs: any[] = [];
  loading = true;
  error = '';
  notice = '';
  editingJobId = '';
  form: any = {
    title: '',
    role: '',
    description: '',
    stack: '',
    location: '',
    employmentType: 'full-time',
    status: 'open',
    minExperienceYears: 0,
    requiredSkills: '',
    preferredSkills: ''
  };

  constructor(private readonly jobService: RecruiterJobService, private readonly router: Router) {}

  ngOnInit(): void {
    this.loadJobs();
  }

  loadJobs(): void {
    this.loading = true;
    this.error = '';
    this.jobService.listJobs().subscribe({
      next: (response) => {
        this.jobs = response?.jobs || [];
        this.loading = false;
      },
      error: (err) => {
        this.jobs = [];
        this.error = err?.error?.message || 'Unable to load jobs right now.';
        this.loading = false;
      }
    });
  }

  saveJob(): void {
    this.error = '';
    this.notice = '';
    const payload = {
      ...this.form,
      requiredSkills: this.toArray(this.form.requiredSkills),
      preferredSkills: this.toArray(this.form.preferredSkills)
    };

    const stream$ = this.editingJobId
      ? this.jobService.updateJob(this.editingJobId, payload)
      : this.jobService.createJob(payload);

    stream$.subscribe({
      next: () => {
        this.notice = this.editingJobId ? 'Job updated successfully.' : 'Job created successfully.';
        this.resetForm();
        this.loadJobs();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to save this job.';
      }
    });
  }

  editJob(job: any): void {
    this.editingJobId = String(job?._id || '');
    this.form = {
      title: job.title || '',
      role: job.role || '',
      description: job.description || '',
      stack: job.stack || '',
      location: job.location || '',
      employmentType: job.employmentType || 'full-time',
      status: job.status || 'open',
      minExperienceYears: Number(job.minExperienceYears || 0),
      requiredSkills: (job.requiredSkills || []).join(', '),
      preferredSkills: (job.preferredSkills || []).join(', ')
    };
  }

  archiveJob(job: any): void {
    if (String(job?.status || '') === 'closed') return;
    this.error = '';
    this.notice = '';
    this.jobService.archiveJob(job._id).subscribe({
      next: () => {
        this.notice = `${job?.title || 'Job'} archived.`;
        this.loadJobs();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to archive this job.';
      }
    });
  }

  deleteJob(job: any): void {
    this.error = '';
    this.notice = '';
    this.jobService.deleteJob(job._id).subscribe({
      next: () => {
        this.notice = `${job?.title || 'Job'} deleted.`;
        this.loadJobs();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to delete this job.';
      }
    });
  }

  openJob(job: any): void {
    this.router.navigate(['/app/recruiter/jobs', job._id]);
  }

  resetForm(): void {
    this.editingJobId = '';
    this.form = {
      title: '',
      role: '',
      description: '',
      stack: '',
      location: '',
      employmentType: 'full-time',
      status: 'open',
      minExperienceYears: 0,
      requiredSkills: '',
      preferredSkills: ''
    };
  }

  private toArray(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
