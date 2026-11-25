import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subscription, combineLatest, distinctUntilChanged, map, of } from 'rxjs';
import { AuthService } from '../../../../shared/services/auth.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { finalize } from 'rxjs/operators';
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
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);
  private scopeKey = '';
  private activeRecruiterId = '';
  private activeOrganizationId = '';
  private requestVersion = 0;
  private knownTotalPages = 1;
  private restartOnRetry = false;
  private readonly pageCursors = new Map<number, string>();
  loading = true;
  error = '';
  actionError = '';
  notice = '';
  candidates: any[] = [];
  filters: CandidateFilters = { ...DEFAULT_CANDIDATE_FILTERS };
  meta: any = { page: 1, totalPages: 1, total: 0 };
  stackOptions: Array<{ label: string; value: string }> = [];
  optionsTruncated = false;
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
    combineLatest([this.auth.currentUser$, this.tenant.state$ || of(this.tenant.snapshot)])
      .pipe(
        map(([user, tenant]) => ({
          user,
          organizationId: String(tenant?.organizationId || user?.['organizationId'] || ''),
          key: `${user?._id || ''}:${user?.role || ''}:${tenant?.organizationId || user?.['organizationId'] || ''}`,
        })),
        distinctUntilChanged((previous, current) => previous.key === current.key),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ user, key, organizationId }) => {
        this.activeRecruiterId = String(user?._id || '');
        this.activeOrganizationId = organizationId;
        this.scopeKey = key;
        this.requestVersion++;
        this.candidateRequest?.unsubscribe();
        this.filters = { ...DEFAULT_CANDIDATE_FILTERS };
        this.resetResults();
        this.clearCompare();
        this.compareNames.clear();
        this.pageCursors.clear();
        this.knownTotalPages = 1;
        this.notice = '';
        this.error = '';
        this.actionError = '';
        if (user && String(user.role).toLowerCase() === 'recruiter') this.loadCandidates();
        else {
          this.loading = false;
          this.cdr.markForCheck();
        }
      });
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
    return this.candidates.filter((item) => Number(item?.readinessScore ?? item?.score ?? 0) >= 80)
      .length;
  }

  get remoteCount(): number {
    return this.candidates.filter((item) =>
      `${item?.location || ''} ${item?.availability || ''}`.toLowerCase().includes('remote'),
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
    const version = ++this.requestVersion;
    this.loading = true;
    this.error = '';
    this.restartOnRetry = false;
    this.actionError = '';
    this.resetResults();
    this.cdr.markForCheck();
    const params = Object.fromEntries(
      Object.entries(this.filters).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number>;
    const cursor = this.pageCursors.get(this.filters.page);
    if (cursor) params['cursor'] = cursor;

    this.candidateRequest = this.candidateService
      .listCandidates(params)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cdr.markForCheck()),
      )
      .subscribe({
        next: (response: any) => {
          if (version !== this.requestVersion) return;
          if (
            !Array.isArray(response?.candidates) ||
            !Number.isSafeInteger(response?.meta?.total) ||
            response.meta.total < response.candidates.length ||
            !Number.isSafeInteger(response.meta.page) ||
            response.meta.page < 1 ||
            !Number.isSafeInteger(response.meta.totalPages) ||
            response.meta.totalPages < 1
          ) {
            this.resetResults();
            this.loading = false;
            this.error = 'Unexpected candidate response. Retry this search.';
            this.cdr.markForCheck();
            return;
          }
          if (
            (response?.meta?.organizationId &&
              this.activeOrganizationId &&
              response.meta.organizationId !== this.activeOrganizationId) ||
            (response?.meta?.recruiterId && response.meta.recruiterId !== this.activeRecruiterId)
          ) {
            this.resetResults();
            this.loading = false;
            this.error = 'Organization or account context changed. Refresh your session and retry.';
            this.cdr.markForCheck();
            return;
          }
          this.candidates = response?.candidates || [];
          this.meta = response?.meta || { page: 1, totalPages: 1, total: this.candidates.length };
          this.knownTotalPages = Math.max(1, Number(this.meta.totalPages || 1));
          if (this.meta.nextCursor)
            this.pageCursors.set(this.filters.page + 1, this.meta.nextCursor);
          if (this.pageCursors.size > 100) {
            for (const page of this.pageCursors.keys())
              if (Math.abs(page - this.filters.page) > 50) this.pageCursors.delete(page);
          }
          for (const candidate of this.candidates) {
            const cid = this.candidateId(candidate);
            if (cid && this.compareIds.has(cid)) {
              this.compareNames.set(cid, candidate?.name || candidate?.fullName || 'Candidate');
            }
          }
          this.optionsTruncated = response?.filters?.optionsTruncated === true;
          const stacks = response?.filters?.stacks || [];
          const locations = response?.filters?.locations || [];
          this.stackOptions = stacks.map((stack: string) => ({ label: stack, value: stack }));
          this.locationOptions = locations.map((loc: string) => ({ label: loc, value: loc }));
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          if (version !== this.requestVersion) return;
          this.restartOnRetry = err?.error?.code === 'CANDIDATE_CURSOR_INVALID';
          this.resetResults();
          this.error = err?.error?.message || 'Unable to load candidates right now.';
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  retryCandidates(): void {
    if (this.restartOnRetry) {
      this.pageCursors.clear();
      this.filters = { ...this.filters, page: 1 };
      this.knownTotalPages = 1;
    }
    this.loadCandidates();
  }

  applyFilters(filters: CandidateFilters): void {
    this.pageCursors.clear();
    this.knownTotalPages = 1;
    this.filters = { ...filters, page: 1 };
    this.loadCandidates();
  }

  clearFilters(): void {
    this.pageCursors.clear();
    this.knownTotalPages = 1;
    this.filters = { ...DEFAULT_CANDIDATE_FILTERS };
    this.loadCandidates();
  }

  goToPage(page: number): void {
    const total = this.knownTotalPages;
    const target = Math.min(Math.max(1, page), total);
    if (
      !Number.isSafeInteger(target) ||
      !this.canVisitPage(target) ||
      target === this.filters.page
    ) {
      return;
    }
    this.filters = { ...this.filters, page: target };
    this.loadCandidates();
  }

  canVisitPage(page: number): boolean {
    return page >= 1 && ((page - 1) * this.filters.limit <= 50000 || this.pageCursors.has(page));
  }

  private resetResults(): void {
    this.candidates = [];
    this.optionsTruncated = false;
    this.meta = { page: this.filters.page, totalPages: 1, total: 0, hasNext: false };
    this.stackOptions = [];
    this.locationOptions = [];
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
    this.actionError = '';
    this.notice = '';

    const scope = this.scopeKey;
    this.matchService
      .addToShortlist({ candidateId: id })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cdr.markForCheck()),
      )
      .subscribe({
        next: () => {
          if (scope !== this.scopeKey) return;
          this.notice = `${candidate?.name || candidate?.fullName || 'Candidate'} added to shortlist.`;
        },
        error: (err) => {
          if (scope !== this.scopeKey) return;
          this.actionError = err?.error?.message || 'Could not shortlist candidate.';
        },
      });
  }

  toggleCompare(candidate: any): void {
    const id = this.candidateId(candidate);
    if (!id) {
      return;
    }
    this.actionError = '';
    this.notice = '';

    if (this.compareIds.has(id)) {
      this.compareIds.delete(id);
      return;
    }
    if (this.compareIds.size >= 3) {
      this.actionError = 'Select up to 3 candidates for comparison.';
      return;
    }
    this.compareNames.set(id, candidate?.name || candidate?.fullName || 'Candidate');
    this.compareIds.add(id);
  }

  removeCompareId(id: string): void {
    this.compareIds.delete(id);
    this.compareNames.delete(id);
  }

  clearCompare(): void {
    this.compareIds.clear();
    this.compareNames.clear();
  }

  openComparison(): void {
    if (this.compareIds.size < 2) {
      this.actionError = 'Select at least 2 candidates to compare side by side.';
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
