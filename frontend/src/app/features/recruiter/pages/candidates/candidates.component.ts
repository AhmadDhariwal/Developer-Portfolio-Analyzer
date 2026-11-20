import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CandidateFilters, DEFAULT_CANDIDATE_FILTERS } from '../../models/recruiter.model';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidates',
  templateUrl: './candidates.component.html',
  styleUrl: './candidates.component.scss',
  standalone: false,
})
export class CandidatesComponent implements OnInit {
  loading = true;
  error = '';
  notice = '';
  candidates: any[] = [];
  filters: CandidateFilters = { ...DEFAULT_CANDIDATE_FILTERS };
  meta: any = { page: 1, totalPages: 1, total: 0 };
  stackOptions: Array<{ label: string; value: string }> = [];
  locationOptions: Array<{ label: string; value: string }> = [];

  private readonly compareIds = new Set<string>();
  private readonly compareNames = new Map<string, string>();
  private readonly destroyRef = inject(DestroyRef);
  private candidateRequest?: Subscription;

  constructor(
    private candidateService: CandidateService,
    private matchService: RecruiterMatchService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadCandidates();
  }

  get compareCount(): number {
    return this.compareIds.size;
  }

  get selectedCompareItems(): Array<{ id: string; name: string }> {
    return Array.from(this.compareIds).map((id) => ({
      id,
      name: this.compareNames.get(id) || 'Candidate',
    }));
  }

  get highReadinessCount(): number {
    return this.candidates.filter(
      (item) => Number(item?.readinessScore ?? item?.score ?? 0) >= 80,
    ).length;
  }

  get remoteCount(): number {
    return this.candidates.filter((item) =>
      String(item?.availability || '')
        .toLowerCase()
        .includes('remote'),
    ).length;
  }

  get visiblePages(): number[] {
    const current = Math.max(1, Number(this.meta?.page || 1));
    const total = Math.max(1, Number(this.meta?.totalPages || 1));
    const start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    const pages: number[] = [];
    for (let page = adjustedStart; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  }

  loadCandidates(): void {
    this.candidateRequest?.unsubscribe();
    this.loading = true;
    this.error = '';

    this.candidateRequest = this.candidateService
      .listCandidates(this.filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.candidates = response?.candidates || [];
          this.meta = response?.meta || { page: 1, totalPages: 1, total: this.candidates.length };
          for (const candidate of this.candidates) {
            const cid = this.candidateId(candidate);
            if (cid && !this.compareNames.has(cid)) {
              this.compareNames.set(cid, candidate?.name || candidate?.fullName || 'Candidate');
            }
          }
          const stacks = response?.filters?.stacks || [];
          const locations = response?.filters?.locations || [];
          this.stackOptions = stacks.map((stack: string) => ({ label: stack, value: stack }));
          this.locationOptions = locations.map((loc: string) => ({ label: loc, value: loc }));
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to load candidates right now.';
          this.loading = false;
        },
      });
  }

  applyFilters(filters: CandidateFilters): void {
    this.filters = { ...filters, page: 1 };
    this.loadCandidates();
  }

  clearFilters(): void {
    this.filters = { ...DEFAULT_CANDIDATE_FILTERS };
    this.loadCandidates();
  }

  goToPage(page: number): void {
    const total = Math.max(1, Number(this.meta?.totalPages || 1));
    const target = Math.min(Math.max(1, page), total);
    if (target === this.filters.page) {
      return;
    }
    this.filters = { ...this.filters, page: target };
    this.loadCandidates();
  }

  openCandidate(candidate: any): void {
    const id = this.candidateId(candidate);
    if (!id) {
      return;
    }
    this.router.navigate(['/app/recruiter/candidates', id]);
  }

  shortlist(candidate: any): void {
    const id = this.candidateId(candidate);
    if (!id) {
      return;
    }
    this.error = '';
    this.notice = '';

    this.matchService.addToShortlist({ candidateId: id }).subscribe({
      next: () => {
        this.notice = `${candidate?.name || candidate?.fullName || 'Candidate'} added to shortlist.`;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not shortlist candidate.';
      },
    });
  }

  toggleCompare(candidate: any): void {
    const id = this.candidateId(candidate);
    if (!id) {
      return;
    }
    this.error = '';
    this.notice = '';

    if (this.compareIds.has(id)) {
      this.compareIds.delete(id);
      return;
    }
    if (this.compareIds.size >= 3) {
      this.error = 'Select up to 3 candidates for comparison.';
      return;
    }
    this.compareNames.set(id, candidate?.name || candidate?.fullName || 'Candidate');
    this.compareIds.add(id);
  }

  removeCompareId(id: string): void {
    this.compareIds.delete(id);
  }

  clearCompare(): void {
    this.compareIds.clear();
  }

  openComparison(): void {
    if (this.compareIds.size < 2) {
      this.error = 'Select at least 2 candidates to compare side by side.';
      return;
    }
    this.router.navigate(['/app/recruiter/comparison'], {
      queryParams: { ids: Array.from(this.compareIds).join(',') },
    });
  }

  isSelected(candidate: any): boolean {
    const id = this.candidateId(candidate);
    return id ? this.compareIds.has(id) : false;
  }

  trackByCandidate(index: number, candidate: any): string {
    return String(candidate?.id || candidate?.userId || candidate?._id || candidate?.name || index);
  }

  private candidateId(candidate: any): string {
    return String(candidate?.id || candidate?.userId || candidate?._id || '').trim();
  }
}
