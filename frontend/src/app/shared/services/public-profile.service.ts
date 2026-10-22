import { Injectable, OnDestroy } from '@angular/core';
import {
  Observable,
  Subject,
  Subscription,
  defer,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

export interface PublicProfileSkill {
  name: string;
  score: number;
}

export interface PublicProfileProject {
  title: string;
  description: string;
  url: string;
  repoUrl?: string;
  imageUrl?: string;
  tech: string[];
  status?: 'completed' | 'in-progress' | 'upcoming' | 'planned';
  expectedDate?: string;
}

export interface PublicProfileUpcomingProject {
  title: string;
  description: string;
  expectedDate: string;
  techStack: string[];
  status?: 'in-progress' | 'planned';
  url?: string;
  repoUrl?: string;
  imageUrl?: string;
}

export interface PublicProfileTestimonial {
  quote: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

export interface PublicProfileWorkExperience {
  title: string;
  description: string;
  icon: string;
  ctaLabel: string;
  ctaUrl: string;
}

export interface PublicProfileSections {
  hero: {
    greetingLabel: string;
    roleLabel: string;
    titleLineOne: string;
    titleLineTwo: string;
    titleHighlight: string;
    titleLineSuffix: string;
    tagline: string;
  };
  skills: {
    headline: string;
    highlight: string;
    headlineSuffix: string;
    subheadline: string;
  };
  contact: {
    heading: string;
    message: string;
    email: string;
  };
  upcoming: {
    heading: string;
    subheading: string;
  };
  testimonials: {
    heading: string;
    subheading: string;
  };
  cta: {
    heading: string;
    subtext: string;
    primaryLabel: string;
    secondaryLabel: string;
    resumeUrl: string;
  };
  visibility: {
    projects: boolean;
    upcoming: boolean;
    testimonials: boolean;
    cta: boolean;
  };
}

export interface PublicProfileAnalytics {
  totalViews: number;
  uniqueViews: number;
  uniqueViewRate?: number;
  lastViewedAt: string | null;
  last7Days?: Array<{ date: string; count: number }>;
}

export interface PublicProfileMomentum {
  weekEndDate: string;
  score: number;
  summary: string;
  topAchievements: string[];
  biggestRiskArea: string;
}

export interface PublicProfilePayload {
  slug: string;
  isPublic: boolean;
  headline: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  skills: PublicProfileSkill[];
  projects: PublicProfileProject[];
  upcomingProjects: PublicProfileUpcomingProject[];
  testimonials: PublicProfileTestimonial[];
  workExperiences: PublicProfileWorkExperience[];
  completedCourses?: PublicProfileCompletedCourse[];
  sections: PublicProfileSections;
  socialLinks: { website?: string; twitter?: string; linkedin?: string; github?: string };
  email?: string;
  phoneNumber?: string;
  resumeUrl?: string;
  defaultResumeUrl?: string;
  analytics?: PublicProfileAnalytics;
  profileStrengthScore?: number;
  momentum?: PublicProfileMomentum | null;
  user: {
    name: string;
    jobTitle: string;
    location: string;
    avatar: string;
    githubUsername: string;
    email?: string;
    phoneNumber?: string;
  };
  frontendCacheState?: 'network' | 'cached' | 'stale';
}

export interface PublicProfileCompletedCourse {
  _id?: string;
  title: string;
  provider?: string;
  category?: string;
  skills?: string[];
  completionDate?: string | null;
  duration?: string;
  certificateUrl?: string;
  credentialId?: string;
  description?: string;
  order?: number;
  isVisible?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PublicProfileService implements OnDestroy {
  private readonly requests = new Map<string, Observable<PublicProfilePayload>>();
  private readonly cancelReads = new Subject<void>();
  private readonly accountChanged = new Subject<void>();
  readonly sessionChanged$ = this.accountChanged.asObservable();
  private readonly changes = new Subject<void>();
  readonly invalidated$ = this.changes.asObservable();
  private readonly authSubscription: Subscription;
  private readonly channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('devinsight-portfolio') : null;
  private readonly storageListener = (event: StorageEvent) => {
    if (['token', 'user'].includes(event.key || '')) {
      this.accountChanged.next();
      this.clearCache();
    }
    if (event.key === 'devinsight_portfolio_revision') this.clearCache();
  };

  constructor(
    private readonly api: ApiService,
    private readonly cacheInvalidation: FrontendCacheInvalidationService,
    private readonly auth: AuthService,
  ) {
    this.cacheInvalidation.register('public-portfolio', () => {
      this.clearCache();
      this.broadcast();
    });
    this.authSubscription = this.auth.currentUser$
      .pipe(
        map((user) => String(user?._id || 'anonymous')),
        distinctUntilChanged(),
      )
      .subscribe(() => {
        this.accountChanged.next();
        this.clearCache();
      });
    if (this.channel) this.channel.onmessage = () => this.clearCache();
    globalThis.addEventListener?.('storage', this.storageListener);
  }

  getPublicProfile(
    slug: string,
    options: { forceRefresh?: boolean; queryParams?: Record<string, unknown> } = {},
  ): Observable<PublicProfilePayload> {
    const preview = options.queryParams?.['preview'];
    // Preview responses are never retained or shared. Completed public results are
    // not cached either: the backend's no-store/visibility boundary wins.
    if (preview !== undefined)
      return defer(() => this.api.getPublicProfile(slug, String(preview))).pipe(
        takeUntil(this.cancelReads),
      );
    const key = String(slug).toLowerCase();
    if (options.forceRefresh) this.requests.delete(key);
    const existing = this.requests.get(key);
    if (existing) return existing;
    if (this.requests.size >= 25)
      return throwError(() => ({ status: 503, error: { message: 'Please retry shortly.' } }));
    const request = defer(() =>
      this.api.getPublicProfile(slug, undefined, this.auth.isLoggedIn()),
    ).pipe(
      takeUntil(this.cancelReads),
      finalize(() => {
        if (this.requests.get(key) === request) this.requests.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.requests.set(key, request);
    return request;
  }

  getMyPublicProfile(): Observable<PublicProfilePayload> {
    return defer(() => this.api.getMyPublicProfile()).pipe(takeUntil(this.cancelReads));
  }

  updateMyPublicProfile(payload: Partial<PublicProfilePayload>): Observable<PublicProfilePayload> {
    return defer(() => {
      this.clearCache();
      this.broadcast();
      return this.api.updateMyPublicProfile(payload).pipe(
        takeUntil(this.accountChanged),
        tap(() => {
          this.cacheInvalidation.clearPublicPortfolioCaches();
          this.cacheInvalidation.clearDashboardCaches();
          this.cacheInvalidation.clearScenarioCaches();
          this.cacheInvalidation.clearWeeklyReportCaches();
        }),
      );
    });
  }

  getAnalytics(): Observable<PublicProfileAnalytics> {
    return defer(() => this.api.getPublicProfileAnalytics()).pipe(takeUntil(this.cancelReads));
  }

  uploadImage(file: File): Observable<{ imageUrl: string }> {
    const body = new FormData();
    body.append('image', file);
    return this.api.uploadPortfolioImage(body).pipe(takeUntil(this.accountChanged));
  }

  contact(slug: string, message: string, website = ''): Observable<{ sent: boolean }> {
    return this.api
      .contactPublicPortfolio(slug, { message, website })
      .pipe(takeUntil(this.accountChanged));
  }

  downloadResume(slug: string, owner = false): Observable<Blob> {
    return this.api
      .downloadPortfolioResume(owner ? 'me' : slug)
      .pipe(takeUntil(this.accountChanged));
  }

  clearCache(_slug?: string): void {
    this.requests.clear();
    this.cancelReads.next();
    this.changes.next();
  }

  private broadcast(): void {
    if (this.channel) this.channel.postMessage('invalidate');
    else {
      try {
        localStorage.setItem('devinsight_portfolio_revision', String(Date.now()));
      } catch {
        /* Storage can be unavailable. */
      }
    }
  }

  ngOnDestroy(): void {
    this.authSubscription.unsubscribe();
    this.channel?.close();
    globalThis.removeEventListener?.('storage', this.storageListener);
    this.cancelReads.next();
    this.accountChanged.next();
    this.cancelReads.complete();
    this.accountChanged.complete();
    this.changes.complete();
  }
}
