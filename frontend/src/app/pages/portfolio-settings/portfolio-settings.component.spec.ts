import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { PortfolioSettingsComponent } from './portfolio-settings.component';
import {
  PublicProfilePayload,
  PublicProfileService,
} from '../../shared/services/public-profile.service';
import { AuthService, SessionUser } from '../../shared/services/auth.service';
import { ThemeService } from '../../shared/services/theme.service';
import { portfolioFixture } from '../public-portfolio/testing/portfolio.fixture';

describe('Portfolio settings owner state', () => {
  let user: BehaviorSubject<SessionUser | null>;
  let read: Subject<PublicProfilePayload>;
  let save: Subject<PublicProfilePayload>;
  let upload: Subject<{ imageUrl: string }>;
  let analytics: Subject<unknown>;
  let service: Record<string, any>;
  beforeEach(() => {
    user = new BehaviorSubject<SessionUser | null>({ _id: 'owner' });
    read = new Subject();
    save = new Subject();
    upload = new Subject();
    analytics = new Subject();
    service = {
      getMyPublicProfile: vi.fn(() => read),
      updateMyPublicProfile: vi.fn(() => save),
      getAnalytics: vi.fn(() => analytics),
      uploadImage: vi.fn(() => upload),
      invalidated$: new Subject<void>(),
      sessionChanged$: new Subject<void>(),
    };
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:portfolio-test'),
        revokeObjectURL: vi.fn(),
      }),
    );
    TestBed.configureTestingModule({
      imports: [PortfolioSettingsComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { currentUser$: user, getCurrentUser: () => user.value },
        },
        { provide: PublicProfileService, useValue: service },
        { provide: ThemeService, useValue: { preference: () => 'light', setTheme: vi.fn() } },
      ],
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  function setup() {
    const fixture = TestBed.createComponent(PortfolioSettingsComponent);
    fixture.detectChanges();
    read.next(portfolioFixture());
    fixture.detectChanges();
    return fixture;
  }
  it('distinguishes unavailable analytics from genuine zero views', () => {
    const fixture = setup();
    analytics.error({ status: 503 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Temporarily unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('No recorded views yet');
    analytics = new Subject();
    fixture.componentInstance.loadAnalytics();
    analytics.next({ totalViews: 0, uniqueViews: 0, lastViewedAt: null, last7Days: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No recorded views yet');
    expect(fixture.nativeElement.textContent).not.toContain('Retention');
  });
  it('keeps published URL/status server-authoritative until save acknowledgement', () => {
    const fixture = setup();
    const component = fixture.componentInstance;
    component.profile!.slug = 'new-slug';
    component.profile!.isPublic = false;
    expect(component.shareUrl).toContain('maya-chen');
    expect(component.published).toBe(true);
    component.saveProfile();
    expect(component.isSaving).toBe(true);
    save.next(portfolioFixture({ slug: 'new-slug', isPublic: false }));
    fixture.detectChanges();
    expect(component.shareUrl).toContain('new-slug');
    expect(component.published).toBe(false);
    expect(component.message).toContain('saved');
  });
  it('drops previous-owner data and late read/save responses after account switching', () => {
    const fixture = setup();
    const old = read;
    read = new Subject();
    user.next({ _id: 'other' });
    expect(fixture.componentInstance.profile).toBeNull();
    old.next(portfolioFixture({ headline: 'Old owner' }));
    expect(fixture.componentInstance.profile).toBeNull();
    read.next(portfolioFixture({ headline: 'Other owner' }));
    expect(fixture.componentInstance.profile?.headline).toBe('Other owner');
  });
  it('validates uploads locally, presents server errors and applies only accepted image addresses', () => {
    const fixture = setup();
    const component = fixture.componentInstance;
    const project = component.profile!.projects[0];
    const event = (file: File) =>
      ({ target: { files: [file], value: 'selected' } }) as unknown as Event;
    component.uploadProjectImage(
      event(new File(['<svg>'], 'bad.svg', { type: 'image/svg+xml' })),
      project,
    );
    expect(service['uploadImage']).not.toHaveBeenCalled();
    expect(component.uploadState(project)?.error).toContain('2 MiB');
    component.uploadProjectImage(
      event(new File(['PNG'], 'cover.png', { type: 'image/png' })),
      project,
    );
    expect(component.uploading).toBe(true);
    upload.error({ status: 503 });
    expect(component.uploadState(project)?.error).toContain('unavailable');
    expect(project.imageUrl).toBeUndefined();
    upload = new Subject();
    component.uploadProjectImage(
      event(new File(['PNG'], 'cover.png', { type: 'image/png' })),
      project,
    );
    upload.next({ imageUrl: '/uploads/portfolio-images/owner-cover.png' });
    expect(project.imageUrl).toBe('/uploads/portfolio-images/owner-cover.png');
    expect(component.uploading).toBe(false);
  });
  it('preserves unsaved edits but blocks stale saves/previews after external invalidation', () => {
    const fixture = setup();
    fixture.componentInstance.profile!.headline = 'Unsaved edit';
    service['invalidated$'].next();
    expect(fixture.componentInstance.needsReload).toBe(true);
    expect(fixture.componentInstance.published).toBe(false);
    fixture.componentInstance.saveProfile();
    expect(service['updateMyPublicProfile']).not.toHaveBeenCalled();
  });
  it('creates blank owner-authored entries without invented testimonial or proficiency data', () => {
    const fixture = setup();
    fixture.componentInstance.addSkill();
    fixture.componentInstance.addTestimonial();
    expect(fixture.componentInstance.profile!.skills.at(-1)?.score).toBe(0);
    expect(fixture.componentInstance.profile!.testimonials.at(-1)?.quote).toBe('');
    fixture.componentInstance.saveProfile();
    expect(service['updateMyPublicProfile']).not.toHaveBeenCalled();
    expect(fixture.componentInstance.messageIsError).toBe(true);
  });
  it('labels UTC calendar days correctly and gives zero views a zero-height bar', () => {
    const fixture = setup();
    analytics.next({
      totalViews: 0,
      uniqueViews: 0,
      lastViewedAt: null,
      last7Days: [{ date: '2026-10-20', count: 0 }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.step-label').textContent.trim()).toBe('Tue');
    expect(fixture.nativeElement.querySelector('.step-bar').style.height).toBe('0%');
  });
  it('removes private owner state immediately when a cross-tab session changes', () => {
    const fixture = setup();
    fixture.componentInstance.profile!.headline = 'Unsaved private data';
    service['sessionChanged$'].next();
    service['invalidated$'].next();
    expect(fixture.componentInstance.profile).toBeNull();
    expect(fixture.componentInstance.analytics).toBeNull();
    expect(fixture.componentInstance.errorMessage).toContain('session changed');
    fixture.componentInstance.saveProfile();
    expect(service['updateMyPublicProfile']).not.toHaveBeenCalled();
  });
  it('rejects a reserved slug before issuing a save', () => {
    const fixture = setup();
    fixture.componentInstance.profile!.slug = 'me';
    fixture.componentInstance.saveProfile();
    expect(fixture.componentInstance.message).toContain('reserved');
    expect(service['updateMyPublicProfile']).not.toHaveBeenCalled();
  });
});
