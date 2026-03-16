import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  JobFilters, DEFAULT_JOB_FILTERS,
  JOB_PLATFORM_OPTIONS, JOB_EXPERIENCE_OPTIONS,
  JOB_TYPE_OPTIONS, JOB_LOCATION_OPTIONS, JOB_SKILL_OPTIONS
} from '../../models/job.model';

@Component({
  selector:        'app-job-filters',
  standalone:      true,
  imports:         [CommonModule, FormsModule],
  templateUrl:     './job-filters.html',
  styleUrl:        './job-filters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobFiltersComponent implements OnInit {
  @Input()  initialFilters: Partial<JobFilters> = {};
  @Output() filtersChange  = new EventEmitter<JobFilters>();
  @Output() filtersReset   = new EventEmitter<void>();

  filters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  isCollapsed = false;

  readonly platformOptions    = JOB_PLATFORM_OPTIONS;
  readonly experienceOptions  = JOB_EXPERIENCE_OPTIONS;
  readonly jobTypeOptions     = JOB_TYPE_OPTIONS;
  readonly locationOptions    = JOB_LOCATION_OPTIONS;
  readonly skillOptions       = JOB_SKILL_OPTIONS;

  ngOnInit(): void {
    if (this.initialFilters) {
      this.filters = { ...DEFAULT_JOB_FILTERS, ...this.initialFilters };
    }
  }

  get hasActiveFilters(): boolean {
    return this.filters.platform !== 'All'
      || this.filters.experienceLevel !== 'All'
      || this.filters.jobType !== 'All'
      || this.filters.location !== 'All'
      || !!this.filters.skills;
  }

  get activeCount(): number {
    let count = 0;
    if (this.filters.platform       !== 'All') count++;
    if (this.filters.experienceLevel !== 'All') count++;
    if (this.filters.jobType        !== 'All') count++;
    if (this.filters.location       !== 'All') count++;
    if (this.filters.skills)                   count++;
    return count;
  }

  onFilterChange(): void {
    this.filtersChange.emit({ ...this.filters });
  }

  selectSkill(skill: string): void {
    this.filters = {
      ...this.filters,
      skills: this.filters.skills === skill ? '' : skill
    };
    this.onFilterChange();
  }

  resetFilters(): void {
    this.filters = { ...DEFAULT_JOB_FILTERS };
    this.filtersReset.emit();
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }
}
