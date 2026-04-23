import { Component, OnInit } from '@angular/core';

import { AdminHiringService, AdminJob, AdminRankedCandidate } from '../../services/admin-hiring.service';

@Component({
  selector: 'app-admin-jobs-page',
  standalone: false,
  templateUrl: './admin-jobs.component.html',
  styleUrls: ['./admin-jobs.component.scss']
})
export class AdminJobsPageComponent implements OnInit {
  loading = false;
  message = '';
  messageType: 'success' | 'error' | 'warning' = 'success';
  jobs: AdminJob[] = [];
  selectedJobId = '';
  ranking: AdminRankedCandidate[] = [];

  form = {
    title: '',
    role: '',
    description: '',
    stack: 'Full Stack',
    requiredSkills: '',
    preferredSkills: '',
    minExperienceYears: 0,
    location: '',
    employmentType: 'full-time' as AdminJob['employmentType'],
    status: 'open' as AdminJob['status']
  };

  constructor(private readonly adminService: AdminHiringService) {}

  ngOnInit(): void {
    this.loadJobs();
  }

  loadJobs(): void {
    this.loading = true;
    this.adminService.getJobs().subscribe({
      next: (jobs) => {
        this.jobs = jobs;
        if (!this.selectedJobId && jobs.length > 0) {
          this.selectedJobId = jobs[0]._id;
        }
        this.loading = false;
      },
      error: () => {
        this.messageType = 'error';
        this.message = 'Failed to load organization jobs.';
        this.loading = false;
      }
    });
  }

  createJob(): void {
    if (!this.form.title || !this.form.description) {
      this.messageType = 'warning';
      this.message = 'Title and description are required.';
      return;
    }

    this.loading = true;
    this.adminService.createJob({
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
    }).subscribe({
      next: () => {
        this.form = {
          title: '',
          role: '',
          description: '',
          stack: 'Full Stack',
          requiredSkills: '',
          preferredSkills: '',
          minExperienceYears: 0,
          location: '',
          employmentType: 'full-time',
          status: 'open'
        };
        this.messageType = 'success';
        this.message = 'Organization job created successfully.';
        this.loadJobs();
      },
      error: (err) => {
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to create job.');
        this.loading = false;
      }
    });
  }

  runRanking(): void {
    if (!this.selectedJobId) {
      this.messageType = 'warning';
      this.message = 'Select a job before running AI ranking.';
      return;
    }

    this.loading = true;
    this.adminService.rankCandidates(this.selectedJobId).subscribe({
      next: (ranking) => {
        this.ranking = ranking;
        this.messageType = 'success';
        this.message = 'AI candidate ranking completed.';
        this.loading = false;
      },
      error: () => {
        this.ranking = [];
        this.messageType = 'error';
        this.message = 'Failed to run AI ranking.';
        this.loading = false;
      }
    });
  }

  private splitSkills(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
}
