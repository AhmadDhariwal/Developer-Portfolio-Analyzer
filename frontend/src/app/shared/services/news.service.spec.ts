import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { NewsService } from './news.service';
import { DEFAULT_NEWS_FILTERS } from '../models/news.model';
import { safeNewsUrl, retryDeadline } from '../utils/news-presentation';
const article = {
  id: 'article',
  title: 'Engineering update',
  url: 'https://example.com/article',
  source: 'Dev.to',
  publishedAt: new Date().toISOString(),
};
const response = { items: [article], total: 1, page: 1, totalPages: 1, hasMore: false };
describe('NewsService bounded account-scoped requests', () => {
  let service: NewsService;
  let http: HttpTestingController;
  let user: BehaviorSubject<{ _id: string }>;
  beforeEach(() => {
    user = new BehaviorSubject({ _id: 'one' });
    TestBed.configureTestingModule({
      providers: [
        NewsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value },
        },
        { provide: FrontendCacheInvalidationService, useValue: { register: vi.fn() } },
      ],
    });
    service = TestBed.inject(NewsService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    vi.restoreAllMocks();
  });
  const feed = (request: { url: string }) => request.url.endsWith('/news');
  it('keeps Explore independent, shares identical reads, and separates personalized cache entries', () => {
    let result: any;
    const filters = { ...DEFAULT_NEWS_FILTERS, mode: 'explore' as const, search: 'CI/CD updates' };
    service.getNews(filters).subscribe((value) => (result = value));
    service.getNews(filters).subscribe();
    const request = http.expectOne(feed);
    expect(request.request.params.get('mode')).toBe('explore');
    expect(request.request.params.get('search')).toBe('CI/CD updates');
    expect(request.request.params.has('refresh')).toBe(false);
    request.flush({
      ...response,
      mode: 'explore',
      recommendedBasedOn: null,
      coverage: { status: 'coverage_gap', topic: 'cicd', cachedMatches: 1, minimum: 6 },
      enrichment: { status: 'queued', reason: 'background_discovery', nextEligibleAt: null },
      items: [
        {
          ...article,
          rankScore: null,
          relevanceScore: null,
          license: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        },
      ],
    });
    expect(result.recommendedBasedOn).toBeNull();
    expect(result.items[0].rankScore).toBeNull();
    expect(result.items[0].license).toBe('CC BY 4.0');
    expect(result.enrichment.status).toBe('queued');
    service.getNews({ ...filters, mode: 'personalized' }).subscribe();
    const personalized = http.expectOne(feed);
    expect(personalized.request.params.get('mode')).toBe('personalized');
    personalized.flush(response);
  });
  it('forwards all supported topics and unknown queries without a client taxonomy gate', () => {
    const topics =
      'javascript typescript react angular vue node python rust golang docker kubernetes devops cicd cloud aws azure gcp terraform gitops argocd ansible observability linux security devsecops ai ml llm pytorch tensorflow sql postgres redis mongodb kafka java dotnet gitlab githubactions webassembly'.split(
        ' ',
      );
    for (const search of [...topics, 'CI/CD', 'Amazon Web Services', 'unknown technology']) {
      service.getNews({ ...DEFAULT_NEWS_FILTERS, mode: 'explore', search }, 2).subscribe();
      const request = http.expectOne(feed);
      expect(request.request.params.get('search')).toBe(search);
      expect(request.request.params.get('page')).toBe('2');
      expect(request.request.params.has('refresh')).toBe(false);
      request.flush({ ...response, page: 2 });
    }
  });
  it('cancels Explore transport on account changes and revalidates without refresh or unsafe license links', () => {
    const filters = { ...DEFAULT_NEWS_FILTERS, mode: 'explore' as const };
    service.getNews(filters).subscribe();
    const old = http.expectOne(feed);
    user.next({ _id: 'two' });
    expect(old.cancelled).toBe(true);
    let result: any;
    service.getNews(filters, 1, 12, { revalidate: true }).subscribe((value) => (result = value));
    const request = http.expectOne(feed);
    expect(request.request.params.has('refresh')).toBe(false);
    request.flush({ ...response, items: [{ ...article, licenseUrl: 'javascript:alert(1)' }] });
    expect(result.items[0].licenseUrl).toBe('');
  });
  it('round trips read, unread and re-read using explicit booleans and server history', () => {
    const first = '2026-10-21T00:00:00.000Z';
    const latest = '2026-10-22T00:00:00.000Z';
    let value: any;
    const saved = {
      ...article,
      id: 'saved',
      articleId: article.id,
      type: 'read_later',
      createdAt: first,
    };
    for (const [read, stamp, count] of [
      [true, first, 1],
      [false, first, 1],
      [true, latest, 2],
    ] as const) {
      service.markSavedNewsAsRead('saved', read).subscribe((item) => (value = item));
      const request = http.expectOne((r) => r.method === 'PATCH');
      expect(request.request.url).toMatch(/\/save\/saved\/read$/);
      expect(request.request.body).toEqual({ read });
      request.flush({
        item: {
          ...saved,
          readAt: read ? stamp : null,
          firstReadAt: first,
          lastReadAt: stamp,
          readCount: count,
        },
      });
      expect(value).toMatchObject({
        readAt: read ? stamp : null,
        firstReadAt: first,
        lastReadAt: stamp,
        readCount: count,
      });
      service
        .getSavedNewsByType('read_later')
        .subscribe((result) => expect(result.items[0]).toEqual(value));
      http.expectOne((r) => r.url.endsWith('/saved')).flush({ items: [value], total: 1, page: 1 });
    }
  });
  it('rejects an opposite-state acknowledgement and propagates read failures', () => {
    const error = vi.fn();
    service.markSavedNewsAsRead('saved', false).subscribe({ error });
    http
      .expectOne((r) => r.method === 'PATCH')
      .flush({
        item: {
          ...article,
          id: 'saved',
          articleId: article.id,
          type: 'read_later',
          readAt: article.publishedAt,
        },
      });
    expect(error).toHaveBeenCalledTimes(1);
    service.markSavedNewsAsRead('saved', false).subscribe({ error });
    http.expectOne((r) => r.method === 'PATCH').flush({}, { status: 404, statusText: 'Not found' });
    expect(error).toHaveBeenCalledTimes(2);
  });
  it('consumes both evidence projections without promoting unsupported classifications', () => {
    let value: any;
    const evidence = [
      'DEMONSTRATED',
      'PARTIAL',
      'CLAIMED_ONLY',
      'NOT_EVIDENCED',
      'UNKNOWN',
      'VERIFIED',
    ].map((status) => ({ name: status, status, evidence: [] }));
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe((result) => (value = result));
    http.expectOne(feed).flush({
      ...response,
      recommendedBasedOn: {
        skillEvidence: evidence,
        skillEvidenceRuleVersion: 'skill-evidence-coverage-v1',
      },
      items: [{ ...article, relatedSkillEvidence: evidence }],
    });
    expect(value.recommendedBasedOn.skillEvidence.map((skill: any) => skill.status)).toEqual([
      'DEMONSTRATED',
      'PARTIAL',
      'CLAIMED_ONLY',
      'NOT_EVIDENCED',
      'UNKNOWN',
      'UNKNOWN',
    ]);
    expect(value.items[0].relatedSkillEvidence).toEqual(value.recommendedBasedOn.skillEvidence);
    expect(value.recommendedBasedOn.skillEvidenceRuleVersion).toBe('skill-evidence-coverage-v1');
  });
  it('deduplicates reads and reuses results for only fifteen seconds', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    http.expectOne(feed).flush(response);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    http.expectNone(feed);
    clock.mockReturnValue(116000);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    http.expectOne(feed).flush(response);
  });
  it('aborts HTTP when the last subscriber leaves', () => {
    const subscription = service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    const request = http.expectOne(feed);
    subscription.unsubscribe();
    expect(request.cancelled).toBe(true);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    http.expectOne(feed).flush(response);
  });
  it('keeps shared work until every consumer unsubscribes', () => {
    const a = service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    const b = service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    const request = http.expectOne(feed);
    a.unsubscribe();
    expect(request.cancelled).toBe(false);
    b.unsubscribe();
    expect(request.cancelled).toBe(true);
  });
  it('cancels previous-account requests and isolates their cache', () => {
    const received = vi.fn();
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe(received);
    const request = http.expectOne(feed);
    user.next({ _id: 'two' });
    expect(request.cancelled).toBe(true);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    http.expectOne(feed).flush(response);
    expect(received).not.toHaveBeenCalled();
  });
  it('uses a refresh flag only on explicit refresh', () => {
    service.getNews({ ...DEFAULT_NEWS_FILTERS, search: 'React' }, 2).subscribe();
    const request = http.expectOne(feed);
    expect(request.request.params.get('refresh')).toBeNull();
    expect(request.request.params.get('page')).toBe('2');
    request.flush(response);
    service.getNews(DEFAULT_NEWS_FILTERS, 1, 12, { refresh: true }).subscribe();
    const refresh = http.expectOne(feed);
    expect(refresh.request.params.get('refresh')).toBe('true');
    refresh.flush(response);
  });
  it('keeps missing scores unknown and sanitizes unsafe metadata', () => {
    let value: any;
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe((result) => (value = result));
    http.expectOne(feed).flush({
      ...response,
      items: [
        {
          ...article,
          relevanceScore: 90,
          rankScore: null,
          popularity: null,
          attributionUrl: 'javascript:bad',
          image: 'http://127.0.0.1/image',
          publishedAt: 'bad',
        },
        { ...article, id: 'bad', url: 'javascript:bad' },
      ],
    });
    expect(value.items).toHaveLength(1);
    expect(value.items[0].rankScore).toBeNull();
    expect(value.items[0].popularity).toBeNull();
    expect(value.items[0].attributionUrl).toBe(article.url);
    expect(value.items[0].publishedAt).toBe('');
  });
  it('honors Retry-After without automatic retries', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100000);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe({ error: () => {} });
    http
      .expectOne(feed)
      .flush({}, { status: 429, statusText: 'Limited', headers: { 'Retry-After': '60' } });
    expect(service.retryAt('feed')).toBe(160000);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe({ error: () => {} });
    http.expectNone(feed);
    clock.mockReturnValue(160001);
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe();
    http.expectOne(feed).flush(response);
  });
  it('supports saved pagination and rejects incomplete mutation acknowledgement', () => {
    service.getSavedNewsByType('read_later', 2).subscribe();
    const request = http.expectOne((r) => r.url.endsWith('/saved'));
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('limit')).toBe('50');
    request.flush({ items: [], total: 51, page: 2 });
    const error = vi.fn();
    service.markSavedNewsAsRead('saved').subscribe({ error });
    http.expectOne((r) => r.method === 'PATCH').flush({});
    expect(error).toHaveBeenCalled();
  });
  it('rejects local/credential URLs and parses both retry formats', () => {
    for (const url of [
      'https://user:pass@example.com',
      'http://127.0.0.1/a',
      'http://[::1]/a',
      'http://example.local/a',
    ])
      expect(safeNewsUrl(url)).toBe('');
    expect(retryDeadline('120', 1000)).toBe(121000);
    expect(retryDeadline('Thu, 01 Jan 1970 00:02:00 GMT', 0)).toBe(120000);
  });
});

describe('News request backoff across refresh and browse', () => {
  it('does not bypass a 503 Retry-After by dropping the refresh flag', () => {
    const user = new BehaviorSubject({ _id: 'owner' });
    TestBed.configureTestingModule({
      providers: [
        NewsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value },
        },
        { provide: FrontendCacheInvalidationService, useValue: { register: vi.fn() } },
      ],
    });
    const service = TestBed.inject(NewsService),
      http = TestBed.inject(HttpTestingController);
    service.getNews(DEFAULT_NEWS_FILTERS, 1, 12, { refresh: true }).subscribe({ error: () => {} });
    http
      .expectOne((r) => r.url.endsWith('/news'))
      .flush({}, { status: 503, statusText: 'Unavailable', headers: { 'Retry-After': '60' } });
    service.getNews(DEFAULT_NEWS_FILTERS).subscribe({ error: () => {} });
    http.expectNone((r) => r.url.endsWith('/news'));
    http.verify();
  });
});
