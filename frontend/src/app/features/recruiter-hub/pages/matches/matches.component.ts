import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-matches',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Matches</h1><p>Generate AI-backed candidate to job matches.</p></div>
      <div class="glass-form">
        <app-searchable-select [options]="jobOptions" [value]="selectedJobId" [emptyOptionLabel]="'Select a job'" (valueChange)="selectedJobId = $event" />
        <button type="button" (click)="runMatches()">Generate Matches</button>
      </div>
      <app-recruiter-loader *ngIf="loading" label="Loading matches..." />
      <div class="card-grid" *ngIf="!loading && matches.length > 0">
        <app-match-card *ngFor="let match of matches" [match]="match" (shortlist)="shortlist(match)" (compare)="compare(match)" />
      </div>
      <app-recruiter-empty-state *ngIf="!loading && matches.length === 0" title="No matches yet" message="Pick a job and generate matches to build your pipeline." />
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.glass-form{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:.75rem;padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72)}button{border:none;border-radius:10px;padding:.75rem 1rem;background:#6366f1;color:#fff;font-weight:700;cursor:pointer}.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}`]
})
export class MatchesComponent implements OnInit {
  loading = true;
  jobs: any[] = [];
  matches: any[] = [];
  selectedJobId = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService
  ) {}

  get jobOptions(): any[] {
    return this.jobs.map((job) => ({ value: job._id, label: job.title, meta: job.status }));
  }

  ngOnInit(): void {
    this.selectedJobId = this.route.snapshot.queryParamMap.get('jobId') || '';
    this.jobService.listJobs().subscribe({
      next: (response) => {
        this.jobs = response?.jobs || [];
        this.loadMatches();
      }
    });
  }

  loadMatches(): void {
    this.loading = true;
    this.matchService.listMatches(this.selectedJobId ? { jobId: this.selectedJobId } : {}).subscribe({
      next: (response) => {
        this.matches = response?.matches || [];
        this.loading = false;
      },
      error: () => {
        this.matches = [];
        this.loading = false;
      }
    });
  }

  runMatches(): void {
    if (!this.selectedJobId) return;
    this.loading = true;
    this.matchService.generateMatches({ jobId: this.selectedJobId }).subscribe({
      next: (response) => {
        this.matches = response?.matches || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  shortlist(match: any): void {
    this.matchService.addToShortlist({ candidateId: match.candidateId, jobId: match.jobId }).subscribe();
  }

  compare(match: any): void {
    this.router.navigate(['/app/recruiter/comparison'], { queryParams: { ids: match.candidateId } });
  }
}
