import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-job-details',
  standalone: false,
  templateUrl: './job-details.component.html',
  styleUrl: './job-details.component.scss',
})
export class JobDetailsComponent implements OnInit {
  loading = true;
  error = '';
  job: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly hubService: RecruiterHubService,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService,
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.jobService.getJob(id).subscribe({
      next: (response) => {
        this.job = response?.job || null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load this job.';
        this.loading = false;
      },
    });
  }

  generateMatches(): void {
    if (!this.job?._id) return;
    this.matchService.generateMatches({ jobId: this.job._id }).subscribe({
      next: () => {
        this.hubService.clearCache();
        this.router.navigate(['/app/recruiter/matches'], { queryParams: { jobId: this.job._id } });
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to generate matches for this job.';
      },
    });
  }
}
