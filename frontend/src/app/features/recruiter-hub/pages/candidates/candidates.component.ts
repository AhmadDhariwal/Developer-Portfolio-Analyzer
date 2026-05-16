import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidates',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Candidates</h1><p>Explore public and organization-allowed developer profiles.</p></div>
      <app-candidate-filter-bar [model]="filters" [stackOptions]="stackOptions" [locationOptions]="locationOptions" (apply)="loadCandidates()" />
      <app-recruiter-loader *ngIf="loading" label="Loading candidates..." />
      <div class="card-grid" *ngIf="!loading && candidates.length > 0">
        <app-candidate-card *ngFor="let candidate of candidates" [candidate]="candidate" (view)="openCandidate($event)" (shortlist)="shortlist($event)" (compare)="toggleCompare($event)" />
      </div>
      <app-recruiter-empty-state *ngIf="!loading && candidates.length === 0" title="No candidates found" message="Adjust filters to expand the recruiter pool." />
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}`]
})
export class CandidatesComponent implements OnInit {
  loading = true;
  candidates: any[] = [];
  filters: any = { search: '', stack: '', location: '', skills: '', minReadiness: 0 };
  stackOptions: any[] = [];
  locationOptions: any[] = [];
  private compareIds = new Set<string>();

  constructor(
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.loadCandidates();
  }

  loadCandidates(): void {
    this.loading = true;
    this.candidateService.listCandidates(this.filters).subscribe({
      next: (response) => {
        this.candidates = response?.candidates || [];
        this.stackOptions = (response?.filters?.stacks || []).map((label: string) => ({ value: label, label }));
        this.locationOptions = (response?.filters?.locations || []).map((label: string) => ({ value: label, label }));
        this.loading = false;
      },
      error: () => {
        this.candidates = [];
        this.loading = false;
      }
    });
  }

  openCandidate(candidate: any): void {
    this.router.navigate(['/app/recruiter/candidates', candidate.id || candidate.userId]);
  }

  shortlist(candidate: any): void {
    this.matchService.addToShortlist({ candidateId: candidate.id || candidate.userId }).subscribe();
  }

  toggleCompare(candidate: any): void {
    const id = String(candidate.id || candidate.userId || '');
    if (!id) return;
    if (this.compareIds.has(id)) {
      this.compareIds.delete(id);
    } else if (this.compareIds.size < 3) {
      this.compareIds.add(id);
    }
    if (this.compareIds.size >= 2) {
      this.router.navigate(['/app/recruiter/comparison'], { queryParams: { ids: Array.from(this.compareIds).join(',') } });
    }
  }
}
