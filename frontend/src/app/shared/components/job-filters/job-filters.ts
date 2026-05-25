import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_JOB_FILTERS,
  JOB_EXPERIENCE_OPTIONS,
  JOB_LOCATION_OPTIONS,
  JOB_PLATFORM_OPTIONS,
  JOB_SKILL_OPTIONS,
  JOB_TYPE_OPTIONS,
  JobFilters,
  normalizeJobFilters
} from '../../models/job.model';

@Component({
  selector: 'app-job-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './job-filters.html',
  styleUrl: './job-filters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobFiltersComponent implements OnInit, OnChanges {
  @Input() initialFilters: Partial<JobFilters> = {};
  @Input() activeFilters: Partial<JobFilters> = {};
  @Input() isApplying = false;
  @Output() filtersChange = new EventEmitter<JobFilters>();
  @Output() filtersReset = new EventEmitter<void>();

  filters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  appliedFilters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  isCollapsed = false;

  readonly platformOptions = JOB_PLATFORM_OPTIONS;
  readonly experienceOptions = JOB_EXPERIENCE_OPTIONS;
  readonly jobTypeOptions = JOB_TYPE_OPTIONS;
  readonly locationOptions = JOB_LOCATION_OPTIONS;
  readonly skillOptions = JOB_SKILL_OPTIONS;

  ngOnInit(): void {
    this.syncFilters();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialFilters'] || changes['activeFilters']) {
      this.syncFilters();
    }
  }

  get hasActiveFilters(): boolean {
    return this.hasNonDefaultFilters(this.appliedFilters);
  }

  get hasDraftFilters(): boolean {
    return this.hasNonDefaultFilters(this.filters);
  }

  get hasPendingChanges(): boolean {
    return JSON.stringify(this.filters) !== JSON.stringify(this.appliedFilters);
  }

  get activeCount(): number {
    return this.countFilters(this.appliedFilters);
  }

  onFilterChange(): void {
    this.filters = normalizeJobFilters(this.filters);
    this.filtersChange.emit({ ...this.filters });
  }

  selectSkill(skill: string): void {
    this.filters = normalizeJobFilters({
      ...this.filters,
      skills: this.filters.skills === skill ? '' : skill
    });
    this.onFilterChange();
  }

  clearSkill(): void {
    this.filters.skills = '';
    this.onFilterChange();
  }

  resetFilters(): void {
    this.filters = { ...DEFAULT_JOB_FILTERS };
    this.appliedFilters = { ...DEFAULT_JOB_FILTERS };
    this.filtersReset.emit();
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  private countFilters(filters: JobFilters): number {
    let count = 0;
    if (filters.platform !== 'All') count += 1;
    if (filters.experienceLevel !== 'All') count += 1;
    if (filters.jobType !== 'All') count += 1;
    if (filters.location !== 'All') count += 1;
    if (filters.skills) count += 1;
    return count;
  }

  private hasNonDefaultFilters(filters: JobFilters): boolean {
    return this.countFilters(filters) > 0;
  }

  private syncFilters(): void {
    this.filters = normalizeJobFilters(this.initialFilters);
    this.appliedFilters = normalizeJobFilters(this.activeFilters);
  }
}
