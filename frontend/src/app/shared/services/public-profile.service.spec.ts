import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { PublicProfileService, PublicProfilePayload } from './public-profile.service';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { portfolioFixture } from '../../pages/public-portfolio/testing/portfolio.fixture';

describe('Public portfolio request boundaries', () => {
  let service: PublicProfileService;
  let response: Subject<PublicProfilePayload>;
  let account: BehaviorSubject<{ _id: string } | null>;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let invalidation: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    response = new Subject();
    account = new BehaviorSubject<{ _id: string } | null>(null);
    api = {
      getPublicProfile: vi.fn(() => response),
      getMyPublicProfile: vi.fn(() => response),
      updateMyPublicProfile: vi.fn(() => of(portfolioFixture())),
      getPublicProfileAnalytics: vi.fn(),
      uploadPortfolioImage: vi.fn(),
      contactPublicPortfolio: vi.fn(),
      downloadPortfolioResume: vi.fn(),
    };
    invalidation = {
      register: vi.fn(),
      clearPublicPortfolioCaches: vi.fn(),
      clearDashboardCaches: vi.fn(),
      clearScenarioCaches: vi.fn(),
      clearWeeklyReportCaches: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        PublicProfileService,
        { provide: ApiService, useValue: api },
        {
          provide: AuthService,
          useValue: { currentUser$: account, isLoggedIn: () => !!account.value },
        },
        { provide: FrontendCacheInvalidationService, useValue: invalidation },
      ],
    });
    service = TestBed.inject(PublicProfileService);
  });
  afterEach(() => TestBed.resetTestingModule());
  it('deduplicates only concurrent public requests and never retains completed results', () => {
    const one = vi.fn(),
      two = vi.fn();
    service.getPublicProfile('maya-chen').subscribe(one);
    service.getPublicProfile('maya-chen').subscribe(two);
    expect(api['getPublicProfile']).toHaveBeenCalledTimes(1);
    response.next(portfolioFixture());
    response.complete();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
    response = new Subject();
    service.getPublicProfile('maya-chen').subscribe();
    expect(api['getPublicProfile']).toHaveBeenCalledTimes(2);
  });
  it('isolates each owner preview from all shared request state', () => {
    service.getPublicProfile('maya-chen', { queryParams: { preview: '1' } }).subscribe();
    service.getPublicProfile('maya-chen', { queryParams: { preview: '1' } }).subscribe();
    service.getPublicProfile('maya-chen').subscribe();
    expect(api['getPublicProfile']).toHaveBeenCalledTimes(3);
  });
  it('cannot turn an unpublish 404 or provider 503 into stale success', () => {
    const errors = vi.fn();
    service.getPublicProfile('maya-chen').subscribe({ error: errors });
    response.error({ status: 404 });
    expect(errors).toHaveBeenCalledWith({ status: 404 });
    response = new Subject();
    service.getPublicProfile('maya-chen').subscribe({ error: errors });
    response.error({ status: 503 });
    expect(errors).toHaveBeenCalledTimes(2);
  });
  it('cancels prior account/public reads and ignores late values after invalidation', () => {
    const received = vi.fn();
    service.getPublicProfile('maya-chen').subscribe(received);
    account.next({ _id: 'different-owner' });
    response.next(portfolioFixture());
    expect(received).not.toHaveBeenCalled();
    response = new Subject();
    service.getPublicProfile('maya-chen').subscribe(received);
    service.clearCache();
    response.next(portfolioFixture());
    expect(received).not.toHaveBeenCalled();
  });
  it('bounds concurrent slug entries to 25', () => {
    for (let i = 0; i < 25; i++) service.getPublicProfile(`slug-${i}`).subscribe();
    const error = vi.fn();
    service.getPublicProfile('overflow').subscribe({ error });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
  });
  it('clears portfolio and downstream signals when the server acknowledges edits', () => {
    service.updateMyPublicProfile({ isPublic: false }).subscribe();
    expect(invalidation['clearPublicPortfolioCaches']).toHaveBeenCalledOnce();
    expect(invalidation['clearDashboardCaches']).toHaveBeenCalledOnce();
    expect(invalidation['clearScenarioCaches']).toHaveBeenCalledOnce();
  });
});
