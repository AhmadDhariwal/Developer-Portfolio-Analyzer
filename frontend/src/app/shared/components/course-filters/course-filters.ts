import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CourseFilters,
  DEFAULT_FILTERS,
  DURATION_OPTIONS,
  LEVEL_OPTIONS,
  PLATFORM_OPTIONS,
  RATING_OPTIONS,
  normalizeCourseFilters
} from '../../models/course.model';

@Component({
  selector: 'app-course-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './course-filters.html',
  styleUrl: './course-filters.scss'
})
export class CourseFiltersComponent implements OnInit, OnChanges {
  @Input() initialFilters: Partial<CourseFilters> = {};
  @Input() isApplying = false;
  @Output() filtersChange = new EventEmitter<CourseFilters>();
  @Output() filtersReset = new EventEmitter<void>();

  filters: CourseFilters = { ...DEFAULT_FILTERS };
  appliedFilters: CourseFilters = { ...DEFAULT_FILTERS };

  readonly platformOptions = PLATFORM_OPTIONS;
  readonly ratingOptions = RATING_OPTIONS;
  readonly levelOptions = LEVEL_OPTIONS;
  readonly durationOptions = DURATION_OPTIONS;

  isCollapsed = false;

  ngOnInit(): void {
    this.syncFilters();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialFilters']) {
      this.syncFilters();
    }
  }

  get hasActiveFilters(): boolean {
    return this.hasNonDefaultFilters(this.appliedFilters);
  }

  get hasPendingChanges(): boolean {
    return JSON.stringify(this.filters) !== JSON.stringify(this.appliedFilters);
  }

  get hasDraftFilters(): boolean {
    return this.hasNonDefaultFilters(this.filters);
  }

  private hasNonDefaultFilters(filters: CourseFilters): boolean {
    return filters.platform !== 'All'
      || filters.rating !== ''
      || filters.level !== 'All'
      || filters.duration !== 'All'
      || filters.topic !== '';
  }

  onFilterChange(): void {
    this.filters = normalizeCourseFilters(this.filters);
  }

  applyFilters(): void {
    this.filters = normalizeCourseFilters(this.filters);
    this.appliedFilters = { ...this.filters };
    this.filtersChange.emit({ ...this.filters });
  }

  resetFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.appliedFilters = { ...DEFAULT_FILTERS };
    this.filtersReset.emit();
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }


  clearTopic(): void {
    if (!this.filters.topic) return;
    this.filters.topic = '';
    this.onFilterChange();
  }

  private syncFilters(): void {
    this.filters = normalizeCourseFilters(this.initialFilters);
    this.appliedFilters = { ...this.filters };
  }
}
