import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { PublicPortfolioComponent } from './public-portfolio.component';
import {
  PublicProfilePayload,
  PublicProfileService,
} from '../../shared/services/public-profile.service';
import { AuthService, SessionUser } from '../../shared/services/auth.service';
import { ThemeService } from '../../shared/services/theme.service';
import { portfolioFixture } from './testing/portfolio.fixture';

describe('Public portfolio lifecycle', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let user: BehaviorSubject<SessionUser | null>;
  let response: Subject<PublicProfilePayload>;
  let service: {
    getPublicProfile: ReturnType<typeof vi.fn>;
    invalidated$: Subject<void>;
    contact: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({ slug: 'maya-chen' }));
    query = new BehaviorSubject(convertToParamMap({}));
    user = new BehaviorSubject<SessionUser | null>(null);
    response = new Subject();
    service = {
      getPublicProfile: vi.fn(() => response),
      invalidated$: new Subject(),
      contact: vi.fn(() => of({ sent: true })),
    };
    TestBed.configureTestingModule({
      imports: [PublicPortfolioComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params, queryParamMap: query } },
        {
          provide: AuthService,
          useValue: {
            currentUser$: user,
            getCurrentUser: () => user.value,
            isLoggedIn: () => !!user.value,
          },
        },
        { provide: PublicProfileService, useValue: service },
        { provide: ThemeService, useValue: { preference: () => 'light', setTheme: vi.fn() } },
      ],
    });
  });
  it('clears old content immediately and rejects late responses on slug changes', () => {
    const fixture = TestBed.createComponent(PublicPortfolioComponent);
    fixture.detectChanges();
    const old = response;
    response = new Subject();
    params.next(convertToParamMap({ slug: 'renamed' }));
    old.next(portfolioFixture());
    expect(fixture.componentInstance.profile).toBeNull();
    response.next(portfolioFixture({ slug: 'renamed' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.profile?.slug).toBe('renamed');
    service.invalidated$.next();
    expect(fixture.componentInstance.profile).toBeNull();
    // The first detectChanges on this large standalone component can exceed the
    // 5s default when the full suite runs all files in parallel; the test itself
    // is synchronous. Allow headroom so parallel scheduling jitter is not a false failure.
  }, 20000);
  it('renders truthful 404/503 states without stale private data', () => {
    const fixture = TestBed.createComponent(PublicPortfolioComponent);
    fixture.detectChanges();
    response.error({ status: 404 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing public here yet');
    expect(fixture.componentInstance.profile).toBeNull();
    response = new Subject();
    fixture.componentInstance.retry();
    response.error({ status: 503 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Temporarily unavailable');
  });
  it('isolates preview SEO and hides private contact, analytics, hidden sections and delivery', () => {
    query.next(convertToParamMap({ preview: '1' }));
    const fixture = TestBed.createComponent(PublicPortfolioComponent);
    fixture.detectChanges();
    const profile = portfolioFixture({
      isPublic: false,
      email: 'secret@example.com',
      analytics: { totalViews: 99, uniqueViews: 1, lastViewedAt: null },
    });
    profile.sections.visibility.projects = false;
    response.next(profile);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('secret@example.com');
    expect(fixture.nativeElement.querySelector('#projects')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
    expect(document.querySelector('meta[property="og:title"]')).toBeNull();
    expect(fixture.componentInstance.canContact).toBe(false);
  });
  it('permits only eligible recruiter contact and acknowledges only server success', () => {
    user.next({ _id: 'recruiter', role: 'recruiter', isVerified: true });
    const fixture = TestBed.createComponent(PublicPortfolioComponent);
    fixture.detectChanges();
    response.next(portfolioFixture());
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.contactMessage = 'Interested in your engineering work and availability.';
    component.sendContact();
    expect(component.contactSent).toBe(true);
    expect(service.contact).toHaveBeenCalledTimes(1);
    user.next({ _id: 'developer', role: 'developer' });
    expect(component.profile).toBeNull();
    expect(component.canContact).toBe(false);
    expect(component.contactSent).toBe(false);
  });
  it('does not turn zero proficiency or absent analytics into visible invented metrics', () => {
    const fixture = TestBed.createComponent(PublicPortfolioComponent);
    fixture.detectChanges();
    response.next(portfolioFixture());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('mastery');
    expect(fixture.nativeElement.textContent).not.toContain('99%');
    expect(fixture.nativeElement.textContent).toContain('Listed by the portfolio owner');
  });
  it('lets the server decide verification when the established sign-in payload omits those flags', () => {
    user.next({ _id: 'recruiter', role: 'recruiter' });
    const fixture = TestBed.createComponent(PublicPortfolioComponent);
    fixture.detectChanges();
    response.next(portfolioFixture());
    expect(fixture.componentInstance.canContact).toBe(true);
    user.next({ _id: 'recruiter', role: 'recruiter', isVerified: false, emailVerified: false });
    expect(fixture.componentInstance.canContact).toBe(false);
  });
});
