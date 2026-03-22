import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CourseService }        from '../../shared/services/course.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  Course,
  CourseFilters,
  DEFAULT_FILTERS
} from '../../shared/models/course.model';
import { CourseCardComponent }    from '../../shared/components/course-card/course-card';
import { CourseFiltersComponent } from '../../shared/components/course-filters/course-filters';

const INITIAL_DISPLAY = 10;   // courses shown before the first Load More
const PAGE_SIZE       = 10;   // courses per backend page

@Component({
  selector:        'app-courses',
  standalone:      true,
  imports:         [CommonModule, FormsModule, CourseCardComponent, CourseFiltersComponent],
  templateUrl:     './courses.component.html',
  styleUrl:        './courses.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CoursesComponent implements OnInit, OnDestroy {

  // ── State ──────────────────────────────────────────────────────────────────
  /** All courses fetched from the backend so far (accumulates across pages). */
  allCourses:    Course[] = [];
  /** How many of allCourses are currently visible to the user. */
  displayCount:  number   = INITIAL_DISPLAY;

  isLoading:     boolean  = false;
  isLoadingMore: boolean  = false;
  errorMessage:  string   = '';

  currentPage:   number   = 0;   // 0 = nothing fetched yet
  totalPages:    number   = 1;
  totalCourses:  number   = 0;

  activeFilters: CourseFilters = { ...DEFAULT_FILTERS };
  isMobileFiltersOpen = false;

  readonly INITIAL_DISPLAY = INITIAL_DISPLAY;
  readonly PAGE_SIZE        = PAGE_SIZE;

  private readonly subscriptions = new Subscription();
  private readonly filterChanges = new Subject<CourseFilters>();

  // ── Computed properties ────────────────────────────────────────────────────

  get displayedCourses(): Course[] {
    return this.allCourses.slice(0, this.displayCount);
  }

  /**
   * Phase 1 – there are more already-fetched courses to reveal.
   * Button text: "Show X more"
   */
  get hasHiddenCourses(): boolean {
    return this.displayCount < this.allCourses.length;
  }

  /**
   * Phase 2 – all fetched courses are shown but more pages exist.
   * Button text: "Load more courses"
   */
  get hasMorePages(): boolean {
    return !this.hasHiddenCourses && this.currentPage > 0 && this.currentPage < this.totalPages;
  }

  get canShowLoadMore(): boolean {
    return !this.isLoading && (this.hasHiddenCourses || this.hasMorePages);
  }

  get hiddenCount(): number {
    return Math.max(0, this.allCourses.length - this.displayCount);
  }

  get hasActiveFilters(): boolean {
    return this.activeFilters.platform !== 'All'
      || this.activeFilters.rating     !== ''
      || this.activeFilters.level      !== 'All'
      || this.activeFilters.duration   !== 'All'
      || this.activeFilters.topic      !== '';
  }

  get currentCareerStack():    string { return this.careerProfileService.careerStack; }
  get currentExperienceLevel(): string { return this.careerProfileService.experienceLevel; }
  get skeletonItems():          number[] { return Array.from({ length: PAGE_SIZE }); }

  constructor(
    private readonly courseService:        CourseService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr:                  ChangeDetectorRef
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    // Debounce filter changes (avoids hammering the API while typing/clicking)
    this.subscriptions.add(
      this.filterChanges.pipe(debounceTime(450)).subscribe(filters => {
        this.activeFilters = { ...filters };
        this.resetAndFetch();
      })
    );

    // Re-fetch when career profile changes (BehaviorSubject fires immediately on subscribe → initial load)
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

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  /** Full reset + reload from page 1. */
  private resetAndFetch(): void {
    this.allCourses    = [];
    this.displayCount  = INITIAL_DISPLAY;
    this.currentPage   = 0;
    this.totalPages    = 1;
    this.totalCourses  = 0;
    this.errorMessage  = '';
    this.fetchPage(1, false);
  }

  /**
   * Load one backend page.
   * @param page   1-based page number
   * @param append true → append to allCourses;  false → replace
   */
  private fetchPage(page: number, append: boolean): void {
    if (append) {
      this.isLoadingMore = true;
    } else {
      this.isLoading = true;
    }
    this.cdr.markForCheck();

    this.courseService.getCourses(this.activeFilters, page, PAGE_SIZE).subscribe({
      next: (res) => {
        const incoming = res.courses || [];

        if (append) {
          this.allCourses   = [...this.allCourses, ...incoming];
          this.displayCount = this.allCourses.length; // show all after loading more
        } else {
          this.allCourses   = incoming;
          this.displayCount = INITIAL_DISPLAY;        // start fresh at 6
        }

        this.currentPage   = res.page       ?? page;
        this.totalPages    = res.totalPages ?? 1;
        this.totalCourses  = res.total      ?? this.allCourses.length;

        this.isLoading     = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.errorMessage  = err?.error?.message || 'Failed to load courses. Please try again.';
        this.isLoading     = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── User actions ───────────────────────────────────────────────────────────

  onFiltersChange(filters: CourseFilters): void {
    this.filterChanges.next(filters);
  }

  onFiltersReset(): void {
    this.activeFilters = { ...DEFAULT_FILTERS };
    this.resetAndFetch();
  }

  /**
   * Two-phase Load More:
   *   Phase 1 – reveal courses already fetched but hidden (displayCount → allCourses.length)
   *   Phase 2 – fetch the next backend page and reveal it
   */
  loadMore(): void {
    if (this.isLoadingMore) return;

    // Phase 1: reveal hidden courses from current page
    if (this.hasHiddenCourses) {
      this.displayCount = this.allCourses.length;
      this.cdr.markForCheck();
      return;
    }

    // Phase 2: go get the next page
    if (this.hasMorePages) {
      this.fetchPage(this.currentPage + 1, true);
    }
  }

  toggleMobileFilters(): void {
    this.isMobileFiltersOpen = !this.isMobileFiltersOpen;
    this.cdr.markForCheck();
  }

  retryLoad(): void {
    this.errorMessage = '';
    this.resetAndFetch();
  }

  trackById(_: number, course: Course): string {
    return course.id;
  }
}
