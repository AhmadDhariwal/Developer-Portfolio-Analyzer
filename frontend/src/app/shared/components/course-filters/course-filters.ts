import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CourseFilters,
  DEFAULT_FILTERS,
  PLATFORM_OPTIONS,
  RATING_OPTIONS,
  LEVEL_OPTIONS,
  DURATION_OPTIONS,
  TOPIC_OPTIONS
} from '../../models/course.model';

@Component({
  selector: 'app-course-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './course-filters.html',
  styleUrl: './course-filters.scss'
})
export class CourseFiltersComponent implements OnInit {
  @Input()  initialFilters: Partial<CourseFilters> = {};
  @Output() filtersChange = new EventEmitter<CourseFilters>();
  @Output() filtersReset  = new EventEmitter<void>();

  filters: CourseFilters = { ...DEFAULT_FILTERS };

  readonly platformOptions = PLATFORM_OPTIONS;
  readonly ratingOptions   = RATING_OPTIONS;
  readonly levelOptions    = LEVEL_OPTIONS;
  readonly durationOptions = DURATION_OPTIONS;
  readonly topicOptions    = TOPIC_OPTIONS;

  isCollapsed = false;

  ngOnInit(): void {
    this.filters = { ...DEFAULT_FILTERS, ...this.initialFilters };
  }

  onFilterChange(): void {
    this.filtersChange.emit({ ...this.filters });
  }

  resetFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.filtersReset.emit();
    this.filtersChange.emit({ ...this.filters });
  }

  get hasActiveFilters(): boolean {
    return this.filters.platform !== 'All'
      || this.filters.rating    !== ''
      || this.filters.level     !== 'All'
      || this.filters.duration  !== 'All'
      || this.filters.topic     !== '';
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  selectTopic(topic: string): void {
    this.filters.topic = this.filters.topic === topic ? '' : topic;
    this.onFilterChange();
  }
}
