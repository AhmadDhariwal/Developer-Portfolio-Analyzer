import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-activity-logs',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hero">
        <div>
          <span class="hero__kicker">Activity Logs</span>
          <h1>Recruiter activity</h1>
          <p>Filter recruiter-scoped activity across candidate reviews, AI analysis, and pipeline actions.</p>
        </div>
      </header>

      <div class="filter-bar">
        <app-searchable-select [options]="actionOptions" [value]="filters.action" [emptyOptionLabel]="'All actions'" (valueChange)="filters.action = $event" />
        <app-searchable-select [options]="candidateOptions" [value]="filters.candidateId" [emptyOptionLabel]="'All candidates'" (valueChange)="filters.candidateId = $event" />
        <app-searchable-select [options]="jobOptions" [value]="filters.jobId" [emptyOptionLabel]="'All jobs'" (valueChange)="filters.jobId = $event" />
        <input [(ngModel)]="filters.from" type="date" />
        <input [(ngModel)]="filters.to" type="date" />
        <button type="button" (click)="loadActivity()">Apply</button>
      </div>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <app-recruiter-loader *ngIf="loading" label="Loading recruiter activity..." />
      <app-activity-timeline *ngIf="!loading && logs.length > 0" [items]="logs" />
      <app-recruiter-empty-state *ngIf="!loading && logs.length === 0" title="No recruiter activity yet" message="Candidate views, AI summaries, shortlists, and match actions will appear here." />
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hero{padding:1.2rem;border-radius:24px;background:linear-gradient(135deg,rgba(17,24,39,.96),rgba(30,41,59,.88));border:1px solid rgba(99,102,241,.2);box-shadow:0 24px 48px rgba(2,6,23,.32)}
    .hero__kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .hero h1{margin:0;color:#f8fafc;font-size:2rem}
    .hero p{margin:.4rem 0 0;color:#94a3b8;max-width:760px}
    .filter-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;padding:1rem;border-radius:20px;background:linear-gradient(180deg,rgba(15,23,42,.92),rgba(15,23,42,.78));border:1px solid rgba(99,102,241,.18);box-shadow:0 20px 40px rgba(2,6,23,.24)}
    input{width:100%;min-height:42px;border-radius:12px;border:1px solid rgba(71,85,105,.75);background:rgba(15,23,42,.86);color:#f8fafc;padding:.72rem .85rem}
    button{min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem}
    .message--error{padding:.85rem 1rem;border-radius:14px;background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
  `]
})
export class RecruiterActivityLogsComponent implements OnInit {
  loading = true;
  error = '';
  logs: any[] = [];
  filters: any = { action: '', candidateId: '', jobId: '', from: '', to: '' };
  actionOptions: any[] = [];
  candidateOptions: any[] = [];
  jobOptions: any[] = [];

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.loadActivity();
  }

  loadActivity(): void {
    this.loading = true;
    this.error = '';
    this.hubService.getActivity(this.filters).subscribe({
      next: (response) => {
        this.logs = response?.logs || [];
        this.actionOptions = (response?.filters?.actions || []).map((label: string) => ({ value: label, label }));
        this.candidateOptions = (response?.filters?.candidates || []).map((item: any) => ({ value: item._id, label: item.name }));
        this.jobOptions = (response?.filters?.jobs || []).map((item: any) => ({ value: item._id, label: item.title }));
        this.loading = false;
      },
      error: (err) => {
        this.logs = [];
        this.error = err?.error?.message || 'Unable to load recruiter activity.';
        this.loading = false;
      }
    });
  }
}
