import { Component, OnInit } from '@angular/core';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-shortlists',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hub-header">
        <div>
          <span class="hub-kicker">Recruiter Hub</span>
          <h1>Shortlists</h1>
          <p>Track the candidates already moved into your pipeline and push them through the next follow-up stage.</p>
        </div>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <div class="message message--success" *ngIf="notice">{{ notice }}</div>

      <app-recruiter-loader *ngIf="loading" label="Loading shortlists..." />

      <div class="card-grid" *ngIf="!loading && shortlists.length > 0">
        <app-shortlist-card *ngFor="let item of shortlists" [item]="item" (edit)="advance(item)" (remove)="remove(item)" />
      </div>

      <app-recruiter-empty-state *ngIf="!loading && shortlists.length === 0" title="No shortlists yet" message="Shortlist candidates from match results or the candidate profile to start follow-up tracking." />
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hub-kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;color:#f8fafc;font-size:2rem}
    .hub-header p{margin:.4rem 0 0;color:#94a3b8;max-width:720px}
    .message{padding:.85rem 1rem;border-radius:14px;font-size:.88rem}
    .message--error{background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .message--success{background:rgba(6,78,59,.45);border:1px solid rgba(52,211,153,.2);color:#bbf7d0}
    .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem}
  `]
})
export class ShortlistsComponent implements OnInit {
  loading = true;
  error = '';
  notice = '';
  shortlists: any[] = [];

  constructor(private readonly matchService: RecruiterMatchService) {}

  ngOnInit(): void {
    this.loadShortlists();
  }

  loadShortlists(): void {
    this.loading = true;
    this.error = '';
    this.matchService.getShortlists().subscribe({
      next: (response) => {
        this.shortlists = response?.shortlists || [];
        this.loading = false;
      },
      error: (err) => {
        this.shortlists = [];
        this.error = err?.error?.message || 'Unable to load shortlist entries.';
        this.loading = false;
      }
    });
  }

  advance(item: any): void {
    const nextStatus = this.nextStatus(String(item?.status || 'shortlisted'));
    this.matchService.updateShortlist(item._id, { status: nextStatus }).subscribe({
      next: () => {
        this.notice = `${item?.candidate?.name || 'Candidate'} moved to ${nextStatus}.`;
        this.loadShortlists();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to update this shortlist entry.';
      }
    });
  }

  remove(item: any): void {
    this.matchService.removeShortlist(item._id).subscribe({
      next: () => {
        this.notice = `${item?.candidate?.name || 'Candidate'} removed from shortlist.`;
        this.loadShortlists();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to remove this shortlist entry.';
      }
    });
  }

  private nextStatus(status: string): string {
    const order = ['shortlisted', 'reviewing', 'contacted', 'interview'];
    const currentIndex = order.indexOf(status);
    if (currentIndex < 0 || currentIndex === order.length - 1) return 'interview';
    return order[currentIndex + 1];
  }
}
