import { Component, OnInit } from '@angular/core';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-shortlists',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Shortlists</h1><p>Track shortlisted candidates by role and follow-up stage.</p></div>
      <app-recruiter-loader *ngIf="loading" label="Loading shortlists..." />
      <div class="card-grid" *ngIf="!loading && shortlists.length > 0">
        <app-shortlist-card *ngFor="let item of shortlists" [item]="item" (edit)="markInterview(item)" (remove)="remove(item)" />
      </div>
      <app-recruiter-empty-state *ngIf="!loading && shortlists.length === 0" title="No shortlists yet" message="Shortlist candidates from matches or candidate profiles." />
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}`]
})
export class ShortlistsComponent implements OnInit {
  loading = true;
  shortlists: any[] = [];

  constructor(private readonly matchService: RecruiterMatchService) {}

  ngOnInit(): void {
    this.loadShortlists();
  }

  loadShortlists(): void {
    this.loading = true;
    this.matchService.getShortlists().subscribe({
      next: (response) => {
        this.shortlists = response?.shortlists || [];
        this.loading = false;
      },
      error: () => {
        this.shortlists = [];
        this.loading = false;
      }
    });
  }

  markInterview(item: any): void {
    this.matchService.updateShortlist(item._id, { status: 'interview' }).subscribe(() => this.loadShortlists());
  }

  remove(item: any): void {
    this.matchService.removeShortlist(item._id).subscribe(() => this.loadShortlists());
  }
}
