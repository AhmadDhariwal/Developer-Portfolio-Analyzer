import { Component, OnInit } from '@angular/core';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-shortlists',
  standalone: false,
  templateUrl: './shortlists.component.html',
  styleUrl: './shortlists.component.scss',
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
      },
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
      },
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
      },
    });
  }

  private nextStatus(status: string): string {
    const order = ['shortlisted', 'reviewing', 'contacted', 'interview'];
    const currentIndex = order.indexOf(status);
    if (currentIndex < 0 || currentIndex === order.length - 1) return 'interview';
    return order[currentIndex + 1];
  }
}
