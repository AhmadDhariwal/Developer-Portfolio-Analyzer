import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { FrontendAnalysisCacheService, FrontendAnalysisCacheKey } from '../../shared/services/frontend-analysis-cache.service';
import { NewsService } from '../../shared/services/news.service';
import { NewsCardComponent } from '../../shared/components/news-card/news-card';
import { NewsFiltersComponent } from '../../shared/components/news-filters/news-filters';
import {
  ActiveNewsFilterChip,
  DEFAULT_NEWS_FILTERS,
  NewsFilters,
  NewsHubView,
  NewsItem,
  NewsProviderDiagnostic,
  NewsSavedType,
  NewsTelemetry,
  PersonalizedNewsContext,
  SavedNewsItem,
  normalizeNewsFilters
} from '../../shared/models/news.model';

const PAGE_SIZE = 12;
const FEED_CACHE_TTL_MS = 20 * 60 * 1000;
const SAVED_CACHE_TTL_MS = 5 * 60 * 1000;
const SIGNAL_HASH_KEY = 'devinsight_news_signal_hash';
const BOOKMARK_KEY = 'devinsight_news_bookmarks';
const READ_LATER_KEY = 'devinsight_news_read_later';
const DEFAULT_TELEMETRY: NewsTelemetry = {
  cacheHit: false,
  providerFailureCount: 0,
  providerUsed: [],
  providerDiagnostics: [],
  signalHash: '',
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
  readonly viewTabs: Array<{ value: NewsHubView; label: string }> = [
    { value: 'for-you', label: 'For You' },
    { value: 'trending', label: 'Trending' },
    { value: 'latest', label: 'Latest' },
    { value: 'bookmarks', label: 'Bookmarks' },
    { value: 'read_later', label: 'Read Later' }
  ];

  selectedView: NewsHubView = 'for-you';
  filters: NewsFilters = { ...DEFAULT_NEWS_FILTERS };
  items: NewsItem[] = [];
  savedItemsView: SavedNewsItem[] = [];
  trendingTopics: string[] = [];
  sourceSummary: Record<string, number> = {};
  recommendedBasedOn: PersonalizedNewsContext | null = null;
  telemetry: NewsTelemetry = { ...DEFAULT_TELEMETRY };
  bookmarks = new Set<string>();
  readLater = new Set<string>();
  bookmarkPending = new Set<string>();
  readLaterPending = new Set<string>();
  savedActionPending = new Set<string>();
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
  private readonly savedViewLoaded: Record<NewsSavedType, boolean> = {
    bookmark: false,
    read_later: false
  };
  private activeRequest?: Subscription;
  private requestNonce = 0;
  private pendingSignature = '';
  private lastCompletedSignature = '';
  private profileSignature = '';
  private currentSignalHash = '';
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly newsService: NewsService,
    private readonly careerProfileService: CareerProfileService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.restoreClientState();
    this.loadSavedItems();

    this.subscriptions.add(
      this.careerProfileService.careerProfile$
        .pipe(
          debounceTime(180),
          map((profile) =>
            JSON.stringify({
              careerStack: profile?.careerStack || '',
              experienceLevel: profile?.experienceLevel || '',
              careerGoal: profile?.careerGoal || ''
            })
          ),
          distinctUntilChanged()
        )
        .subscribe((signature) => {
          if (signature === this.profileSignature) return;
          this.profileSignature = signature;
          if (this.isFeedView) {
            this.page = 1;
            this.fetch(false);
          }
        })
    );
  }

  ngOnDestroy(): void {
    this.activeRequest?.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.subscriptions.unsubscribe();
  }

  get isFeedView(): boolean {
    return this.selectedView === 'for-you' || this.selectedView === 'trending' || this.selectedView === 'latest';
  }

  get selectedSavedType(): NewsSavedType | null {
    if (this.selectedView === 'bookmarks') return 'bookmark';
    if (this.selectedView === 'read_later') return 'read_later';
    return null;
  }

  get displayedCount(): number {
    return this.isFeedView ? this.items.length : this.savedItemsView.length;
  }

  get displayedTotalLabel(): string {
    if (this.isFeedView) return `of ${this.total || this.items.length} articles`;
    return this.selectedView === 'bookmarks' ? 'saved articles' : 'queued articles';
  }

  get selectedViewLabel(): string {
    const found = this.viewTabs.find((tab) => tab.value === this.selectedView);
    return found?.label || 'For You';
  }

  get sourceBreakdown(): Array<{ label: string; count: number }> {
    return Object.entries(this.sourceSummary)
      .filter(([, count]) => Number(count) > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([label, count]) => ({ label, count: Number(count) }));
  }

  get sourceDiagnostics(): NewsProviderDiagnostic[] {
    return Array.isArray(this.telemetry.providerDiagnostics) ? this.telemetry.providerDiagnostics : [];
  }

  get activeFilterChips(): ActiveNewsFilterChip[] {
    if (!this.isFeedView) return [];
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

  get emptyTitle(): string {
    if (this.selectedView === 'bookmarks') return 'No bookmarks yet';
    if (this.selectedView === 'read_later') return 'No read later items yet';
    return 'No news matched these filters';
  }

  get emptyMessage(): string {
    if (this.selectedView === 'bookmarks') return 'Articles you bookmark will appear here so you can revisit them across devices.';
    if (this.selectedView === 'read_later') return 'Save articles for later and they will stay here until you mark them as read or remove them.';
    return 'Try broadening the source, category, or search query to bring more developer news back into the feed.';
  }

  selectView(view: NewsHubView): void {
    if (view === this.selectedView) return;

    this.selectedView = view;
    this.errorMessage = '';

    if (view === 'bookmarks') {
      this.loadSavedView('bookmark');
      return;
    }

    if (view === 'read_later') {
      this.loadSavedView('read_later');
      return;
    }

    this.filters = normalizeNewsFilters({ ...this.filters, tab: view });
    this.page = 1;
    this.fetch(false);
  }

  onFiltersChange(nextFilters: NewsFilters): void {
    if (!this.isFeedView) return;
    const normalized = normalizeNewsFilters(nextFilters);
    if (this.buildFilterSignature(normalized) === this.buildFilterSignature(this.filters)) return;
    this.applyFilters(normalized);
  }

  clearFilter(key: keyof NewsFilters): void {
    this.onFiltersChange({ ...this.filters, [key]: DEFAULT_NEWS_FILTERS[key] });
  }

  resetFilters(): void {
    if (!this.hasActiveFilters) return;
    this.onFiltersChange({ ...DEFAULT_NEWS_FILTERS, tab: this.filters.tab });
  }

  loadMore(): void {
    if (!this.isFeedView || this.isLoadingMore || this.page >= this.totalPages) return;
    this.page += 1;
    this.fetch(true);
  }

  retry(): void {
    if (this.isFeedView) {
      this.fetch(false, true);
      return;
    }

    const type = this.selectedSavedType;
    if (type) this.loadSavedView(type, true);
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

  isSavedActionPending(itemId: string, action: string): boolean {
    return this.savedActionPending.has(`${action}:${itemId}`);
  }

  onBookmarkToggle(article: NewsItem): void {
    this.toggleSavedState(article, 'bookmark');
  }

  onReadLaterToggle(article: NewsItem): void {
    this.toggleSavedState(article, 'read_later');
  }

  removeSavedItem(item: SavedNewsItem): void {
    const type = item.type;
    const snapshot = this.captureSavedSnapshot();
    const pendingKey = `remove:${item.id}`;
    if (!item.id || this.savedActionPending.has(pendingKey)) return;

    this.savedActionPending.add(pendingKey);
    this.savedItemsByType[type].delete(item.articleId);
    this.syncSavedSetsFromMaps();
    this.refreshSavedViewCollection(type);
    this.cdr.markForCheck();

    this.subscriptions.add(
      this.newsService.removeSavedNews(item.id).subscribe({
        next: () => {
          this.savedActionPending.delete(pendingKey);
          this.showToast('success', type === 'bookmark' ? 'Bookmark removed.' : 'Removed from Read Later.');
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.restoreSavedSnapshot(snapshot);
          this.savedActionPending.delete(pendingKey);
          this.showToast('error', error?.error?.message || 'Unable to remove this saved article right now.');
          this.cdr.markForCheck();
        }
      })
    );
  }

  markSavedItemAsRead(item: SavedNewsItem): void {
    const pendingKey = `read:${item.id}`;
    if (!item.id || item.readAt || this.savedActionPending.has(pendingKey)) return;

    const snapshot = this.captureSavedSnapshot();
    this.savedActionPending.add(pendingKey);
    this.patchSavedItemLocal({ ...item, readAt: new Date().toISOString() });
    this.cdr.markForCheck();

    this.subscriptions.add(
      this.newsService.markSavedNewsAsRead(item.id).subscribe({
        next: (updated) => {
          this.patchSavedItemLocal(updated);
          this.savedActionPending.delete(pendingKey);
          this.showToast('success', 'Marked as read.');
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.restoreSavedSnapshot(snapshot);
          this.savedActionPending.delete(pendingKey);
          this.showToast('error', error?.error?.message || 'Unable to mark this item as read.');
          this.cdr.markForCheck();
        }
      })
    );
  }

  moveReadLaterToBookmark(item: SavedNewsItem): void {
    const pendingKey = `move:${item.id}`;
    if (item.type !== 'read_later' || this.savedActionPending.has(pendingKey)) return;

    const snapshot = this.captureSavedSnapshot();
    const bookmarkPlaceholder: SavedNewsItem = {
      ...item,
      id: '',
      type: 'bookmark',
      readAt: item.readAt || new Date().toISOString()
    };

    this.savedActionPending.add(pendingKey);
    this.savedItemsByType.read_later.delete(item.articleId);
    this.savedItemsByType.bookmark.set(item.articleId, bookmarkPlaceholder);
    this.syncSavedSetsFromMaps();
    this.refreshSavedViewCollection('read_later');
    this.cdr.markForCheck();

    const article = this.toNewsItem(item);
    this.subscriptions.add(
      this.newsService.saveNews(article, 'bookmark').subscribe({
        next: (savedBookmark) => {
          this.savedItemsByType.bookmark.set(savedBookmark.articleId, savedBookmark);

          const finalizeRemoval = item.id
            ? this.newsService.removeSavedNews(item.id)
            : null;

          if (!finalizeRemoval) {
            this.savedActionPending.delete(pendingKey);
            this.showToast('success', 'Moved to bookmarks.');
            this.cdr.markForCheck();
            return;
          }

          this.subscriptions.add(
            finalizeRemoval.subscribe({
              next: () => {
                this.savedActionPending.delete(pendingKey);
                this.showToast('success', 'Moved to bookmarks.');
                this.cdr.markForCheck();
              },
              error: (error) => {
                this.restoreSavedSnapshot(snapshot);
                this.savedActionPending.delete(pendingKey);
                this.showToast('error', error?.error?.message || 'Unable to move this article right now.');
                this.cdr.markForCheck();
              }
            })
          );
        },
        error: (error) => {
          this.restoreSavedSnapshot(snapshot);
          this.savedActionPending.delete(pendingKey);
          this.showToast('error', error?.error?.message || 'Unable to move this article right now.');
          this.cdr.markForCheck();
        }
      })
    );
  }

  trackById(_: number, item: NewsItem): string {
    return item.id;
  }

  trackBySavedId(_: number, item: SavedNewsItem): string {
    return item.id || `${item.type}:${item.articleId}`;
  }

  trackByLabel(_: number, item: { label: string }): string {
    return item.label;
  }

  trackByProvider(_: number, item: NewsProviderDiagnostic): string {
    return item.provider;
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

    if (!force) {
      const cached = this.readFeedCache(normalizedFilters, this.page);
      if (cached) {
        this.applyFeedResponse(cached, append, requestSignature);
        return;
      }
    }

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

    this.activeRequest = this.newsService.getNews(normalizedFilters, this.page, PAGE_SIZE, { refresh: force }).subscribe({
      next: (response) => {
        if (requestId !== this.requestNonce) return;
        this.applyFeedResponse(response, append, requestSignature);
        this.writeFeedCache(normalizedFilters, this.page, response);
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

  private applyFeedResponse(response: any, append: boolean, requestSignature: string): void {
    const incomingItems = Array.isArray(response.items) ? response.items : [];
    this.items = append ? this.mergeUniqueItems(this.items, incomingItems) : incomingItems;
    this.total = Number(response.total || this.items.length);
    this.totalPages = Math.max(1, Number(response.totalPages || 1));
    this.trendingTopics = Array.isArray(response.trendingTopics) ? response.trendingTopics : [];
    this.sourceSummary = response.sourceSummary || {};
    this.recommendedBasedOn = response.recommendedBasedOn || null;
    this.telemetry = {
      ...(response.telemetry || { ...DEFAULT_TELEMETRY }),
      cacheHit: Boolean(response?.fromFrontendCache || response?.telemetry?.cacheHit)
    };
    this.rememberSignalHash(this.recommendedBasedOn?.signalHash || this.telemetry.signalHash || '');
    this.sourceBannerMessage = this.buildSourceBanner();
    this.lastUpdatedLabel = this.formatLastUpdated(this.recommendedBasedOn?.lastUpdated);
    this.errorMessage = '';
    this.isLoading = false;
    this.isLoadingMore = false;
    this.pendingSignature = '';
    this.lastCompletedSignature = requestSignature;
    this.cdr.markForCheck();
  }

  private readFeedCache(filters: NewsFilters, page: number): any | null {
    return this.frontendCache.get<any>(this.buildFeedCacheKey(filters, page));
  }

  private writeFeedCache(filters: NewsFilters, page: number, response: any): void {
    this.frontendCache.set(this.buildFeedCacheKey(filters, page), response);
  }

  private loadSavedItems(): void {
    const cached = this.readSavedCache('all');
    if (cached) {
      this.replaceSavedMaps(cached);
      if (!this.isFeedView && this.selectedSavedType) {
        this.refreshSavedViewCollection(this.selectedSavedType);
      }
      return;
    }

    this.subscriptions.add(
      this.newsService.getSavedNews().subscribe({
        next: (items) => {
          this.replaceSavedMaps(items);
          this.writeSavedCache('all', items);
          this.writeSavedCache('bookmark', Array.from(this.savedItemsByType.bookmark.values()));
          this.writeSavedCache('read_later', Array.from(this.savedItemsByType.read_later.values()));
          if (!this.isFeedView && this.selectedSavedType) {
            this.refreshSavedViewCollection(this.selectedSavedType);
          }
          this.persistClientState(BOOKMARK_KEY, this.bookmarks);
          this.persistClientState(READ_LATER_KEY, this.readLater);
        },
        error: () => {
          this.syncSavedMapFromLocalFallback();
          if (!this.isFeedView && this.selectedSavedType) {
            this.refreshSavedViewCollection(this.selectedSavedType);
          }
          this.cdr.markForCheck();
        }
      })
    );
  }

  private loadSavedView(type: NewsSavedType, force = false): void {
    const cached = !force ? this.readSavedCache(type) : null;
    if (cached) {
      this.savedItemsByType[type].clear();
      cached.forEach((item) => this.savedItemsByType[type].set(item.articleId, item));
      this.savedViewLoaded[type] = true;
      this.syncSavedSetsFromMaps();
      this.refreshSavedViewCollection(type);
      return;
    }

    if (!force && this.savedViewLoaded[type]) {
      this.refreshSavedViewCollection(type);
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.subscriptions.add(
      this.newsService.getSavedNewsByType(type).subscribe({
        next: (items) => {
          this.savedItemsByType[type].clear();
          items.forEach((item) => this.savedItemsByType[type].set(item.articleId, item));
          this.writeSavedCache(type, items);
          this.writeSavedCache('all', [
            ...Array.from(this.savedItemsByType.bookmark.values()),
            ...Array.from(this.savedItemsByType.read_later.values())
          ]);
          this.savedViewLoaded[type] = true;
          this.syncSavedSetsFromMaps();
          this.refreshSavedViewCollection(type);
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Unable to load saved articles right now.';
          this.refreshSavedViewCollection(type);
          this.isLoading = false;
          this.cdr.markForCheck();
        }
      })
    );
  }

  private toggleSavedState(article: NewsItem, type: NewsSavedType): void {
    const articleId = article.id;
    const pendingSet = type === 'bookmark' ? this.bookmarkPending : this.readLaterPending;
    if (!articleId || pendingSet.has(articleId)) return;

    const snapshot = this.captureSavedSnapshot();
    const targetSet = type === 'bookmark' ? this.bookmarks : this.readLater;
    const storageKey = type === 'bookmark' ? BOOKMARK_KEY : READ_LATER_KEY;
    const wasSaved = targetSet.has(articleId);
    const previousSavedItem = this.findSavedItem(article, type);

    if (wasSaved) {
      this.savedItemsByType[type].delete(articleId);
      this.syncSavedSetsFromMaps();
    } else {
      targetSet.add(articleId);
      this.persistClientState(storageKey, targetSet);
    }

    pendingSet.add(articleId);
    if (!this.isFeedView && this.selectedSavedType === type) {
      this.refreshSavedViewCollection(type);
    }
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
            pendingSet.delete(articleId);
            this.showToast('success', type === 'bookmark' ? 'Bookmark removed.' : 'Removed from Read Later.');
            this.cdr.markForCheck();
          },
          error: (error) => {
            this.restoreSavedSnapshot(snapshot);
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
          this.syncSavedSetsFromMaps();
          pendingSet.delete(articleId);
          if (!this.isFeedView && this.selectedSavedType === type) {
            this.refreshSavedViewCollection(type);
          }
          this.showToast('success', type === 'bookmark' ? 'Article bookmarked.' : 'Saved to Read Later.');
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.restoreSavedSnapshot(snapshot);
          pendingSet.delete(articleId);
          this.showToast('error', error?.error?.message || 'Unable to save this article right now.');
          this.cdr.markForCheck();
        }
      })
    );
  }

  private replaceSavedMaps(items: SavedNewsItem[]): void {
    this.savedItemsByType.bookmark.clear();
    this.savedItemsByType.read_later.clear();
    items.forEach((item) => this.savedItemsByType[item.type].set(item.articleId, item));
    this.syncSavedSetsFromMaps();
  }

  private refreshSavedViewCollection(type: NewsSavedType): void {
    this.savedItemsView = Array.from(this.savedItemsByType[type].values()).sort(
      (left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
    );
  }

  private syncSavedSetsFromMaps(): void {
    this.bookmarks = new Set(Array.from(this.savedItemsByType.bookmark.keys()));
    this.readLater = new Set(Array.from(this.savedItemsByType.read_later.keys()));
    this.persistClientState(BOOKMARK_KEY, this.bookmarks);
    this.persistClientState(READ_LATER_KEY, this.readLater);
    this.writeAllSavedCaches();
  }

  private patchSavedItemLocal(item: SavedNewsItem): void {
    this.savedItemsByType[item.type].set(item.articleId, item);
    if (this.selectedSavedType === item.type) {
      this.savedItemsView = this.savedItemsView.map((entry) => (entry.articleId === item.articleId ? item : entry));
    }
    this.writeAllSavedCaches();
  }

  private findSavedItem(article: NewsItem, type: NewsSavedType): SavedNewsItem | undefined {
    const direct = this.savedItemsByType[type].get(article.id);
    if (direct) return direct;

    for (const item of this.savedItemsByType[type].values()) {
      if (item.url === article.url) return item;
    }

    return undefined;
  }

  private toNewsItem(item: SavedNewsItem): NewsItem {
    return {
      id: item.articleId,
      title: item.title,
      description: '',
      source: item.source,
      url: item.url,
      image: item.image,
      publishedAt: item.publishedAt || item.createdAt || new Date().toISOString(),
      category: item.category,
      popularity: 0,
      relevanceScore: 0,
      rankScore: 0,
      tags: []
    };
  }

  private captureSavedSnapshot() {
    return {
      bookmarks: new Set(this.bookmarks),
      readLater: new Set(this.readLater),
      bookmarkMap: new Map(this.savedItemsByType.bookmark),
      readLaterMap: new Map(this.savedItemsByType.read_later),
      savedItemsView: [...this.savedItemsView]
    };
  }

  private restoreSavedSnapshot(snapshot: {
    bookmarks: Set<string>;
    readLater: Set<string>;
    bookmarkMap: Map<string, SavedNewsItem>;
    readLaterMap: Map<string, SavedNewsItem>;
    savedItemsView: SavedNewsItem[];
  }): void {
    this.bookmarks = new Set(snapshot.bookmarks);
    this.readLater = new Set(snapshot.readLater);
    this.savedItemsByType.bookmark.clear();
    this.savedItemsByType.read_later.clear();
    snapshot.bookmarkMap.forEach((value, key) => this.savedItemsByType.bookmark.set(key, value));
    snapshot.readLaterMap.forEach((value, key) => this.savedItemsByType.read_later.set(key, value));
    this.savedItemsView = [...snapshot.savedItemsView];
    this.persistClientState(BOOKMARK_KEY, this.bookmarks);
    this.persistClientState(READ_LATER_KEY, this.readLater);
    this.writeAllSavedCaches();
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
      createdAt: null,
      readAt: null
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

  formatSavedDate(value: string | null): string {
    if (!value) return 'Saved recently';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Saved recently';
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

  private buildFeedCacheKey(filters: NewsFilters, page: number): FrontendAnalysisCacheKey {
    const profile = this.careerProfileService.snapshot;
    const normalized = normalizeNewsFilters(filters);
    const filterHash = this.stableHash(JSON.stringify({ ...normalized, page, limit: PAGE_SIZE }));
    const profileHash = this.stableHash(this.profileSignature || JSON.stringify(profile));
    const signalHash = this.stableHash(`${this.currentSignalHash || 'no-server-signal'}:${profileHash}`);
    return {
      module: 'news-feed',
      careerStack: profile.careerStack,
      experienceLevel: profile.experienceLevel,
      signalHash,
      limit: PAGE_SIZE,
      version: `${normalized.tab}:${page}:${filterHash}:${signalHash}`,
      ttlMs: FEED_CACHE_TTL_MS
    };
  }

  private buildSavedCacheKey(type: NewsSavedType | 'all'): FrontendAnalysisCacheKey {
    const profile = this.careerProfileService.snapshot;
    return {
      module: 'news-saved',
      careerStack: profile.careerStack,
      experienceLevel: profile.experienceLevel,
      signalHash: this.currentSignalHash || 'saved',
      version: `${type}:${this.currentSignalHash || 'saved'}`,
      ttlMs: SAVED_CACHE_TTL_MS
    };
  }

  private readSavedCache(type: NewsSavedType | 'all'): SavedNewsItem[] | null {
    const cached = this.frontendCache.get<{ items?: SavedNewsItem[] }>(this.buildSavedCacheKey(type));
    if (Array.isArray(cached?.items)) return cached.items;
    return null;
  }

  private writeSavedCache(type: NewsSavedType | 'all', items: SavedNewsItem[]): void {
    this.frontendCache.set(this.buildSavedCacheKey(type), { items });
  }

  private writeAllSavedCaches(): void {
    const bookmarks = Array.from(this.savedItemsByType.bookmark.values());
    const readLater = Array.from(this.savedItemsByType.read_later.values());
    this.writeSavedCache('bookmark', bookmarks);
    this.writeSavedCache('read_later', readLater);
    this.writeSavedCache('all', [...bookmarks, ...readLater]);
  }

  private rememberSignalHash(value: string): void {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === this.currentSignalHash) return;
    this.currentSignalHash = normalized;
    localStorage.setItem(SIGNAL_HASH_KEY, normalized);
  }

  private stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0).toString(36);
  }

  private restoreClientState(): void {
    this.currentSignalHash = localStorage.getItem(SIGNAL_HASH_KEY) || '';
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
