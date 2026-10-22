import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Observable,
  Subject,
  Subscription,
  combineLatest,
  distinctUntilChanged,
  map,
  takeUntil,
} from 'rxjs';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { buildCareerProfileSignature } from '../../shared/models/career-profile.model';
import { AuthService } from '../../shared/services/auth.service';
import { NewsService } from '../../shared/services/news.service';
import { NEWS_SKILL_EVIDENCE_LABELS } from '../../shared/utils/news-presentation';
import { NewsCardComponent } from '../../shared/components/news-card/news-card';
import { NewsFiltersComponent } from '../../shared/components/news-filters/news-filters';
import {
  DEFAULT_NEWS_FILTERS,
  NewsFilters,
  NewsHubView,
  NewsItem,
  NewsProviderDiagnostic,
  NewsResponse,
  NewsSavedType,
  PersonalizedNewsContext,
  SavedNewsItem,
  normalizeNewsFilters,
} from '../../shared/models/news.model';

@Component({
  selector: 'app-news',
  standalone: true,
  imports: [CommonModule, NewsCardComponent, NewsFiltersComponent],
  templateUrl: './news.component.html',
  styleUrl: './news.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewsComponent implements OnInit, OnDestroy {
  readonly evidenceLabels = NEWS_SKILL_EVIDENCE_LABELS;
  readonly viewTabs: { value: NewsHubView; label: string }[] = [
    { value: 'for-you', label: 'For You' },
    { value: 'explore', label: 'Explore' },
    { value: 'trending', label: 'Trending' },
    { value: 'latest', label: 'Latest' },
    { value: 'bookmarks', label: 'Bookmarks' },
    { value: 'read_later', label: 'Read Later' },
  ];
  readonly skeletonCards = [0, 1, 2, 3, 4, 5];
  selectedView: NewsHubView = 'for-you';
  filters: NewsFilters = { ...DEFAULT_NEWS_FILTERS };
  items: NewsItem[] = [];
  context: PersonalizedNewsContext | null = null;
  telemetry: NewsResponse['telemetry'];
  coverage: NewsResponse['coverage'];
  enrichment: NewsResponse['enrichment'];
  discoveryChecks = 0;
  private discoveryTimer?: ReturnType<typeof setTimeout>;
  trendingTopics: string[] = [];
  page = 1;
  pageSize = 12;
  total = 0;
  totalPages = 1;
  isLoading = false;
  errorMessage = '';
  savedError = '';
  toast = '';
  offline = typeof navigator !== 'undefined' && !navigator.onLine;
  filtersExpanded = false;
  historyFilter: 'all' | 'unread' | 'read' = 'all';
  readonly pending = new Set<string>();
  readonly library: Record<NewsSavedType, Map<string, SavedNewsItem>> = {
    bookmark: new Map(),
    read_later: new Map(),
  };
  readonly savedTotal: Record<NewsSavedType, number> = { bookmark: 0, read_later: 0 };
  readonly savedPage: Record<NewsSavedType, number> = { bookmark: 1, read_later: 1 };
  readonly savedHasMore: Record<NewsSavedType, boolean> = { bookmark: false, read_later: false };
  readonly savedKnown = new Set<NewsSavedType>();
  readonly savedLoading = new Set<NewsSavedType>();
  private readonly subscriptions = new Subscription();
  private readonly scopeChanged = new Subject<void>();
  private readonly savedRequests: Partial<Record<NewsSavedType, Subscription>> = {};
  private activeRequest?: Subscription;
  private generation = 0;
  private feedNonce = 0;
  private scope = '';
  private lastValidated = 0;
  private attemptedPage = 1;
  private failedRefresh = false;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  now = Date.now();

  constructor(
    private readonly news: NewsService,
    private readonly career: CareerProfileService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      combineLatest([this.auth.currentUser$, this.career.careerProfile$])
        .pipe(
          map(([user, profile]) =>
            user?._id
              ? JSON.stringify([
                  user._id,
                  user.activeGithubUsername,
                  user['activeResumeFileId'],
                  user.activeCareerStack,
                  buildCareerProfileSignature(profile),
                ])
              : '',
          ),
          distinctUntilChanged(),
        )
        .subscribe((scope) => this.resetScope(scope)),
    );
    this.subscriptions.add(this.news.invalidated$.subscribe(() => this.resetScope(this.scope)));
    window.addEventListener('focus', this.onFocus);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onFocus);
  }

  ngOnDestroy(): void {
    clearTimeout(this.discoveryTimer);
    this.scopeChanged.next();
    this.scopeChanged.complete();
    this.activeRequest?.unsubscribe();
    Object.values(this.savedRequests).forEach((request) => request?.unsubscribe());
    this.subscriptions.unsubscribe();
    clearTimeout(this.toastTimer);
    clearInterval(this.clock);
    window.removeEventListener('focus', this.onFocus);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onFocus);
  }

  get isFeedView(): boolean {
    return ['for-you', 'explore', 'trending', 'latest'].includes(this.selectedView);
  }
  get discoveryPending(): boolean {
    return this.enrichment?.status === 'queued' || this.enrichment?.status === 'searching';
  }
  get discoveryRecoverable(): boolean {
    return (
      this.enrichment?.status === 'unavailable' &&
      ['quota_store_unavailable', 'queue_full'].includes(this.enrichment.reason)
    );
  }
  get discoveryTitle(): string {
    switch (this.enrichment?.status) {
      case 'queued':
        return 'Background discovery queued';
      case 'searching':
        return 'Searching additional sources';
      case 'ready':
        return 'Topic results cached';
      case 'exhausted':
        return 'No usable articles found in the last search';
      case 'quota_limited':
        return 'Discovery budget or cooldown reached';
      case 'disabled':
        return 'Background discovery is disabled';
      case 'unavailable':
        return 'Background discovery is temporarily unavailable';
      default:
        return this.total ? 'Cached matches available' : 'Cached search complete';
    }
  }
  get discoveryMessage(): string {
    if (this.discoveryPending)
      return this.discoveryChecks >= 4
        ? 'Automatic checks have finished. Check results later; more articles are not guaranteed.'
        : this.page > 1
          ? 'Discovery continues in the background. Return to page one to check results.'
          : 'Available matches stay visible. We check briefly for cached updates; more articles are not guaranteed.';
    switch (this.coverage?.status) {
      case 'unsupported_query':
        return 'This query searches cached articles only. Background discovery does not support this topic; try a technology such as DevOps, CI/CD or Kubernetes.';
      case 'restrictive_filters':
        return 'These filters may limit coverage. Try a broader date range, all sources or all popularity levels; filters have not been changed.';
      case 'source_exhausted':
        return 'The selected source returned no articles in its last ingestion check. This is not a search of its entire archive.';
    }
    switch (this.enrichment?.status) {
      case 'ready':
        return 'The last topic search cached results. Your selected filters still apply.';
      case 'exhausted':
        return 'The last bounded source search found no matching articles. Broaden your filters or check later.';
      case 'quota_limited':
        return 'Cached results remain available. The backend controls when another search may be admitted.';
      case 'disabled':
        return 'Only available cached articles are searched. No additional sources are being requested.';
      case 'unavailable':
        return this.items.length
          ? 'Available cached matches are shown. Background search is temporarily unavailable; check cached results again shortly.'
          : 'No cached articles match these filters yet. Background search is temporarily unavailable; check cached results again shortly.';
      default:
        return this.selectedView === 'explore'
          ? 'Search available technology news independently of your skills. Source coverage is bounded.'
          : 'Matching and totals come from the current cached news pool.';
    }
  }
  get savedType(): NewsSavedType {
    return this.selectedView === 'bookmarks' ? 'bookmark' : 'read_later';
  }
  get savedItems(): SavedNewsItem[] {
    return [...this.library[this.savedType].values()].filter(
      (item) =>
        this.savedType !== 'read_later' ||
        this.historyFilter === 'all' ||
        (this.historyFilter === 'read'
          ? !!(item.firstReadAt || item.lastReadAt || item.readAt || item.readCount)
          : !item.readAt),
    );
  }
  get sourceDiagnostics(): NewsProviderDiagnostic[] {
    return this.telemetry?.providerDiagnostics || [];
  }
  get pageNumbers(): (number | null)[] {
    const current = Math.min(this.page, this.totalPages);
    const pages = new Set([1, this.totalPages]);
    for (
      let value = Math.max(1, current - 1);
      value <= Math.min(this.totalPages, current + 1);
      value++
    )
      pages.add(value);
    const result: (number | null)[] = [];
    for (const value of [...pages].sort((a, b) => a - b)) {
      const previous = result[result.length - 1];
      if (previous && value - previous > 1) result.push(null);
      result.push(value);
    }
    return result;
  }
  get freshnessLabel(): string {
    if (this.offline) return 'Offline';
    if (this.telemetry?.freshness === 'warming') return 'Warming up';
    if (this.telemetry?.freshness === 'stale' || this.telemetry?.staleFallback)
      return 'Stale snapshot';
    return this.telemetry?.freshness === 'fresh' ? 'Fresh snapshot' : 'Freshness unavailable';
  }
  get sourceMessage(): string {
    if (this.offline)
      return 'You are offline. Previously loaded articles remain available; saved changes need a connection.';
    if (this.telemetry?.freshness === 'warming')
      return 'Sources are warming up. Check again shortly; articles appear after the next background update.';
    if (this.telemetry?.providerFailureCount)
      return 'Some sources are temporarily unavailable. Available and retained articles are shown below.';
    if (this.telemetry?.freshness === 'stale')
      return 'Showing retained articles while sources recover. Publication dates and the last update remain unchanged.';
    return this.selectedView === 'explore'
      ? 'A shared technology news snapshot, independent of your developer skills.'
      : 'A shared news snapshot, ranked for your current developer context.';
  }
  get updatedAt(): string | null {
    return this.telemetry?.lastUpdated || this.context?.lastUpdated || null;
  }
  get retrySeconds(): number {
    return Math.max(
      0,
      Math.ceil(
        (Math.max(
          this.news.retryAt('feed'),
          this.failedRefresh && this.isFeedView ? this.news.retryAt('refresh') : 0,
        ) -
          this.now) /
          1000,
      ),
    );
  }
  get refreshSeconds(): number {
    return Math.max(
      this.retrySeconds,
      Math.max(0, Math.ceil((this.news.retryAt('refresh') - this.now) / 1000)),
    );
  }
  get mutationBlocked(): boolean {
    return this.offline || this.news.retryAt('mutation') > this.now;
  }
  get hasFilters(): boolean {
    return (
      JSON.stringify(this.filters) !==
      JSON.stringify({ ...DEFAULT_NEWS_FILTERS, tab: this.filters.tab, mode: this.filters.mode })
    );
  }

  selectView(view: NewsHubView): void {
    if (view === this.selectedView) return;
    this.cancelFeed();
    this.resetDiscovery();
    this.selectedView = view;
    this.errorMessage = '';
    this.savedError = '';
    if (this.isFeedView) {
      this.filters = {
        ...this.filters,
        mode: view === 'explore' ? 'explore' : 'personalized',
        tab: view === 'explore' ? 'latest' : (view as NewsFilters['tab']),
      };
      this.items = [];
      this.context = null;
      this.telemetry = undefined;
      this.page = 1;
      this.total = 0;
      this.totalPages = 1;
      this.fetch(1);
    } else {
      this.loadLibrary(this.savedType, 1, true);
    }
  }

  onFiltersChange(filters: NewsFilters): void {
    const normalized = normalizeNewsFilters(filters);
    if (JSON.stringify(normalized) === JSON.stringify(this.filters)) return;
    this.filters = normalized;
    this.resetDiscovery();
    this.items = [];
    this.context = null;
    this.telemetry = undefined;
    this.page = 1;
    this.total = 0;
    this.totalPages = 1;
    this.fetch(1);
  }
  resetFilters(): void {
    this.onFiltersChange({
      ...DEFAULT_NEWS_FILTERS,
      tab: this.filters.tab,
      mode: this.filters.mode,
    });
  }
  searchTopic(topic: string): void {
    this.onFiltersChange({ ...this.filters, search: topic });
  }
  selectPage(page: number): void {
    if (
      !this.isFeedView ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > this.totalPages ||
      page === this.page ||
      this.isLoading ||
      this.offline ||
      this.retrySeconds
    )
      return;
    this.fetch(page);
  }
  forceRefresh(): void {
    if (!this.offline && !this.refreshSeconds && !this.isLoading) this.fetch(1, true);
  }
  retry(): void {
    if (this.isFeedView) this.fetch(this.attemptedPage);
    else this.loadLibrary(this.savedType, this.savedPage[this.savedType], true);
  }
  loadMoreSaved(): void {
    if (!this.savedLoading.has(this.savedType) && this.savedHasMore[this.savedType])
      this.loadLibrary(this.savedType, this.savedPage[this.savedType] + 1);
  }

  isSaved(article: NewsItem, type: NewsSavedType): boolean {
    return !!this.findSaved(article, type);
  }
  articlePending(article: NewsItem, type: NewsSavedType): boolean {
    return (
      this.pending.has(`${type}:${article.url}`) ||
      this.mutationBlocked ||
      this.savedLoading.has(type)
    );
  }
  itemPending(item: SavedNewsItem): boolean {
    return this.pending.has(`${item.type}:${item.url}`) || this.mutationBlocked;
  }

  toggleSave(article: NewsItem, type: NewsSavedType): void {
    if (this.articlePending(article, type)) return;
    const existing = this.findSaved(article, type);
    if (existing) {
      this.removeSavedItem(existing);
      return;
    }
    this.runAction(`${type}:${article.url}`, this.news.saveNews(article, type), (item) => {
      this.library[type].set(item.id, item);
      this.showToast(type === 'bookmark' ? 'Bookmark saved.' : 'Added to Read Later.');
      this.loadLibrary(type, 1, true);
    });
  }
  removeSavedItem(item: SavedNewsItem): void {
    if (this.itemPending(item)) return;
    this.runAction(`${item.type}:${item.url}`, this.news.removeSavedNews(item.id), () => {
      this.library[item.type].delete(item.id);
      this.showToast('Saved article removed.');
      this.loadLibrary(item.type, 1, true);
    });
  }
  markSavedItemAsRead(item: SavedNewsItem, read = true): void {
    if (item.type !== 'read_later' || !!item.readAt === read || this.itemPending(item)) return;
    this.runAction(
      `${item.type}:${item.url}`,
      this.news.markSavedNewsAsRead(item.id, read),
      (updated) => {
        this.library.read_later.set(updated.id, updated);
        this.showToast(read ? 'Marked as read.' : 'Marked as unread. Reading history preserved.');
      },
    );
  }
  bookmarkSaved(item: SavedNewsItem): void {
    if (this.itemPending(item) || this.pending.has(`bookmark:${item.url}`)) return;
    this.runAction(
      `bookmark:${item.url}`,
      this.news.saveNews(
        { ...item, id: item.articleId, publishedAt: item.publishedAt || '' },
        'bookmark',
      ),
      (saved) => {
        this.library.bookmark.set(saved.id, saved);
        this.showToast('Bookmarked. Your reading history is preserved.');
        this.loadLibrary('bookmark', 1, true);
      },
    );
  }
  trackId(_: number, item: { id: string }): string {
    return item.id;
  }

  private fetch(page: number, refresh = false): void {
    if (!this.scope || this.offline || (!refresh && this.retrySeconds)) return;
    this.cancelFeed();
    const nonce = this.feedNonce;
    const generation = this.generation;
    this.attemptedPage = page;
    this.failedRefresh = refresh;
    this.isLoading = true;
    this.errorMessage = '';
    this.activeRequest = this.news
      .getNews(this.filters, page, this.pageSize, { refresh, revalidate: true })
      .subscribe({
        next: (response) => {
          if (generation !== this.generation || nonce !== this.feedNonce || !this.isFeedView)
            return;
          const incoming = response.items || [];
          this.items = incoming;
          this.page = response.page;
          this.pageSize = response.limit || this.pageSize;
          this.total = response.total;
          this.totalPages = response.totalPages;
          this.context = response.recommendedBasedOn || null;
          this.telemetry = response.telemetry;
          this.coverage = response.coverage;
          this.enrichment = response.enrichment;
          this.trendingTopics = response.trendingTopics;
          this.isLoading = false;
          this.lastValidated = Date.now();
          this.scheduleDiscoveryCheck();
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (nonce !== this.feedNonce || generation !== this.generation) return;
          this.errorMessage = this.errorText(error.status);
          this.isLoading = false;
          this.startClock();
          this.cdr.markForCheck();
        },
      });
    this.cdr.markForCheck();
  }

  private loadLibrary(type: NewsSavedType, page = 1, force = false): void {
    if (!this.scope || this.offline) return;
    this.savedRequests[type]?.unsubscribe();
    const generation = this.generation;
    this.savedLoading.add(type);
    this.savedRequests[type] = this.news.getSavedNewsByType(type, page, force).subscribe({
      next: (response) => {
        if (generation !== this.generation) return;
        if (page === 1) this.library[type].clear();
        response.items.forEach((item) => this.library[type].set(item.id, item));
        this.savedKnown.add(type);
        this.savedTotal[type] = response.total;
        this.savedPage[type] = response.page;
        this.savedHasMore[type] = response.hasMore;
        this.savedError = '';
        this.savedLoading.delete(type);
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (generation !== this.generation) return;
        this.savedError = this.errorText(error.status);
        this.savedLoading.delete(type);
        this.startClock();
        this.cdr.markForCheck();
      },
      complete: () => {
        this.savedLoading.delete(type);
        this.cdr.markForCheck();
      },
    });
    this.cdr.markForCheck();
  }

  private runAction<T>(
    key: string,
    request: Observable<T>,
    acknowledged: (value: T) => void,
  ): void {
    if (this.pending.has(key) || this.mutationBlocked) return;
    const generation = this.generation;
    this.pending.add(key);
    // Cancel list reads so an older snapshot cannot undo a confirmed mutation.
    Object.values(this.savedRequests).forEach((subscription) => subscription?.unsubscribe());
    this.savedLoading.clear();
    this.subscriptions.add(
      request.pipe(takeUntil(this.scopeChanged)).subscribe({
        next: (value) => {
          if (generation === this.generation) {
            acknowledged(value);
            this.cdr.markForCheck();
          }
        },
        error: (error) => {
          if (generation !== this.generation) return;
          this.pending.delete(key);
          this.showToast(this.errorText(error.status));
          this.startClock();
          // The server may have accepted a write before a transport failure.
          this.loadLibrary('bookmark', 1, true);
          this.loadLibrary('read_later', 1, true);
        },
        complete: () => {
          this.pending.delete(key);
          this.cdr.markForCheck();
        },
      }),
    );
    this.cdr.markForCheck();
  }

  private resetScope(scope: string): void {
    this.resetDiscovery();
    this.scope = scope;
    this.generation++;
    this.scopeChanged.next();
    this.cancelFeed();
    this.news.clearCache();
    Object.values(this.savedRequests).forEach((subscription) => subscription?.unsubscribe());
    this.library.bookmark.clear();
    this.library.read_later.clear();
    this.pending.clear();
    this.savedLoading.clear();
    this.savedKnown.clear();
    this.savedTotal.bookmark = 0;
    this.savedTotal.read_later = 0;
    this.items = [];
    this.context = null;
    this.telemetry = undefined;
    this.trendingTopics = [];
    this.total = 0;
    this.page = 1;
    this.totalPages = 1;
    this.errorMessage = '';
    this.savedError = '';
    this.toast = '';
    this.historyFilter = 'all';
    if (scope) {
      this.loadLibrary('bookmark', 1, true);
      this.loadLibrary('read_later', 1, true);
      if (this.isFeedView) this.fetch(1);
    }
    this.cdr.markForCheck();
  }
  private cancelFeed(): void {
    clearTimeout(this.discoveryTimer);
    this.feedNonce++;
    this.activeRequest?.unsubscribe();
    this.isLoading = false;
  }
  private resetDiscovery(): void {
    clearTimeout(this.discoveryTimer);
    this.discoveryChecks = 0;
    this.coverage = undefined;
    this.enrichment = undefined;
  }
  private scheduleDiscoveryCheck(): void {
    clearTimeout(this.discoveryTimer);
    if (
      (!this.discoveryPending && !this.discoveryRecoverable) ||
      this.discoveryChecks >= 4 ||
      this.page !== 1 ||
      !this.isFeedView ||
      this.offline ||
      document.visibilityState === 'hidden'
    )
      return;
    const eligibleAt = Date.parse(this.enrichment?.nextEligibleAt || '');
    // Retry only brief admission outages, at the server's next eligible time.
    // Source failures and provider quota cooldowns never start this retry loop.
    const delay =
      this.discoveryRecoverable && Number.isFinite(eligibleAt)
        ? Math.max(20000, eligibleAt - Date.now())
        : 20000;
    if (delay > 120000) return;
    const nonce = this.feedNonce;
    this.discoveryTimer = setTimeout(() => {
      if (
        nonce !== this.feedNonce ||
        this.offline ||
        document.visibilityState === 'hidden' ||
        this.retrySeconds ||
        this.isLoading
      )
        return;
      this.discoveryChecks++;
      // Ordinary cache revalidation only: never request provider refresh.
      this.fetch(1);
    }, delay);
  }
  private findSaved(article: NewsItem, type: NewsSavedType): SavedNewsItem | undefined {
    return [...this.library[type].values()].find(
      (item) => item.articleId === article.id || item.url === article.url,
    );
  }
  private errorText(status: number): string {
    if (status === 429) return 'Too many requests. Wait for the retry timer before trying again.';
    if (status === 503)
      return 'News is temporarily unavailable. Your loaded articles are still here.';
    if (status === 0) return 'Connection interrupted. Check your connection and try again.';
    if ([401, 403].includes(status)) return 'Your session cannot access this news. Sign in again.';
    return 'The server could not confirm this request. Please try again.';
  }
  private showToast(message: string): void {
    clearTimeout(this.toastTimer);
    this.toast = message;
    this.toastTimer = setTimeout(() => {
      this.toast = '';
      this.cdr.markForCheck();
    }, 5000);
    this.cdr.markForCheck();
  }
  private startClock(): void {
    this.now = Date.now();
    if (this.clock) return;
    this.clock = setInterval(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
      if (!this.retrySeconds && !this.refreshSeconds && !this.mutationBlocked) {
        clearInterval(this.clock);
        this.clock = undefined;
      }
    }, 1000);
  }
  private revalidate(): void {
    if (!this.scope || this.offline || this.pending.size) return;
    this.loadLibrary('bookmark', 1, true);
    this.loadLibrary('read_later', 1, true);
    if (this.isFeedView && !this.isLoading) this.fetch(this.page);
    this.lastValidated = Date.now();
  }
  private readonly onFocus = () => {
    if (document.visibilityState === 'visible' && Date.now() - this.lastValidated > 30000)
      this.revalidate();
  };
  private readonly onOnline = () => {
    this.offline = false;
    this.revalidate();
    this.cdr.markForCheck();
  };
  private readonly onOffline = () => {
    clearTimeout(this.discoveryTimer);
    this.offline = true;
    this.cdr.markForCheck();
  };
}
