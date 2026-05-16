import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-activity-logs',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Activity Logs</h1><p>Recruiter-scoped activity only.</p></div>
      <div class="filter-bar">
        <app-searchable-select [options]="actionOptions" [value]="filters.action" [emptyOptionLabel]="'All actions'" (valueChange)="filters.action = $event" />
        <app-searchable-select [options]="candidateOptions" [value]="filters.candidateId" [emptyOptionLabel]="'All candidates'" (valueChange)="filters.candidateId = $event" />
        <app-searchable-select [options]="jobOptions" [value]="filters.jobId" [emptyOptionLabel]="'All jobs'" (valueChange)="filters.jobId = $event" />
        <input [(ngModel)]="filters.from" type="date" />
        <input [(ngModel)]="filters.to" type="date" />
        <button type="button" (click)="loadActivity()">Apply</button>
      </div>
      <app-recruiter-loader *ngIf="loading" label="Loading recruiter activity..." />
      <app-activity-timeline *ngIf="!loading && logs.length > 0" [items]="logs" />
      <app-recruiter-empty-state *ngIf="!loading && logs.length === 0" title="No recruiter activity yet" message="Candidate views, analysis, shortlists, and match actions will appear here." />
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.filter-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72)}input{width:100%;min-height:42px;border-radius:10px;border:1px solid rgba(51,65,85,.8);background:rgba(15,23,42,.65);color:#f8fafc;padding:.7rem .85rem}button{border:none;border-radius:10px;padding:.75rem 1rem;background:#6366f1;color:#fff;font-weight:700;cursor:pointer}`]
})
export class RecruiterActivityLogsComponent implements OnInit {
  loading = true;
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
    this.hubService.getActivity(this.filters).subscribe({
      next: (response) => {
        this.logs = response?.logs || [];
        this.actionOptions = (response?.filters?.actions || []).map((label: string) => ({ value: label, label }));
        this.candidateOptions = (response?.filters?.candidates || []).map((item: any) => ({ value: item._id, label: item.name }));
        this.jobOptions = (response?.filters?.jobs || []).map((item: any) => ({ value: item._id, label: item.title }));
        this.loading = false;
      },
      error: () => {
        this.logs = [];
        this.loading = false;
      }
    });
  }
}
