import { Component, OnInit } from '@angular/core';

import { RecruiterJob, RecruiterService } from '../../services/recruiter.service';
import { RecruiterMessageService } from '../../../recruiter-shared/services/recruiter-message.service';

@Component({
  selector: 'app-job-management-page',
  standalone: false,
  templateUrl: './job-management.component.html',
  styleUrls: ['./job-management.component.scss']
})
export class JobManagementPageComponent implements OnInit {
  jobs: RecruiterJob[] = [];
  editingJobId = '';
  showDeleteDialog = false;
  pendingDeleteJobId = '';

  form = {
    title: '',
    role: '',
    description: '',
    stack: '',
    requiredSkills: '',
    preferredSkills: '',
    minExperienceYears: 0,
    location: '',
    employmentType: 'full-time' as RecruiterJob['employmentType'],
    status: 'open' as RecruiterJob['status']
  };

  constructor(
    public readonly recruiterService: RecruiterService,
    private readonly recruiterMessage: RecruiterMessageService
  ) {}

  ngOnInit(): void {
    this.loadJobs();
  }

  loadJobs(): void {
    this.recruiterService.getJobs().subscribe({
      next: (jobs) => {
        this.jobs = jobs;
      },
      error: () => {
        this.jobs = [];
        this.recruiterMessage.error('Failed to load recruiter jobs.');
      }
    });
  }

  saveJob(): void {
    const payload = {
      title: this.form.title,
      role: this.form.role,
      description: this.form.description,
      stack: this.form.stack,
      requiredSkills: this.splitSkills(this.form.requiredSkills),
      preferredSkills: this.splitSkills(this.form.preferredSkills),
      minExperienceYears: this.form.minExperienceYears,
      location: this.form.location,
      employmentType: this.form.employmentType,
      status: this.form.status
    };

    const request$ = this.editingJobId
      ? this.recruiterService.updateJob(this.editingJobId, payload)
      : this.recruiterService.createJob(payload);

    request$.subscribe({
      next: () => {
        this.recruiterMessage.success(this.editingJobId ? 'Job updated successfully.' : 'Job created successfully.');
        this.resetForm();
        this.loadJobs();
      },
      error: () => {
        this.recruiterMessage.error('Failed to save job.');
      }
    });
  }

  startEdit(job: RecruiterJob): void {
    this.editingJobId = job._id;
    this.form = {
      title: job.title,
      role: job.role,
      description: job.description,
      stack: job.stack,
      requiredSkills: (job.requiredSkills || []).join(', '),
      preferredSkills: (job.preferredSkills || []).join(', '),
      minExperienceYears: job.minExperienceYears,
      location: job.location,
      employmentType: job.employmentType,
      status: job.status
    };
  }

  askDelete(jobId: string): void {
    this.pendingDeleteJobId = jobId;
    this.showDeleteDialog = true;
  }

  confirmDelete(): void {
    if (!this.pendingDeleteJobId) {
      this.showDeleteDialog = false;
      return;
    }

    this.recruiterService.deleteJob(this.pendingDeleteJobId).subscribe({
      next: () => {
        this.recruiterMessage.success('Job deleted successfully.');
        this.showDeleteDialog = false;
        this.pendingDeleteJobId = '';
        this.loadJobs();
      },
      error: () => {
        this.recruiterMessage.error('Failed to delete job.');
      }
    });
  }

  cancelDelete(): void {
    this.showDeleteDialog = false;
    this.pendingDeleteJobId = '';
  }

  resetForm(): void {
    this.editingJobId = '';
    this.form = {
      title: '',
      role: '',
      description: '',
      stack: '',
      requiredSkills: '',
      preferredSkills: '',
      minExperienceYears: 0,
      location: '',
      employmentType: 'full-time',
      status: 'open'
    };
  }

  private splitSkills(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
