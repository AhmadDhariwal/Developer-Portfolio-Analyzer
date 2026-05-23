import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidates',
  standalone: false,
  templateUrl: './candidates.component.html',
  styleUrl: './candidates.component.css'
})
export class CandidatesComponent implements OnInit {
  loading = true;
  error = '';
  notice = '';
  candidates: any[] = [];
  filters: any = {
    search: '',
    stack: '',
    location: '',
    skills: '',
    minReadiness: 0,
    sortBy: 'score-desc',
    page: 1,
    limit: 12
  };
  meta: any = { page: 1, totalPages: 1, total: 0 };
  stackOptions: any[] = [];
  locationOptions: any[] = [];
  private readonly compareIds = new Set<string>();

  constructor(
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.loadCandidates();
  }

  get compareCount(): number {
    return this.compareIds.size;
  }

  get visiblePages(): number[] {
    const totalPages = Number(this.meta?.totalPages || 1);
    const current = Number(this.meta?.page || 1);
    const start = Math.max(1, current - 1);
    const end = Math.min(totalPages, start + 2);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  }

  loadCandidates(): void {
    this.loading = true;
    this.error = '';
    this.notice = '';
    this.candidateService.listCandidates(this.filters).subscribe({
      next: (response) => {
        this.candidates = response?.candidates || [];
        this.meta = response?.meta || { page: 1, totalPages: 1, total: this.candidates.length };
        this.stackOptions = (response?.filters?.stacks || []).map((label: string) => ({ value: label, label }));
        this.locationOptions = (response?.filters?.locations || []).map((label: string) => ({ value: label, label }));
        this.loading = false;
      },
      error: (err) => {
        this.candidates = [];
        this.error = err?.error?.message || 'Unable to load candidates right now.';
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    this.filters = { ...this.filters, page: 1 };
    this.loadCandidates();
  }

  clearFilters(): void {
    this.filters = {
      search: '',
      stack: '',
      location: '',
      skills: '',
      minReadiness: 0,
      sortBy: 'score-desc',
      page: 1,
      limit: 12
    };
    this.loadCandidates();
  }

  goToPage(page: number): void {
    if (page < 1 || page > Number(this.meta?.totalPages || 1) || page === this.meta?.page) return;
    this.filters = { ...this.filters, page };
    this.loadCandidates();
  }

  openCandidate(candidate: any): void {
    this.router.navigate(['/app/recruiter/candidates', this.getCandidateId(candidate)]);
  }

  shortlist(candidate: any): void {
    const candidateId = this.getCandidateId(candidate);
    if (!candidateId) return;

    this.matchService.addToShortlist({ candidateId }).subscribe({
      next: () => {
        this.notice = `${candidate?.name || candidate?.fullName || 'Candidate'} added to shortlist.`;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to shortlist this candidate.';
      }
    });
  }

  toggleCompare(candidate: any): void {
    const id = this.getCandidateId(candidate);
    if (!id) return;

    if (this.compareIds.has(id)) {
      this.compareIds.delete(id);
      return;
    }

    if (this.compareIds.size >= 3) {
      this.error = 'You can compare up to 3 candidates at a time.';
      return;
    }

    this.compareIds.add(id);
    this.error = '';
  }

  openComparison(): void {
    if (this.compareIds.size < 2) return;
    this.router.navigate(['/app/recruiter/comparison'], {
      queryParams: { ids: Array.from(this.compareIds).join(',') }
    });
  }

  isSelected(candidate: any): boolean {
    return this.compareIds.has(this.getCandidateId(candidate));
  }

  private getCandidateId(candidate: any): string {
    return String(candidate?.id || candidate?.userId || '').trim();
  }
}
