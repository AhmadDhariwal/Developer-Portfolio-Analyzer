import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-comparison',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Compare Candidates</h1><p>Review 2–3 candidates side by side.</p></div>
      <app-recruiter-loader *ngIf="loading" label="Loading comparison..." />
      <app-comparison-table *ngIf="!loading && comparison.length > 0" [items]="comparison" />
      <app-recruiter-empty-state *ngIf="!loading && comparison.length === 0" title="Select candidates to compare" message="Open candidates or matches and send them into the comparison workspace." />
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}`]
})
export class ComparisonComponent implements OnInit {
  loading = true;
  comparison: any[] = [];

  constructor(private readonly route: ActivatedRoute, private readonly matchService: RecruiterMatchService) {}

  ngOnInit(): void {
    const ids = String(this.route.snapshot.queryParamMap.get('ids') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (ids.length < 2) {
      this.loading = false;
      return;
    }

    this.matchService.compareCandidates({ candidateIds: ids }).subscribe({
      next: (response) => {
        this.comparison = response?.comparison || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
}
