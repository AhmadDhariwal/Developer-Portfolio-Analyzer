import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-job-details',
  standalone: false,
  template: `
    <section class="hub-page">
      <app-recruiter-loader *ngIf="loading" label="Loading job details..." />
      <ng-container *ngIf="!loading && job">
        <div class="hub-header"><h1>{{ job.title }}</h1><p>{{ job.description }}</p></div>
        <div class="glass-card">
          <p><strong>Stack:</strong> {{ job.stack }}</p>
          <p><strong>Location:</strong> {{ job.location || 'Remote' }}</p>
          <p><strong>Status:</strong> {{ job.status }}</p>
          <div class="tag-row"><span *ngFor="let skill of job.requiredSkills">{{ skill }}</span></div>
        </div>
        <div class="action-row">
          <button type="button" (click)="generateMatches()">Generate Matches</button>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.glass-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72);color:#e2e8f0}.tag-row{display:flex;flex-wrap:wrap;gap:.45rem}.tag-row span{padding:.25rem .55rem;border-radius:999px;background:rgba(30,41,59,.86)}.action-row{display:flex;gap:.75rem}button{border:none;border-radius:10px;padding:.75rem 1rem;background:#6366f1;color:#fff;font-weight:700;cursor:pointer}`]
})
export class JobDetailsComponent implements OnInit {
  loading = true;
  job: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.jobService.getJob(id).subscribe({
      next: (response) => {
        this.job = response?.job || null;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  generateMatches(): void {
    if (!this.job?._id) return;
    this.matchService.generateMatches({ jobId: this.job._id }).subscribe({
      next: () => {
        this.router.navigate(['/app/recruiter/matches'], { queryParams: { jobId: this.job._id } });
      }
    });
  }
}
