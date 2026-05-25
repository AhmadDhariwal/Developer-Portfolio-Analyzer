import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_NEWS_FILTERS,
  NEWS_CATEGORIES,
  NEWS_SOURCES,
  NewsCategory,
  NewsDateFilter,
  NewsFilters,
  NewsPopularityFilter,
  NewsSource,
  normalizeNewsFilters
} from '../../models/news.model';

@Component({
  selector: 'app-news-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './news-filters.html',
  styleUrl: './news-filters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewsFiltersComponent implements OnChanges {
  @Input() filters: NewsFilters = { ...DEFAULT_NEWS_FILTERS };
  @Input() isApplying = false;
  @Output() filtersChange = new EventEmitter<NewsFilters>();

  readonly categories = NEWS_CATEGORIES;
  readonly sources = NEWS_SOURCES;
  draftFilters: NewsFilters = { ...DEFAULT_NEWS_FILTERS };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filters']) {
      this.draftFilters = normalizeNewsFilters(this.filters);
    }
  }

  get hasActiveFilters(): boolean {
    return JSON.stringify(this.draftFilters) !== JSON.stringify(DEFAULT_NEWS_FILTERS);
  }

  get hasPendingChanges(): boolean {
    return JSON.stringify(this.draftFilters) !== JSON.stringify(normalizeNewsFilters(this.filters));
  }

  setCategory(category: NewsCategory): void {
    this.update({ category });
  }

  setSource(source: NewsSource): void {
    this.update({ source });
  }

  setDate(date: NewsDateFilter): void {
    this.update({ date });
  }

  setPopularity(popularity: NewsPopularityFilter): void {
    this.update({ popularity });
  }

  setSearch(search: string): void {
    this.update({ search });
  }

  resetFilters(): void {
    this.draftFilters = { ...DEFAULT_NEWS_FILTERS };
    this.filtersChange.emit({ ...this.draftFilters });
  }

  applyFilters(): void {
    if (!this.hasPendingChanges || this.isApplying) return;
    this.filtersChange.emit({ ...this.draftFilters });
  }

  private update(partial: Partial<NewsFilters>): void {
    this.draftFilters = normalizeNewsFilters({ ...this.draftFilters, ...partial });
  }
}
