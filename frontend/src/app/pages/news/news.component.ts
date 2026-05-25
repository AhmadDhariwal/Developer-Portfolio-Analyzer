import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { NewsService } from '../../shared/services/news.service';
import { NewsCardComponent } from '../../shared/components/news-card/news-card';
import { NewsFiltersComponent } from '../../shared/components/news-filters/news-filters';
import {
  ActiveNewsFilterChip,
  DEFAULT_NEWS_FILTERS,
  NewsFilters,
  NewsItem,
  NewsSavedType,
  NewsTelemetry,
  PersonalizedNewsContext,
  SavedNewsItem,
  normalizeNewsFilters
} from '../../shared/models/news.model';

const PAGE_SIZE = 12;
const BOOKMARK_KEY = 'devinsight_news_bookmarks';
const READ_LATER_KEY = 'devinsight_news_read_later';
const DEFAULT_TELEMETRY: NewsTelemetry = {
  cacheHit: false,
  providerFailureCount: 0,
  providerUsed: [],
  responseTimeMs: 0
};

type ToastState = { visible: boolean; type: 'success' | 'error'; message: string };

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
  recommendedBasedOn: PersonalizedNewsContext | null = null;
  telemetry: NewsTelemetry = { ...DEFAULT_TELEMETRY };
  bookmarks = new Set<string>();
  readLater = new Set<string>();
  bookmarkPending = new Set<string>();
  readLaterPending = new Set<string>();
  toast: ToastState = { visible: false, type: 'success', message: '' };
  page = 1;
  total = 0;
  totalPages = 1;
  isLoading = false;
  isLoadingMore = false;
  errorMessage = '';
  sourceBannerMessage = '';
  lastUpdatedLabel = '';

  private readonly subscriptions = new Subscription();
  private readonly savedItemsByType: Record<NewsSavedType, Map<string, SavedNewsItem>> = {
    bookmark: new Map<string, SavedNewsItem>(),
    read_later: new Map<string, SavedNewsItem>()
  };
  private activeRequest?: Subscription;
  private requestNonce = 0;
  private pendingSignature = '';
  private lastCompletedSignature = '';
  private profileSignature = '';
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly newsService: NewsService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.restoreClientState();
    this.loadSavedItems();

    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          map((profile) =>
            JSON.stringify({
              careerStack: profile?.careerStack || '',
              experienceLevel: profile?.experienceLevel || ''
            })
          ),
          distinctUntilChanged()
        )
        .subscribe((signature) => {
          if (signature === this.profileSignature) return;
          this.profileSignature = signature;
          this.page = 1;
          this.fetch(false, true);
        })
    );
  }

  ngOnDestroy(): void {
    this.activeRequest?.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.subscriptions.unsubscribe();
  }

  get sourceBreakdown(): Array<{ label: string; count: number }> {
    return Object.entries(this.sourceSummary)
      .filter(([, count]) => Number(count) > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([label, count]) => ({ label, count: Number(count) }));
  }

  get activeFilterChips(): ActiveNewsFilterChip[] {
    const chips: ActiveNewsFilterChip[] = [];
    if (this.filters.category !== 'All') chips.push({ key: 'category', label: 'Category', value: this.filters.category });
    if (this.filters.source !== 'All') chips.push({ key: 'source', label: 'Source', value: this.filters.source });
    if (this.filters.date !== DEFAULT_NEWS_FILTERS.date) chips.push({ key: 'date', label: 'Date', value: this.prettyLabel(this.filters.date) });
    if (this.filters.popularity !== 'all') chips.push({ key: 'popularity', label: 'Popularity', value: 'High only' });
    if (this.filters.search) chips.push({ key: 'search', label: 'Search', value: this.filters.search });
    return chips;
  }

  get hasActiveFilters(): boolean {
    return this.activeFilterChips.length > 0;
  }

  get skeletonCards(): number[] {
    return Array.from({ length: 6 }, (_, index) => index);
  }

  get sourceStatusClass(): string {
    if (this.telemetry.providerFailureCount > 0) return 'status-warning';
    if (this.recommendedBasedOn?.fromCache) return 'status-cached';
    return 'status-live';
  }

  onFiltersChange(nextFilters: NewsFilters): void {
    const normalized = normalizeNewsFilters(nextFilters);
    if (this.buildFilterSignature(normalized) === this.buildFilterSignature(this.filters)) return;
    this.applyFilters(normalized);
  }

  clearFilter(key: keyof NewsFilters): void {
    this.onFiltersChange({ ...this.filters, [key]: DEFAULT_NEWS_FILTERS[key] });
  }

  resetFilters(): void {
    if (!this.hasActiveFilters) return;
    this.onFiltersChange({ ...DEFAULT_NEWS_FILTERS });
  }

  loadMore(): void {
    if (this.isLoadingMore || this.page >= this.totalPages) return;
    this.page += 1;
    this.fetch(true);
  }

  retry(): void {
    this.fetch(false, true);
  }

  isBookmarked(articleId: string): boolean {
    return this.bookmarks.has(articleId);
  }

  isReadLater(articleId: string): boolean {
    return this.readLater.has(articleId);
  }

  isBookmarkPending(articleId: string): boolean {
    return this.bookmarkPending.has(articleId);
  }

  isReadLaterPending(articleId: string): boolean {
    return this.readLaterPending.has(articleId);
  }

  onBookmarkToggle(article: NewsItem): void {
    this.toggleSavedState(article, 'bookmark');
  }

  onReadLaterToggle(article: NewsItem): void {
    this.toggleSavedState(article, 'read_later');
  }

  trackById(_: number, item: NewsItem): string {
    return item.id;
  }

  trackByLabel(_: number, item: { label: string }): string {
    return item.label;
  }

  trackByValue(_: number, value: string | number): string | number {
    return value;
  }

  private applyFilters(nextFilters: NewsFilters): void {
    const normalized = normalizeNewsFilters(nextFilters);
    if (this.buildFilterSignature(normalized) === this.buildFilterSignature(this.filters)) return;
    this.filters = normalized;
    this.page = 1;
    this.fetch(false);
  }

  private fetch(append: boolean, force = false): void {
    const normalizedFilters = normalizeNewsFilters(this.filters);
    const requestSignature = JSON.stringify({ filters: normalizedFilters, page: this.page, limit: PAGE_SIZE });

    if (!force && this.pendingSignature === requestSignature) return;
    if (!force && !append && this.lastCompletedSignature === requestSignature && !this.errorMessage) return;

    this.activeRequest?.unsubscribe();
    this.pendingSignature = requestSignature;
    const requestId = ++this.requestNonce;

    if (append) {
      this.isLoadingMore = true;
    } else {
      this.isLoading = true;
      this.errorMessage = '';
    }
    this.cdr.markForCheck();

    this.activeRequest = this.newsService.getNews(normalizedFilters, this.page, PAGE_SIZE).subscribe({
      next: (response) => {
        if (requestId !== this.requestNonce) return;

        const incomingItems = Array.isArray(response.items) ? response.items : [];
        this.items = append ? this.mergeUniqueItems(this.items, incomingItems) : incomingItems;
        this.total = Number(response.total || this.items.length);
        this.totalPages = Math.max(1, Number(response.totalPages || 1));
        this.trendingTopics = Array.isArray(response.trendingTopics) ? response.trendingTopics : [];
        this.sourceSummary = response.sourceSummary || {};
        this.recommendedBasedOn = response.recommendedBasedOn || null;
        this.telemetry = response.telemetry || { ...DEFAULT_TELEMETRY };
        this.sourceBannerMessage = this.buildSourceBanner();
        this.lastUpdatedLabel = this.formatLastUpdated(this.recommendedBasedOn?.lastUpdated);
        this.errorMessage = '';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.pendingSignature = '';
        this.lastCompletedSignature = requestSignature;
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (requestId !== this.requestNonce) return;
        if (append) this.page = Math.max(1, this.page - 1);
        this.errorMessage = error?.error?.message || 'Failed to load tech news right now.';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.pendingSignature = '';
        this.cdr.markForCheck();
      }
    });
  }

  private loadSavedItems(): void {
    this.subscriptions.add(
      this.newsService.getSavedNews().subscribe({
        next: (items) => {
          this.savedItemsByType.bookmark.clear();
          this.savedItemsByType.read_later.clear();
          items.forEach((item) => this.savedItemsByType[item.type].set(item.articleId, item));

          this.bookmarks = new Set(items.filter((item) => item.type === 'bookmark').map((item) => item.articleId));
          this.readLater = new Set(items.filter((item) => item.type === 'read_later').map((item) => item.articleId));
          this.persistClientState(BOOKMARK_KEY, this.bookmarks);
          this.persistClientState(READ_LATER_KEY, this.readLater);
        },
        error: () => {
          this.syncSavedMapFromLocalFallback();
          this.cdr.markForCheck();
        }
      })
    );
  }

  private toggleSavedState(article: NewsItem, type: NewsSavedType): void {
    const articleId = article.id;
    const pendingSet = type === 'bookmark' ? this.bookmarkPending : this.readLaterPending;
    if (!articleId || pendingSet.has(articleId)) return;

    const targetSet = type === 'bookmark' ? this.bookmarks : this.readLater;
    const storageKey = type === 'bookmark' ? BOOKMARK_KEY : READ_LATER_KEY;
    const wasSaved = targetSet.has(articleId);
    const previousState = new Set(targetSet);
    const previousSavedItem = this.findSavedItem(article, type);

    if (wasSaved) targetSet.delete(articleId);
    else targetSet.add(articleId);

    this.persistClientState(storageKey, targetSet);
    pendingSet.add(articleId);
    this.cdr.markForCheck();

    if (wasSaved) {
      if (!previousSavedItem?.id) {
        pendingSet.delete(articleId);
        this.showToast('success', type === 'bookmark' ? 'Bookmark removed.' : 'Removed from Read Later.');
        this.cdr.markForCheck();
        return;
      }

      this.subscriptions.add(
        this.newsService.removeSavedNews(previousSavedItem.id).subscribe({
          next: () => {
            this.savedItemsByType[type].delete(previousSavedItem.articleId);
            pendingSet.delete(articleId);
            this.showToast('success', type === 'bookmark' ? 'Bookmark removed.' : 'Removed from Read Later.');
            this.cdr.markForCheck();
          },
          error: (error) => {
            this.restoreSavedSet(type, previousState);
            pendingSet.delete(articleId);
            this.showToast('error', error?.error?.message || 'Unable to update saved news right now.');
            this.cdr.markForCheck();
          }
        })
      );
      return;
    }

    this.subscriptions.add(
      this.newsService.saveNews(article, type).subscribe({
        next: (savedItem) => {
          this.savedItemsByType[type].set(savedItem.articleId, savedItem);
          pendingSet.delete(articleId);
          this.showToast('success', type === 'bookmark' ? 'Article bookmarked.' : 'Saved to Read Later.');
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.restoreSavedSet(type, previousState);
          pendingSet.delete(articleId);
          this.showToast('error', error?.error?.message || 'Unable to save this article right now.');
          this.cdr.markForCheck();
        }
      })
    );
  }

  private restoreSavedSet(type: NewsSavedType, values: Set<string>): void {
    if (type === 'bookmark') {
      this.bookmarks = new Set(values);
      this.persistClientState(BOOKMARK_KEY, this.bookmarks);
      return;
    }

    this.readLater = new Set(values);
    this.persistClientState(READ_LATER_KEY, this.readLater);
  }

  private findSavedItem(article: NewsItem, type: NewsSavedType): SavedNewsItem | undefined {
    const direct = this.savedItemsByType[type].get(article.id);
    if (direct) return direct;

    for (const item of this.savedItemsByType[type].values()) {
      if (item.url === article.url) return item;
    }

    return undefined;
  }

  private syncSavedMapFromLocalFallback(): void {
    this.savedItemsByType.bookmark.clear();
    this.savedItemsByType.read_later.clear();
    this.bookmarks.forEach((articleId) => {
      this.savedItemsByType.bookmark.set(articleId, this.createFallbackSavedItem(articleId, 'bookmark'));
    });
    this.readLater.forEach((articleId) => {
      this.savedItemsByType.read_later.set(articleId, this.createFallbackSavedItem(articleId, 'read_later'));
    });
  }

  private createFallbackSavedItem(articleId: string, type: NewsSavedType): SavedNewsItem {
    return {
      id: '',
      articleId,
      title: '',
      url: '',
      source: 'Unknown',
      image: '',
      publishedAt: null,
      category: 'Backend',
      type,
      createdAt: null
    };
  }

  private mergeUniqueItems(currentItems: NewsItem[], nextItems: NewsItem[]): NewsItem[] {
    const seen = new Set(currentItems.map((item) => item.id));
    const merged = [...currentItems];

    nextItems.forEach((item) => {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      merged.push(item);
    });

    return merged;
  }

  private buildSourceBanner(): string {
    const providers = Array.isArray(this.telemetry.providerUsed) ? this.telemetry.providerUsed : [];
    if (providers.length && this.telemetry.providerFailureCount > 0) {
      return `Showing live news from ${providers.join(', ')}. Some providers were unavailable, so the feed was safely reduced.`;
    }
    if (providers.length) {
      return `Showing live developer news from ${providers.join(', ')}.`;
    }
    if (this.recommendedBasedOn?.sourceStatus) {
      return this.recommendedBasedOn.sourceStatus;
    }
    return 'Showing the best available developer news with safe defaults.';
  }

  private formatLastUpdated(value?: string): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(parsed);
  }

  private prettyLabel(value: string): string {
    if (value === 'today') return 'Today';
    if (value === 'week') return 'This week';
    if (value === 'month') return 'This month';
    return value;
  }

  private showToast(type: 'success' | 'error', message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = { visible: true, type, message };
    this.toastTimer = setTimeout(() => {
      this.toast = { ...this.toast, visible: false };
      this.cdr.markForCheck();
    }, 2800);
    this.cdr.markForCheck();
  }

  private buildFilterSignature(filters: NewsFilters): string {
    return JSON.stringify(normalizeNewsFilters(filters));
  }

  private restoreClientState(): void {
    this.bookmarks = this.readSet(BOOKMARK_KEY);
    this.readLater = this.readSet(READ_LATER_KEY);
  }

  private readSet(key: string): Set<string> {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(raw)) return new Set<string>();
      return new Set<string>(raw.filter((value) => typeof value === 'string' && value.trim()));
    } catch {
      return new Set<string>();
    }
  }

  private persistClientState(key: string, values: Set<string>): void {
    localStorage.setItem(key, JSON.stringify([...values]));
    this.cdr.markForCheck();
  }
}
