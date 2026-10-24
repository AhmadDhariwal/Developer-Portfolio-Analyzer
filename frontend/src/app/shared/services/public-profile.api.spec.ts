import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { MaintenanceModeService } from './maintenance-mode.service';
import { ProfileService } from './profile.service';
import { CareerProfileService } from './career-profile.service';
import { authInterceptor } from '../../interceptors/auth.interceptor';

describe('Portfolio HTTP contracts', () => {
  let http: HttpTestingController;
  let api: ApiService;
  const auth = { isLoggedIn: vi.fn(() => false), logout: vi.fn() };
  beforeEach(() => {
    localStorage.clear();
    auth.isLoggedIn.mockReturnValue(false);
    auth.logout.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        ApiService,
        { provide: AuthService, useValue: auth },
        { provide: MaintenanceModeService, useValue: { open: vi.fn() } },
        { provide: FrontendAnalysisCacheService, useValue: {} },
        { provide: FrontendCacheInvalidationService, useValue: { register: vi.fn() } },
      ],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    localStorage.clear();
  });
  it('permits anonymous public reads and PDF downloads without triggering login redirects', () => {
    api.getPublicProfile('maya-chen').subscribe();
    const read = http.expectOne((request) => request.url.includes('/public-profiles/maya-chen?'));
    expect(read.request.headers.has('Authorization')).toBe(false);
    expect(read.request.headers.has('X-Skip-Auth')).toBe(false);
    read.flush({});
    api.downloadPortfolioResume('maya-chen').subscribe();
    const file = http.expectOne((request) =>
      request.url.endsWith('/public-profiles/maya-chen/resume'),
    );
    expect(file.request.responseType).toBe('blob');
    file.flush(new Blob(['PDF']));
    expect(auth.logout).not.toHaveBeenCalled();
  });
  it('keeps preview, owner download, upload and contact authenticated', () => {
    auth.isLoggedIn.mockReturnValue(true);
    localStorage.setItem('token', 'fixture-token');
    api.getPublicProfile('maya-chen', '1').subscribe();
    api.downloadPortfolioResume('me').subscribe();
    const body = new FormData();
    body.append('image', new Blob(['PNG'], { type: 'image/png' }), 'cover.png');
    api.uploadPortfolioImage(body).subscribe();
    api
      .contactPublicPortfolio('maya-chen', { message: 'A sufficiently long enquiry.', website: '' })
      .subscribe();
    const requests = http.match((request) => request.url.includes('/public-profiles/'));
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(request.request.headers.get('Authorization')).toBe('Bearer fixture-token');
      request.flush(
        request.request.responseType === 'blob'
          ? new Blob(['PDF'])
          : { sent: true, imageUrl: '/uploads/portfolio-images/cover.png' },
      );
    }
    expect(
      requests.find((request) => request.request.url.endsWith('/project-image'))?.request.body,
    ).toBe(body);
  });
  it('invalidates portfolio state after account privacy is acknowledged', () => {
    const clear = vi.fn();
    const service = new ProfileService(
      { put: () => of({ isPublic: false }) } as unknown as HttpClient,
      {} as AuthService,
      {} as CareerProfileService,
      {} as FrontendAnalysisCacheService,
      {
        register: vi.fn(),
        clearPublicPortfolioCaches: clear,
      } as unknown as FrontendCacheInvalidationService,
    );
    vi.spyOn(
      service as unknown as { mergeProfileUpdate(value: unknown): void },
      'mergeProfileUpdate',
    ).mockImplementation(() => {});
    service.updateVisibility(false).subscribe();
    expect(clear).toHaveBeenCalledOnce();
  });
});
