import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ElementRef,
  ViewChild,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { CourseService } from '../../shared/services/course.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  ActiveCourseFilterChip,
  Course,
  CourseFilters,
  CoursePersonalization,
  DEFAULT_FILTERS,
  RecommendedBasedOn,
  normalizeCourseFilters,
} from '../../shared/models/course.model';
import { CourseCardComponent } from '../../shared/components/course-card/course-card';
import { CourseFiltersComponent } from '../../shared/components/course-filters/course-filters';

import { CourseLearningStore, learningError } from './services/course-learning.store';
import { MyLearningComponent } from './components/my-learning.component';

const INITIAL_DISPLAY = 10;
const PAGE_SIZE = 10;

@Component({
  selector: 'app-courses',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CourseCardComponent,
    CourseFiltersComponent,
    MyLearningComponent,
  ],
  providers: [CourseLearningStore],
  templateUrl: './courses.component.html',
  styleUrl: './courses.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoursesComponent implements OnInit, OnDestroy {
  @ViewChild('filterDialog') filterDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('filterTrigger') filterTrigger!: ElementRef<HTMLButtonElement>;
  view: 'discover' | 'learning' = 'discover';
  loadedAt: Date | null = null;
  personalization: CoursePersonalization | null = null;
  private scrollContainer: HTMLElement | null = null;
  private previousOverflow = '';
  private previousBodyOverflow = '';
  private loadMoreFailed = false;
  private forceRefresh = false;
  allCourses: Course[] = [];
  displayCount = INITIAL_DISPLAY;

  isLoading = false;
  isLoadingMore = false;
  isRefreshing = false;
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
  private previousQueryTopic = '';
  private requestToken = 0;
  private lastProfileSignature = '';
  private profileReady = false;
  private refreshLockUntil = 0;

  constructor(
    private readonly courseService: CourseService,
    private readonly careerProfileService: CareerProfileService,
    private readonly route: ActivatedRoute,
    readonly learning: CourseLearningStore,
    private readonly cdr: ChangeDetectorRef,
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
    return !this.isLoading && !this.isRefreshing && (this.hasHiddenCourses || this.hasMorePages);
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
    return this.recommendedBasedOn?.summary || '';
  }

  get sourceNotice(): string {
    return this.recommendedBasedOn?.sourceMessage || '';
  }

  get isFallbackSource(): boolean {
    return Boolean(this.recommendedBasedOn?.fallbackUsed);
  }

  ngOnInit(): void {
    this.learning.load();
    this.applyTopicFromQuery(
      this.route.snapshot.queryParamMap.get('skill') ||
        this.route.snapshot.queryParamMap.get('topic'),
    );

    this.subscriptions.add(
      this.route.queryParamMap
        .pipe(
          map((params) => String(params.get('skill') || params.get('topic') || '').trim()),
          distinctUntilChanged(),
        )
        .subscribe((topic) => {
          if (!topic && !this.previousQueryTopic) return;
          this.previousQueryTopic = topic;
          const nextFilters = normalizeCourseFilters({ ...this.activeFilters, topic });
          if (JSON.stringify(nextFilters) === JSON.stringify(this.activeFilters)) return;
          this.activeFilters = nextFilters;
          if (this.profileReady) {
            this.resetAndFetch();
          }
          this.cdr.markForCheck();
        }),
    );

    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          distinctUntilChanged(
            (previous, current) =>
              previous.careerStack === current.careerStack &&
              previous.experienceLevel === current.experienceLevel,
          ),
        )
        .subscribe((profile) => {
          const nextSignature = `${profile.careerStack}|${profile.experienceLevel}`.toLowerCase();
          if (this.lastProfileSignature && this.lastProfileSignature !== nextSignature) {
            this.courseService.clearCache();
          }
          this.lastProfileSignature = nextSignature;
          this.profileReady = true;
          this.resetAndFetch();
        }),
    );
  }

  ngOnDestroy(): void {
    this.closeMobileFilters(false);
    this.subscriptions.unsubscribe();
  }

  onFiltersChange(filters: CourseFilters): void {
    this.closeMobileFilters();
    const normalized = normalizeCourseFilters(filters);
    if (JSON.stringify(normalized) === JSON.stringify(this.activeFilters)) return;
    this.activeFilters = normalized;
    this.resetAndFetch();
  }

  onFiltersReset(): void {
    this.activeFilters = { ...DEFAULT_FILTERS };
    this.closeMobileFilters();
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
    if (this.isLoadingMore || this.isRefreshing) {
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

  get hasCareerContext(): boolean {
    return this.careerProfileService.isConfigured;
  }

  openMobileFilters(): void {
    this.isMobileFiltersOpen = true;
    this.cdr.detectChanges();
    this.filterDialog.nativeElement.showModal();
    this.scrollContainer = document.querySelector<HTMLElement>('.main-content');
    this.previousOverflow = this.scrollContainer?.style.overflow || '';
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (this.scrollContainer) this.scrollContainer.style.overflow = 'hidden';
  }
  closeMobileFilters(restoreFocus = true): void {
    if (!this.isMobileFiltersOpen) return;
    this.filterDialog?.nativeElement.close();
    this.isMobileFiltersOpen = false;
    if (this.scrollContainer) this.scrollContainer.style.overflow = this.previousOverflow;
    this.scrollContainer = null;
    document.body.style.overflow = this.previousBodyOverflow;
    if (restoreFocus) this.filterTrigger?.nativeElement.focus();
    this.cdr.markForCheck();
  }
  trapFilterFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.filterDialog.nativeElement;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
  cancelFilters(event: Event): void {
    event.preventDefault();
    this.closeMobileFilters();
  }
  backdropFilters(event: MouseEvent): void {
    if (event.target === this.filterDialog.nativeElement) this.closeMobileFilters();
  }
  @HostListener('window:resize') onResize(): void {
    if (window.innerWidth > 768) this.closeMobileFilters(false);
  }

  retryLoad(): void {
    this.errorMessage = '';
    this.courseService.clearCache();
    if (this.loadMoreFailed) {
      this.fetchPage(this.currentPage + 1, true);
      return;
    }
    this.resetAndFetch({ preserveOnFailure: this.allCourses.length > 0 });
  }

  refreshCourses(): void {
    const now = Date.now();
    if (this.isLoading || this.isLoadingMore || this.isRefreshing || now < this.refreshLockUntil) {
      return;
    }
    this.refreshLockUntil = now + 800;
    this.forceRefresh = true;
    this.courseService.clearCache();
    this.resetAndFetch({ preserveOnFailure: this.allCourses.length > 0 });
  }

  trackById(_: number, course: Course): string {
    return course.id;
  }

  private applyTopicFromQuery(raw: string | null): void {
    const topic = String(raw || '').trim();
    if (!topic) return;
    this.activeFilters = normalizeCourseFilters({ ...this.activeFilters, topic });
  }

  private resetAndFetch(options: { preserveOnFailure?: boolean } = {}): void {
    const preserveOnFailure = Boolean(options.preserveOnFailure) && this.allCourses.length > 0;
    const previousResult = preserveOnFailure
      ? {
          courses: this.allCourses,
          displayCount: this.displayCount,
          page: this.currentPage,
          totalPages: this.totalPages,
          totalCourses: this.totalCourses,
          recommendedBasedOn: this.recommendedBasedOn,
        }
      : null;

    this.requestToken += 1;
    if (!preserveOnFailure) {
      this.allCourses = [];
      this.displayCount = INITIAL_DISPLAY;
      this.currentPage = 0;
      this.totalPages = 1;
      this.totalCourses = 0;
      this.recommendedBasedOn = null;
      this.personalization = null;
      this.loadedAt = null;
    }
    this.errorMessage = '';
    this.fetchPage(1, false, { preserveOnFailure, previousResult });
  }

  private fetchPage(
    page: number,
    append: boolean,
    options: {
      preserveOnFailure?: boolean;
      previousResult?: {
        courses: Course[];
        displayCount: number;
        page: number;
        totalPages: number;
        totalCourses: number;
        recommendedBasedOn: RecommendedBasedOn | null;
      } | null;
    } = {},
  ): void {
    const currentRequest = ++this.requestToken;
    const preservePrevious = Boolean(options.preserveOnFailure) && Boolean(options.previousResult);

    if (append) {
      this.isLoadingMore = true;
      this.isRefreshing = false;
    } else if (preservePrevious) {
      this.isRefreshing = true;
      this.isLoading = false;
      this.isLoadingMore = false;
    } else {
      this.isLoading = true;
      this.isLoadingMore = false;
      this.isRefreshing = false;
    }

    this.cdr.markForCheck();

    const refresh = this.forceRefresh;
    this.forceRefresh = false;
    this.subscriptions.add(
      this.courseService.getCourses(this.activeFilters, page, PAGE_SIZE, { refresh }).subscribe({
        next: (response) => {
          if (currentRequest !== this.requestToken) {
            return;
          }

          const incoming = Array.isArray(response.courses) ? response.courses : [];
          this.allCourses = append ? this.mergeCourses(this.allCourses, incoming) : incoming;

          this.displayCount = append
            ? this.allCourses.length
            : Math.min(INITIAL_DISPLAY, this.allCourses.length);

          this.loadedAt = new Date();
          this.personalization =
            response.personalization || response.recommendedBasedOn?.personalization || null;
          this.loadMoreFailed = false;
          this.currentPage = response.page ?? page;
          this.totalPages = response.totalPages ?? 1;
          this.totalCourses = response.total ?? this.allCourses.length;
          this.recommendedBasedOn = response.recommendedBasedOn
            ? {
                ...response.recommendedBasedOn,
                fromCache: Boolean(response.fromCache || response.fromFrontendCache),
              }
            : null;
          this.errorMessage = '';
          this.isLoading = false;
          this.isLoadingMore = false;
          this.isRefreshing = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (currentRequest !== this.requestToken) {
            return;
          }

          this.errorMessage = learningError(error);
          this.loadMoreFailed = append;
          this.isLoading = false;
          this.isLoadingMore = false;
          this.isRefreshing = false;

          if (preservePrevious && options.previousResult) {
            this.allCourses = options.previousResult.courses;
            this.displayCount = options.previousResult.displayCount;
            this.currentPage = options.previousResult.page;
            this.totalPages = options.previousResult.totalPages;
            this.totalCourses = options.previousResult.totalCourses;
            this.recommendedBasedOn = options.previousResult.recommendedBasedOn;
          }

          this.cdr.markForCheck();
        },
      }),
    );
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
