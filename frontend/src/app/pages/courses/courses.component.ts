import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { CourseService } from '../../shared/services/course.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  ActiveCourseFilterChip,
  Course,
  CourseFilters,
  DEFAULT_FILTERS,
  RecommendedBasedOn,
  normalizeCourseFilters
} from '../../shared/models/course.model';
import { CourseCardComponent } from '../../shared/components/course-card/course-card';
import { CourseFiltersComponent } from '../../shared/components/course-filters/course-filters';

const INITIAL_DISPLAY = 10;
const PAGE_SIZE = 10;

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [CommonModule, FormsModule, CourseCardComponent, CourseFiltersComponent],
  templateUrl: './courses.component.html',
  styleUrl: './courses.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CoursesComponent implements OnInit, OnDestroy {
  allCourses: Course[] = [];
  displayCount = INITIAL_DISPLAY;

  isLoading = false;
  isLoadingMore = false;
  errorMessage = '';

  currentPage = 0;
  totalPages = 1;
  totalCourses = 0;

  activeFilters: CourseFilters = { ...DEFAULT_FILTERS };
  recommendedBasedOn: RecommendedBasedOn | null = null;
  isMobileFiltersOpen = false;

  readonly INITIAL_DISPLAY = INITIAL_DISPLAY;
  readonly PAGE_SIZE = PAGE_SIZE;

  private readonly subscriptions = new Subscription();
  private readonly filterChanges = new Subject<CourseFilters>();
  private requestToken = 0;
  private lastProfileSignature = '';

  constructor(
    private readonly courseService: CourseService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  get displayedCourses(): Course[] {
    return this.allCourses.slice(0, this.displayCount);
  }

  get hasHiddenCourses(): boolean {
    return this.displayCount < this.allCourses.length;
  }

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
    return this.activeFilterChips.length > 0;
  }

  get currentCareerStack(): string {
    return this.careerProfileService.careerStack;
  }

  get currentExperienceLevel(): string {
    return this.careerProfileService.experienceLevel;
  }

  get skeletonItems(): number[] {
    return Array.from({ length: PAGE_SIZE }, (_, index) => index);
  }

  get activeFilterChips(): ActiveCourseFilterChip[] {
    const filters = this.activeFilters;
    const chips: ActiveCourseFilterChip[] = [];

    if (filters.platform !== 'All') {
      chips.push({ key: 'platform', label: 'Platform', value: filters.platform });
    }
    if (filters.rating) {
      chips.push({ key: 'rating', label: 'Rating', value: `${filters.rating}+` });
    }
    if (filters.level !== 'All') {
      chips.push({ key: 'level', label: 'Level', value: filters.level });
    }
    if (filters.duration !== 'All') {
      chips.push({ key: 'duration', label: 'Duration', value: filters.duration });
    }
    if (filters.topic) {
      chips.push({ key: 'topic', label: 'Topic', value: filters.topic });
    }

    return chips;
  }

  get recommendationSummary(): string {
    return this.recommendedBasedOn?.summary
      || `Courses are recommended using your ${this.currentCareerStack} profile and ${this.currentExperienceLevel} experience level.`;
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.filterChanges.pipe(
        distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current))
      ).subscribe((filters) => {
        this.activeFilters = normalizeCourseFilters(filters);
        this.isMobileFiltersOpen = false;
        this.resetAndFetch();
      })
    );

    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          distinctUntilChanged(
            (previous, current) =>
              previous.careerStack === current.careerStack
              && previous.experienceLevel === current.experienceLevel
          )
        )
        .subscribe((profile) => {
          const nextSignature = `${profile.careerStack}|${profile.experienceLevel}`.toLowerCase();
          if (this.lastProfileSignature && this.lastProfileSignature !== nextSignature) {
            this.courseService.clearCache();
          }
          this.lastProfileSignature = nextSignature;
          this.resetAndFetch();
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  onFiltersChange(filters: CourseFilters): void {
    this.activeFilters = normalizeCourseFilters(filters);
    this.filterChanges.next(this.activeFilters);
  }

  onFiltersReset(): void {
    this.activeFilters = { ...DEFAULT_FILTERS };
    this.courseService.clearCache();
    this.resetAndFetch();
  }

  clearFilter(key: keyof CourseFilters): void {
    const nextFilters: CourseFilters = { ...this.activeFilters };
    if (key === 'platform') {
      nextFilters.platform = DEFAULT_FILTERS.platform;
    } else if (key === 'rating') {
      nextFilters.rating = DEFAULT_FILTERS.rating;
    } else if (key === 'level') {
      nextFilters.level = DEFAULT_FILTERS.level;
    } else if (key === 'duration') {
      nextFilters.duration = DEFAULT_FILTERS.duration;
    } else if (key === 'topic') {
      nextFilters.topic = DEFAULT_FILTERS.topic;
    }

    this.activeFilters = normalizeCourseFilters(nextFilters);
    this.resetAndFetch();
  }

  loadMore(): void {
    if (this.isLoadingMore) {
      return;
    }

    if (this.hasHiddenCourses) {
      this.displayCount = this.allCourses.length;
      this.cdr.markForCheck();
      return;
    }

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
    this.courseService.clearCache();
    this.resetAndFetch();
  }

  refreshCourses(): void {
    this.courseService.clearCache();
    this.resetAndFetch();
  }

  trackById(_: number, course: Course): string {
    return course.id;
  }

  private resetAndFetch(): void {
    this.requestToken += 1;
    this.allCourses = [];
    this.displayCount = INITIAL_DISPLAY;
    this.currentPage = 0;
    this.totalPages = 1;
    this.totalCourses = 0;
    this.errorMessage = '';
    this.recommendedBasedOn = null;
    this.fetchPage(1, false);
  }

  private fetchPage(page: number, append: boolean): void {
    const currentRequest = ++this.requestToken;

    if (append) {
      this.isLoadingMore = true;
    } else {
      this.isLoading = true;
      this.isLoadingMore = false;
    }

    this.cdr.markForCheck();

    this.courseService.getCourses(this.activeFilters, page, PAGE_SIZE).subscribe({
      next: (response) => {
        if (currentRequest !== this.requestToken) {
          return;
        }

        const incoming = Array.isArray(response.courses) ? response.courses : [];
        this.allCourses = append
          ? this.mergeCourses(this.allCourses, incoming)
          : incoming;

        this.displayCount = append
          ? this.allCourses.length
          : Math.min(INITIAL_DISPLAY, this.allCourses.length);

        this.currentPage = response.page ?? page;
        this.totalPages = response.totalPages ?? 1;
        this.totalCourses = response.total ?? this.allCourses.length;
        this.recommendedBasedOn = response.recommendedBasedOn ?? null;
        this.errorMessage = '';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (currentRequest !== this.requestToken) {
          return;
        }

        this.errorMessage = error?.error?.message || 'Failed to load courses. Please try again.';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      }
    });
  }

  private mergeCourses(existing: Course[], incoming: Course[]): Course[] {
    const seen = new Set(existing.map((course) => `${course.id}|${course.url}`.toLowerCase()));
    const merged = [...existing];

    for (const course of incoming) {
      const key = `${course.id}|${course.url}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(course);
    }

    return merged;
  }
}
