import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';

@Component({
  selector: 'app-recruiter-jobs',
  standalone: false,
  templateUrl: './jobs.component.html',
  styleUrl: './jobs.component.css'
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
