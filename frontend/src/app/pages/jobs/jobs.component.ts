import {
  Component, OnInit, OnDestroy,
  ChangeDetectorRef, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

import { JobService }           from '../../shared/services/job.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { Job, JobFilters, DEFAULT_JOB_FILTERS } from '../../shared/models/job.model';
import { JobCardComponent }     from '../../shared/components/job-card/job-card';
import { JobFiltersComponent }  from '../../shared/components/job-filters/job-filters';

const INITIAL_DISPLAY = 10;
const PAGE_SIZE       = 10;

@Component({
  selector:        'app-jobs',
  standalone:      true,
  imports:         [CommonModule, FormsModule, JobCardComponent, JobFiltersComponent],
  templateUrl:     './jobs.component.html',
  styleUrl:        './jobs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobsComponent implements OnInit, OnDestroy {
  allJobs:       Job[]       = [];
  displayCount:  number      = INITIAL_DISPLAY;
  isLoading:     boolean     = false;
  isLoadingMore: boolean     = false;
  errorMessage:  string      = '';
  currentPage:   number      = 0;
  totalPages:    number      = 1;
  totalJobs:     number      = 0;
  activeFilters: JobFilters  = { ...DEFAULT_JOB_FILTERS };
  pendingFilters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  isMobileFiltersOpen        = false;

  // Expose constants to template
  readonly INITIAL_DISPLAY = INITIAL_DISPLAY;
  readonly PAGE_SIZE       = PAGE_SIZE;

  // ── Two-phase Load More ────────────────────────────────────────────────────
  get displayedJobs():    Job[]    { return this.allJobs.slice(0, this.displayCount); }
  get hasHiddenJobs():    boolean  { return this.displayCount < this.allJobs.length; }
  get hasMorePages():     boolean  { return !this.hasHiddenJobs && this.currentPage > 0 && this.currentPage < this.totalPages; }
  get canShowLoadMore():  boolean  { return !this.isLoading && (this.hasHiddenJobs || this.hasMorePages); }
  get hiddenCount():      number   { return Math.max(0, this.allJobs.length - this.displayCount); }

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly jobService:           JobService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr:                  ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Initialize pending filters with active filters
    this.pendingFilters = { ...this.activeFilters };
    
    // Load jobs on initial page load
    this.resetAndFetch();
    
    // React to career profile changes
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged((a, b) =>
          a.careerStack === b.careerStack && a.experienceLevel === b.experienceLevel
        )
      ).subscribe(() => this.resetAndFetch())
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  // ── Filter change emitted from child (stored but not applied immediately) ──
  onFiltersChange(filters: JobFilters): void {
    this.pendingFilters = { ...filters };
    this.cdr.markForCheck();
  }

  // ── Apply filters button click ─────────────────────────────────────────────
  applyFilters(): void {
    this.activeFilters = { ...this.pendingFilters };
    this.resetAndFetch();
    this.isMobileFiltersOpen = false;
    this.cdr.markForCheck();
  }

  onFiltersReset(): void {
    this.pendingFilters = { ...DEFAULT_JOB_FILTERS };
    this.activeFilters = { ...DEFAULT_JOB_FILTERS };
    this.resetAndFetch();
  }

  // ── Fetch helpers ─────────────────────────────────────────────────────────
  private resetAndFetch(): void {
    this.allJobs      = [];
    this.displayCount = INITIAL_DISPLAY;
    this.currentPage  = 0;
    this.totalPages   = 1;
    this.totalJobs    = 0;
    this.errorMessage = '';
    this.fetchPage(1, false);
  }

  private fetchPage(page: number, append: boolean): void {
    if (append) {
      this.isLoadingMore = true;
    } else {
      this.isLoading = true;
    }
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.subscriptions.add(
      this.jobService.getJobs(this.activeFilters, page, PAGE_SIZE).subscribe({
        next: (res) => {
          if (append) {
            this.allJobs      = [...this.allJobs, ...res.jobs];
            this.displayCount = this.allJobs.length;
          } else {
            this.allJobs      = res.jobs;
            this.displayCount = INITIAL_DISPLAY;
          }
          this.currentPage   = res.page;
          this.totalPages    = res.totalPages;
          this.totalJobs     = res.total;
          this.isLoading     = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.errorMessage  = err?.error?.message || 'Failed to load jobs. Please try again.';
          this.isLoading     = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
        }
      })
    );
  }

  // ── Load More (two-phase) ─────────────────────────────────────────────────
  loadMore(): void {
    if (this.isLoadingMore) return;
    if (this.hasHiddenJobs) {
      // Phase 1: reveal already-fetched hidden jobs
      this.displayCount = this.allJobs.length;
      this.cdr.markForCheck();
      return;
    }
    if (this.hasMorePages) {
      // Phase 2: fetch next page from backend
      this.fetchPage(this.currentPage + 1, true);
    }
  }

  toggleMobileFilters(): void {
    this.isMobileFiltersOpen = !this.isMobileFiltersOpen;
    this.cdr.markForCheck();
  }

  retry(): void {
    this.resetAndFetch();
  }

  trackById(_: number, job: Job): string {
    return job.id;
  }
}
