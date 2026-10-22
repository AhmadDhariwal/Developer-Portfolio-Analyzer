import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { NewsComponent } from './news.component';
import { NewsService } from '../../shared/services/news.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { AuthService } from '../../shared/services/auth.service';
import {
  NewsItem,
  NewsResponse,
  SavedNewsItem,
  NewsSkillEvidenceStatus,
} from '../../shared/models/news.model';
import { NewsCardComponent } from '../../shared/components/news-card/news-card';
import { NewsFiltersComponent } from '../../shared/components/news-filters/news-filters';
const article: NewsItem = {
  id: 'one',
  title: 'React engineering update',
  description: '',
  url: 'https://example.com/one',
  image: '',
  source: 'Dev.to',
  publishedAt: new Date().toISOString(),
  category: 'Frontend',
  popularity: 0,
  relevanceScore: 0,
  rankScore: 0,
  tags: [],
};
const feed = (items = [article], page = 1): NewsResponse => ({
  items,
  page,
  limit: 12,
  total: 3,
  totalPages: 2,
  hasMore: page < 2,
  activeTab: 'for-you',
  sourceSummary: {},
  trendingTopics: [],
  telemetry: {
    cacheHit: true,
    freshness: 'fresh',
    providerFailureCount: 0,
    providerUsed: ['Dev.to'],
    responseTimeMs: 1,
  },
});
const saved: SavedNewsItem = {
  id: 'server-id',
  articleId: article.id,
  title: article.title,
  url: article.url,
  image: '',
  source: 'Dev.to',
  category: 'Frontend',
  publishedAt: article.publishedAt,
  createdAt: article.publishedAt,
  type: 'read_later',
  readAt: null,
};
describe('News Hub lifecycle', () => {
  let component: NewsComponent;
  let user: BehaviorSubject<{ _id: string }>;
  let api: any;
  beforeEach(() => {
    user = new BehaviorSubject({ _id: 'one' });
    api = {
      getNews: vi.fn(() => of(feed())),
      getSavedNewsByType: vi.fn((_type: string, page = 1) =>
        of({ items: [], total: 0, page, hasMore: false }),
      ),
      clearCache: vi.fn(),
      invalidated$: new Subject(),
      retryAt: vi.fn(() => 0),
      saveNews: vi.fn(),
      removeSavedNews: vi.fn(),
      markSavedNewsAsRead: vi.fn(),
    };
    component = new NewsComponent(
      api as NewsService,
      {
        careerProfile$: new BehaviorSubject({
          careerStack: 'Frontend',
          experienceLevel: 'Student',
        }),
      } as unknown as CareerProfileService,
      { currentUser$: user } as unknown as AuthService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.ngOnInit();
  });
  afterEach(() => {
    component.ngOnDestroy();
    vi.restoreAllMocks();
  });
  it('replaces the page in authoritative order and requests next/previous without refresh', () => {
    api.getNews
      .mockReturnValueOnce(
        of(
          feed(
            [
              { ...article, id: 'three' },
              { ...article, id: 'two' },
            ],
            2,
          ),
        ),
      )
      .mockReturnValueOnce(of(feed()));
    component.selectPage(2);
    expect(component.items.map((item) => item.id)).toEqual(['three', 'two']);
    expect(component.page).toBe(2);
    expect(api.getNews).toHaveBeenLastCalledWith(component.filters, 2, 12, {
      refresh: false,
      revalidate: true,
    });
    component.selectPage(1);
    expect(component.items.map((item) => item.id)).toEqual(['one']);
    expect(api.getNews).toHaveBeenLastCalledWith(component.filters, 1, 12, {
      refresh: false,
      revalidate: true,
    });
  });
  it('blocks invalid boundaries, current pages, offline and duplicate pending navigation', () => {
    api.getNews.mockClear();
    for (const page of [0, -1, 1, 3, 1.5, NaN]) component.selectPage(page);
    expect(api.getNews).not.toHaveBeenCalled();
    component.offline = true;
    component.selectPage(2);
    expect(api.getNews).not.toHaveBeenCalled();
    component.offline = false;
    const pending = new Subject<NewsResponse>();
    api.getNews.mockReturnValue(pending);
    component.selectPage(2);
    component.selectPage(2);
    expect(api.getNews).toHaveBeenCalledTimes(1);
    expect(component.page).toBe(1);
    expect(component.items).toEqual([article]);
    component.onFiltersChange({ ...component.filters, search: 'React' });
    expect(api.getNews).toHaveBeenLastCalledWith(component.filters, 1, 12, {
      refresh: false,
      revalidate: true,
    });
  });
  it('resets filters and all feed tabs to page one and cancels obsolete page responses', () => {
    const pending = new Subject<NewsResponse>();
    api.getNews.mockReturnValueOnce(pending).mockReturnValue(of(feed()));
    component.selectPage(2);
    component.onFiltersChange({ ...component.filters, source: 'Dev.to' });
    expect(pending.observed).toBe(false);
    pending.next(feed([{ ...article, id: 'obsolete' }], 2));
    expect(component.page).toBe(1);
    expect(component.items[0].id).toBe('one');
    for (const tab of ['trending', 'latest', 'for-you'] as const) {
      component.page = 2;
      component.selectView(tab);
      expect(api.getNews).toHaveBeenLastCalledWith(expect.objectContaining({ tab }), 1, 12, {
        refresh: false,
        revalidate: true,
      });
      expect(component.page).toBe(1);
    }
  });
  it('uses server totals and effective limit, including empty pages after cache shrink', () => {
    api.getNews.mockReturnValue(of({ ...feed([], 2), total: 0, totalPages: 1, limit: 6 }));
    component.selectPage(2);
    expect(component.items).toEqual([]);
    expect(component.page).toBe(2);
    expect(component.totalPages).toBe(1);
    expect(component.pageSize).toBe(6);
    expect(component.pageNumbers).toEqual([1]);
    api.getNews.mockReturnValue(of({ ...feed([], 1), total: 0, totalPages: 1, limit: 6 }));
    component.selectPage(1);
    expect(api.getNews).toHaveBeenLastCalledWith(component.filters, 1, 6, {
      refresh: false,
      revalidate: true,
    });
    component.totalPages = 20;
    component.page = 10;
    expect(component.pageNumbers).toEqual([1, null, 9, 10, 11, null, 20]);
  });
  it('retains usable articles on a failed refresh', () => {
    api.getNews.mockReturnValue(throwError(() => ({ status: 503 })));
    component.forceRefresh();
    expect(component.items).toHaveLength(1);
    expect(component.errorMessage).toContain('temporarily unavailable');
    expect(component.page).toBe(1);
  });
  it('cancels obsolete filters and hides mismatched old articles', () => {
    const old = new Subject<NewsResponse>();
    api.getNews.mockReturnValueOnce(old).mockReturnValueOnce(of(feed([{ ...article, id: 'new' }])));
    component.onFiltersChange({ ...component.filters, search: 'Old' });
    component.onFiltersChange({ ...component.filters, search: 'New' });
    expect(old.observed).toBe(false);
    old.next(feed());
    expect(component.items[0].id).toBe('new');
  });
  it('cancels feed work when selecting a saved view', () => {
    const old = new Subject<NewsResponse>();
    api.getNews.mockReturnValue(old);
    component.forceRefresh();
    component.selectView('bookmarks');
    expect(old.observed).toBe(false);
    expect(component.isLoading).toBe(false);
  });
  it('clears account data and ignores old mutation acknowledgements', () => {
    const pending = new Subject<SavedNewsItem>();
    api.saveNews.mockReturnValue(pending);
    component.toggleSave(article, 'bookmark');
    api.getNews.mockReturnValue(of(feed([])));
    user.next({ _id: 'two' });
    pending.next({ ...saved, type: 'bookmark' });
    expect(component.items).toHaveLength(0);
    expect(component.library.bookmark.size).toBe(0);
    expect(component.pending.size).toBe(0);
  });
  it('waits for acknowledgement and blocks duplicate saves', () => {
    const pending = new Subject<SavedNewsItem>();
    api.saveNews.mockReturnValue(pending);
    component.toggleSave(article, 'bookmark');
    component.toggleSave(article, 'bookmark');
    expect(api.saveNews).toHaveBeenCalledTimes(1);
    expect(component.library.bookmark.size).toBe(0);
    api.getSavedNewsByType.mockReturnValue(
      of({ items: [{ ...saved, type: 'bookmark' }], total: 1, page: 1, hasMore: false }),
    );
    pending.next({ ...saved, type: 'bookmark' });
    pending.complete();
    expect(component.isSaved(article, 'bookmark')).toBe(true);
  });
  it('preserves server timestamps and completed reads in history', () => {
    component.library.read_later.set(saved.id, saved);
    const result = new Subject<SavedNewsItem>();
    api.markSavedNewsAsRead.mockReturnValue(result);
    component.markSavedItemAsRead(saved);
    expect(component.library.read_later.get(saved.id)?.readAt).toBeNull();
    result.next({ ...saved, readAt: '2026-10-22T00:00:00.000Z' });
    result.complete();
    component.selectedView = 'read_later';
    component.historyFilter = 'read';
    expect(component.savedItems).toHaveLength(1);
    expect(component.savedItems[0].readAt).toBe('2026-10-22T00:00:00.000Z');
  });
  it('waits for unread acknowledgement, blocks duplicates and retains past history', () => {
    const first = '2026-10-21T00:00:00.000Z';
    const read = { ...saved, readAt: first, firstReadAt: first, lastReadAt: first, readCount: 1 };
    component.library.read_later.set(read.id, read);
    const result = new Subject<SavedNewsItem>();
    api.markSavedNewsAsRead.mockReturnValue(result);
    component.markSavedItemAsRead(read, false);
    component.markSavedItemAsRead(read, false);
    expect(api.markSavedNewsAsRead).toHaveBeenCalledExactlyOnceWith(read.id, false);
    expect(component.library.read_later.get(read.id)?.readAt).toBe(first);
    const unread = { ...read, readAt: null };
    result.next(unread);
    result.complete();
    component.selectedView = 'read_later';
    component.historyFilter = 'read';
    expect(component.savedItems).toEqual([unread]);
    component.historyFilter = 'unread';
    expect(component.savedItems).toEqual([unread]);
    api.getSavedNewsByType.mockReturnValue(
      of({ items: [unread], total: 1, page: 1, hasMore: false }),
    );
    component.retry();
    expect(component.savedItems).toEqual([unread]);
  });
  it('keeps confirmed read status on failure and reconciles without announcing success', () => {
    const read = {
      ...saved,
      readAt: article.publishedAt,
      firstReadAt: article.publishedAt,
      lastReadAt: article.publishedAt,
      readCount: 1,
    };
    component.library.read_later.set(read.id, read);
    api.markSavedNewsAsRead.mockReturnValue(throwError(() => ({ status: 503 })));
    api.getSavedNewsByType.mockImplementation((type: string) =>
      of({ items: type === 'read_later' ? [read] : [], total: 1, page: 1, hasMore: false }),
    );
    component.markSavedItemAsRead(read, false);
    expect(component.library.read_later.get(read.id)).toEqual(read);
    expect(component.pending.size).toBe(0);
    expect(component.toast).toContain('temporarily unavailable');
  });
  it('retries the failed next page and loads saved pages', () => {
    api.getNews
      .mockReturnValueOnce(throwError(() => ({ status: 0 })))
      .mockReturnValueOnce(of(feed([{ ...article, id: 'two' }], 2)));
    component.selectPage(2);
    expect(component.page).toBe(1);
    component.retry();
    expect(component.page).toBe(2);
    component.selectView('read_later');
    component.savedHasMore.read_later = true;
    component.loadMoreSaved();
    expect(api.getSavedNewsByType).toHaveBeenLastCalledWith('read_later', 2, false);
  });
  it('labels stale and partial source coverage accurately', () => {
    api.getNews.mockReturnValue(
      of({
        ...feed(),
        telemetry: { ...feed().telemetry, freshness: 'stale', providerFailureCount: 1 },
      }),
    );
    component.forceRefresh();
    expect(component.freshnessLabel).toBe('Stale snapshot');
    expect(component.sourceMessage).toContain('temporarily unavailable');
  });
  it('shows zero without an artificial minimum and preserves the tab on reset', () => {
    const card = new NewsCardComponent();
    card.news = article;
    expect(card.scoreWidth).toBe(0);
    const filters = new NewsFiltersComponent();
    filters.filters = { ...component.filters, tab: 'latest' };
    filters.resetFilters();
    expect(filters.draftFilters.tab).toBe('latest');
  });
});

// Recovery must never announce success from a local-only rollback.
describe('News contract templates', () => {
  it('renders numbered pages, boundaries, end-of-cache and recovery from an empty page', () => {
    let shrink = false;
    const api = {
      invalidated$: new Subject(),
      clearCache: vi.fn(),
      retryAt: () => 0,
      getNews: vi.fn((_filters: unknown, page: number) =>
        of({
          ...feed(shrink ? [] : [{ ...article, id: String(page) }], page),
          total: shrink ? 0 : 3,
          totalPages: shrink ? 1 : 3,
        }),
      ),
      getSavedNewsByType: () => of({ items: [], total: 0, page: 1, hasMore: false }),
    };
    TestBed.configureTestingModule({
      imports: [NewsComponent],
      providers: [
        { provide: NewsService, useValue: api },
        {
          provide: CareerProfileService,
          useValue: { careerProfile$: new BehaviorSubject({ careerStack: 'Frontend' }) },
        },
        { provide: AuthService, useValue: { currentUser$: new BehaviorSubject({ _id: 'one' }) } },
      ],
    });
    const fixture = TestBed.createComponent(NewsComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const nav = () => root.querySelector('nav[aria-label="News pages"]')!;
    const button = (text: string) =>
      [...nav().querySelectorAll('button')].find((item) => item.textContent!.trim() === text)!;
    expect(button('Previous').disabled).toBe(true);
    expect(button('1').getAttribute('aria-current')).toBe('page');
    expect(button('2').getAttribute('aria-label')).toBe('Go to page 2');
    button('Next').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page).toBe(2);
    expect(root.querySelectorAll('app-news-card')).toHaveLength(1);
    button('3').click();
    fixture.detectChanges();
    expect(button('Next').disabled).toBe(true);
    expect(root.querySelector('.end-of-results')!.textContent).toContain('End of cached results');
    button('Previous').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page).toBe(2);
    expect(root.querySelector('.end-of-results')).toBeNull();
    shrink = true;
    button('3').click();
    fixture.detectChanges();
    expect(root.textContent).toContain('This page is no longer available');
    expect(root.querySelectorAll('app-news-card')).toHaveLength(0);
    expect(button('Next').disabled).toBe(true);
    button('Previous').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page).toBe(1);
    expect(root.textContent).toContain('No articles found');
    fixture.destroy();
  });
  it('renders five honest evidence labels in context and articles, and acknowledges read/unread controls', () => {
    const statuses: NewsSkillEvidenceStatus[] = [
      'DEMONSTRATED',
      'PARTIAL',
      'CLAIMED_ONLY',
      'NOT_EVIDENCED',
      'UNKNOWN',
    ];
    const evidence = statuses.map((status) => ({
      name: `Skill ${status}`,
      canonicalName: null,
      status,
      evidenceConfidence: 'INSUFFICIENT' as const,
      evidence: [],
    }));
    const first = '2026-10-21T00:00:00.000Z';
    const later = '2026-10-22T00:00:00.000Z';
    let record: SavedNewsItem = {
      ...saved,
      readAt: first,
      firstReadAt: first,
      lastReadAt: first,
      readCount: 1,
    };
    let pending = new Subject<SavedNewsItem>();
    const api = {
      invalidated$: new Subject(),
      clearCache: vi.fn(),
      retryAt: () => 0,
      getNews: () =>
        of({
          ...feed([{ ...article, relatedSkillEvidence: evidence }]),
          recommendedBasedOn: {
            careerStack: 'Frontend',
            detectedSkills: ['React'],
            skillGaps: ['Rust'],
            skillEvidence: evidence,
            summary: 'Source context',
          },
        }),
      getSavedNewsByType: (type: string) =>
        of({ items: type === 'read_later' ? [record] : [], total: 1, page: 1, hasMore: false }),
      markSavedNewsAsRead: vi.fn(() => pending),
    };
    TestBed.configureTestingModule({
      imports: [NewsComponent],
      providers: [
        { provide: NewsService, useValue: api },
        {
          provide: CareerProfileService,
          useValue: { careerProfile$: new BehaviorSubject({ careerStack: 'Frontend' }) },
        },
        { provide: AuthService, useValue: { currentUser$: new BehaviorSubject({ _id: 'one' }) } },
      ],
    });
    const fixture = TestBed.createComponent(NewsComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const labels = [
      'Demonstrated implementation',
      'Partial evidence · technical metadata only',
      'Claimed only · not demonstrated',
      'Not evidenced · does not imply inability',
      'Unknown · insufficient evidence',
    ];
    for (const selector of ['.context-body', 'app-news-card']) {
      const text = root.querySelector(selector)!.textContent!;
      for (const label of labels) expect(text).toContain(label);
      expect(text).not.toContain('verified skill');
    }
    fixture.componentInstance.selectView('read_later');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const button = (text: string) =>
      [...root.querySelectorAll('button')].find((item) => item.textContent!.trim() === text)!;
    button('Mark unread').click();
    fixture.detectChanges();
    expect(api.markSavedNewsAsRead).toHaveBeenLastCalledWith(record.id, false);
    expect(root.querySelector('.read-status')!.textContent).toBe('Read');
    expect(button('Updating…').disabled).toBe(true);
    record = { ...record, readAt: null };
    pending.next(record);
    pending.complete();
    fixture.detectChanges();
    expect(root.querySelector('.read-status')!.textContent).toBe('Unread');
    expect(root.querySelector('.saved-dates')!.textContent).toContain('Completed reads: 1');
    expect(root.querySelector('.saved-dates')!.textContent).toContain('First read');
    expect(root.querySelector('.saved-dates')!.textContent).toContain('Last read');
    pending = new Subject();
    button('Mark read').click();
    fixture.detectChanges();
    expect(api.markSavedNewsAsRead).toHaveBeenLastCalledWith(record.id, true);
    record = { ...record, readAt: later, lastReadAt: later, readCount: 2 };
    pending.next(record);
    pending.complete();
    fixture.detectChanges();
    expect(button('Mark unread')).toBeDefined();
    expect(root.querySelector('.saved-dates')!.textContent).toContain('Completed reads: 2');
    expect(fixture.componentInstance.savedItems[0].firstReadAt).toBe(first);
    fixture.destroy();
    const reloaded = TestBed.createComponent(NewsComponent);
    reloaded.detectChanges();
    reloaded.componentInstance.selectView('read_later');
    reloaded.changeDetectorRef.markForCheck();
    reloaded.detectChanges();
    expect(reloaded.componentInstance.savedItems[0]).toEqual(record);
    expect(reloaded.nativeElement.querySelector('.read-status').textContent).toBe('Read');
    reloaded.destroy();
  });
});

describe('News saved error recovery', () => {
  it('keeps the server-confirmed record when removal fails', () => {
    const api = {
      invalidated$: new Subject(),
      clearCache: vi.fn(),
      retryAt: () => 0,
      getNews: () => of(feed()),
      getSavedNewsByType: (type: string) =>
        of({ items: type === 'read_later' ? [saved] : [], total: 1, page: 1, hasMore: false }),
      removeSavedNews: () => throwError(() => ({ status: 503 })),
    };
    const component = new NewsComponent(
      api as unknown as NewsService,
      {
        careerProfile$: new BehaviorSubject({ careerStack: 'Frontend' }),
      } as unknown as CareerProfileService,
      { currentUser$: new BehaviorSubject({ _id: 'one' }) } as unknown as AuthService,
      { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.ngOnInit();
    component.removeSavedItem(saved);
    expect(component.library.read_later.has(saved.id)).toBe(true);
    expect(component.toast).toContain('temporarily unavailable');
    component.ngOnDestroy();
  });
});
