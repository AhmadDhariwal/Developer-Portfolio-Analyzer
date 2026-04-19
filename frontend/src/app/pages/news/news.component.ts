import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { NewsService } from '../../shared/services/news.service';
import { NewsCardComponent } from '../../shared/components/news-card/news-card';
import { NewsFiltersComponent } from '../../shared/components/news-filters/news-filters';
import { DEFAULT_NEWS_FILTERS, NewsFilters, NewsItem } from '../../shared/models/news.model';

const PAGE_SIZE = 12;
const BOOKMARK_KEY = 'devinsight_news_bookmarks';
const READ_LATER_KEY = 'devinsight_news_read_later';

@Component({
  selector: 'app-news',
  standalone: true,
  imports: [CommonModule, NewsCardComponent, NewsFiltersComponent],
  templateUrl: './news.component.html',
  styleUrl: './news.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewsComponent implements OnInit, OnDestroy {
  filters: NewsFilters = { ...DEFAULT_NEWS_FILTERS };
  items: NewsItem[] = [];
  trendingTopics: string[] = [];
  sourceSummary: Record<string, number> = {};
  bookmarks = new Set<string>();
  readLater = new Set<string>();
  page = 1;
  totalPages = 1;
  isLoading = false;
  isLoadingMore = false;
  errorMessage = '';

  private readonly subscriptions = new Subscription();
  private readonly filtersChanges = new Subject<NewsFilters>();

  constructor(
    private readonly newsService: NewsService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.restoreClientState();

    this.subscriptions.add(
      this.filtersChanges.pipe(debounceTime(300)).subscribe((nextFilters) => {
        this.filters = { ...nextFilters };
        this.page = 1;
        this.fetch(false);
      })
    );

    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(distinctUntilChanged((a, b) => a.careerStack === b.careerStack && a.experienceLevel === b.experienceLevel))
        .subscribe(() => {
          this.page = 1;
          this.fetch(false);
        })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  onFiltersChange(nextFilters: NewsFilters): void {
    this.filtersChanges.next(nextFilters);
  }

  loadMore(): void {
    if (this.isLoadingMore || this.page >= this.totalPages) return;
    this.page += 1;
    this.fetch(true);
  }

  onBookmarkToggle(url: string): void {
    if (this.bookmarks.has(url)) {
      this.bookmarks.delete(url);
    } else {
      this.bookmarks.add(url);
    }
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...this.bookmarks]));
    this.cdr.markForCheck();
  }

  onReadLaterToggle(url: string): void {
    if (this.readLater.has(url)) {
      this.readLater.delete(url);
    } else {
      this.readLater.add(url);
    }
    localStorage.setItem(READ_LATER_KEY, JSON.stringify([...this.readLater]));
    this.cdr.markForCheck();
  }

  trackByUrl(_: number, item: NewsItem): string {
    return item.url;
  }

  private fetch(append: boolean): void {
    if (append) this.isLoadingMore = true;
    else {
      this.isLoading = true;
      this.errorMessage = '';
    }
    this.cdr.markForCheck();

    this.subscriptions.add(
      this.newsService.getNews(this.filters, this.page, PAGE_SIZE).subscribe({
        next: (response) => {
          this.items = append ? [...this.items, ...response.items] : response.items;
          this.totalPages = response.totalPages;
          this.trendingTopics = response.trendingTopics || [];
          this.sourceSummary = response.sourceSummary || {};
          this.isLoading = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to load tech news right now.';
          this.isLoading = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
        }
      })
    );
  }

  private restoreClientState(): void {
    try {
      this.bookmarks = new Set<string>(JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]'));
      this.readLater = new Set<string>(JSON.parse(localStorage.getItem(READ_LATER_KEY) || '[]'));
    } catch {
      this.bookmarks = new Set();
      this.readLater = new Set();
    }
  }
}
