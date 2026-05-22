import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidates',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hub-header">
        <div>
          <span class="hub-kicker">Recruiter Hub</span>
          <h1>Candidates</h1>
          <p>Search, filter, shortlist, and compare real candidates from your scoped talent pool.</p>
        </div>
        <div class="hub-summary">
          <strong>{{ meta.total || 0 }}</strong>
          <span>Visible candidates</span>
        </div>
      </header>

      <app-candidate-filter-bar
        [model]="filters"
        [stackOptions]="stackOptions"
        [locationOptions]="locationOptions"
        (apply)="applyFilters()"
        (clear)="clearFilters()" />

      <div class="toolbar">
        <div class="toolbar__chips">
          <span class="toolbar__chip">Page {{ meta.page || 1 }} of {{ meta.totalPages || 1 }}</span>
          <span class="toolbar__chip">{{ compareCount }} selected for comparison</span>
        </div>
        <button type="button" class="toolbar__action" [disabled]="compareCount < 2" (click)="openComparison()">Compare Selected</button>
      </div>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <div class="message message--success" *ngIf="notice">{{ notice }}</div>

      <app-recruiter-loader *ngIf="loading" label="Loading candidates..." />

      <div class="card-grid" *ngIf="!loading && candidates.length > 0">
        <app-candidate-card
          *ngFor="let candidate of candidates"
          [candidate]="candidate"
          [selected]="isSelected(candidate)"
          (view)="openCandidate($event)"
          (shortlist)="shortlist($event)"
          (compare)="toggleCompare($event)" />
      </div>

      <div class="pager" *ngIf="!loading && meta.totalPages > 1">
        <button type="button" (click)="goToPage(meta.page - 1)" [disabled]="meta.page <= 1">Previous</button>
        <button
          type="button"
          *ngFor="let page of visiblePages"
          [class.is-active]="page === meta.page"
          (click)="goToPage(page)">
          {{ page }}
        </button>
        <button type="button" (click)="goToPage(meta.page + 1)" [disabled]="meta.page >= meta.totalPages">Next</button>
      </div>

      <app-recruiter-empty-state
        *ngIf="!loading && candidates.length === 0"
        title="No candidates found"
        message="Try widening the stack, score, or skills filters to surface more of the scoped talent pool." />
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hub-header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-end;flex-wrap:wrap}
    .hub-kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .hub-header h1{margin:0;color:#f8fafc;font-size:2rem}
    .hub-header p{margin:.4rem 0 0;color:#94a3b8;max-width:720px}
    .hub-summary{padding:1rem 1.2rem;border-radius:20px;background:linear-gradient(135deg,rgba(79,70,229,.22),rgba(14,165,233,.14));border:1px solid rgba(99,102,241,.22);display:flex;flex-direction:column;align-items:flex-end}
    .hub-summary strong{color:#f8fafc;font-size:1.5rem;line-height:1}
    .hub-summary span{margin-top:.35rem;color:#cbd5e1;font-size:.82rem}
    .toolbar{display:flex;justify-content:space-between;gap:.85rem;align-items:center;flex-wrap:wrap}
    .toolbar__chips{display:flex;flex-wrap:wrap;gap:.55rem}
    .toolbar__chip{padding:.36rem .7rem;border-radius:999px;background:rgba(30,41,59,.88);color:#cbd5e1;font-size:.74rem}
    .toolbar__action,.pager button{min-height:40px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem}
    .toolbar__action[disabled],.pager button[disabled]{opacity:.45;cursor:not-allowed}
    .message{padding:.85rem 1rem;border-radius:14px;font-size:.88rem}
    .message--error{background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .message--success{background:rgba(6,78,59,.45);border:1px solid rgba(52,211,153,.2);color:#bbf7d0}
    .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:1rem}
    .pager{display:flex;gap:.55rem;justify-content:flex-end;flex-wrap:wrap}
    .pager button{background:rgba(30,41,59,.92);color:#e2e8f0}
    .pager button.is-active{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff}
  `]
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
