import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_NEWS_FILTERS,
  NEWS_CATEGORIES,
  NEWS_SOURCES,
  NEWS_TABS,
  NewsCategory,
  NewsDateFilter,
  NewsFilters,
  NewsPopularityFilter,
  NewsSource,
  NewsTab
} from '../../models/news.model';

@Component({
  selector: 'app-news-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './news-filters.html',
  styleUrl: './news-filters.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewsFiltersComponent {
  @Input() filters: NewsFilters = { ...DEFAULT_NEWS_FILTERS };
  @Output() filtersChange = new EventEmitter<NewsFilters>();

  readonly tabs = NEWS_TABS;
  readonly categories = NEWS_CATEGORIES;
  readonly sources = NEWS_SOURCES;

  setTab(tab: NewsTab): void {
    this.emit({ tab });
  }

  setCategory(category: NewsCategory): void {
    this.emit({ category });
  }

  setSource(source: NewsSource): void {
    this.emit({ source });
  }

  setDate(date: NewsDateFilter): void {
    this.emit({ date });
  }

  setPopularity(popularity: NewsPopularityFilter): void {
    this.emit({ popularity });
  }

  setSearch(search: string): void {
    this.emit({ search });
  }

  private emit(partial: Partial<NewsFilters>): void {
    this.filtersChange.emit({ ...this.filters, ...partial });
  }
}
