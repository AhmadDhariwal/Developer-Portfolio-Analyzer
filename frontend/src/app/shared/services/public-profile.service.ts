import { Injectable } from '@angular/core';
import { Observable, catchError, map, shareReplay, tap, throwError } from 'rxjs';
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
  analytics: PublicProfileAnalytics;
  profileStrengthScore?: number;
  momentum?: PublicProfileMomentum | null;
  user: { name: string; jobTitle: string; location: string; avatar: string; githubUsername: string; email?: string; phoneNumber?: string };
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
  providedIn: 'root'
})
export class PublicProfileService {
  private readonly cacheTtlMs = 24 * 60 * 60 * 1000;
  private readonly maxCacheEntries = 50;
  private readonly cache = new Map<string, { value$: Observable<PublicProfilePayload>; expiresAt: number }>();

  constructor(private readonly api: ApiService, private readonly cacheInvalidation: FrontendCacheInvalidationService) {
    this.cacheInvalidation.register('public-portfolio', () => this.clearCache());
  }

  getPublicProfile(slug: string, options: { forceRefresh?: boolean; queryParams?: Record<string, unknown> } = {}): Observable<PublicProfilePayload> {
    const key = this.buildKey(slug, options.queryParams);
    const now = Date.now();
    this.pruneCache(now);
    const existing = this.cache.get(key);
    if (!options.forceRefresh && existing && existing.expiresAt > now) {
      this.cache.delete(key);
      this.cache.set(key, existing);
      return existing.value$.pipe(map((profile) => ({ ...profile, frontendCacheState: 'cached' })));
    }

    const previewVal = options.queryParams?.['preview'] as string | undefined;
    const request$ = this.api.getPublicProfile(slug, previewVal).pipe(
      map((profile) => ({ ...profile, frontendCacheState: 'network' as const })),
      catchError((error) => {
        this.cache.delete(key);
        if (existing) return existing.value$.pipe(map((profile) => ({ ...profile, frontendCacheState: 'stale' as const })));
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.cache.set(key, { value$: request$, expiresAt: now + this.cacheTtlMs });
    this.pruneCache(now);
    return request$;
  }

  getMyPublicProfile(): Observable<PublicProfilePayload> {
    return this.api.getMyPublicProfile();
  }

  updateMyPublicProfile(payload: Partial<PublicProfilePayload>): Observable<PublicProfilePayload> {
    return this.api.updateMyPublicProfile(payload).pipe(tap(() => {
      this.cacheInvalidation.clearPublicPortfolioCaches();
      this.cacheInvalidation.clearDashboardCaches();
      this.cacheInvalidation.clearScenarioCaches();
      this.cacheInvalidation.clearWeeklyReportCaches();
    }));
  }

  getAnalytics(): Observable<PublicProfileAnalytics> {
    return this.api.getPublicProfileAnalytics();
  }

  clearCache(usernameOrSlug?: string): void {
    if (!usernameOrSlug) {
      this.cache.clear();
      return;
    }
    const normalized = String(usernameOrSlug).trim().toLowerCase();
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${normalized}|`)) this.cache.delete(key);
    }
  }

  private buildKey(slug: string, queryParams: Record<string, unknown> = {}): string {
    return `${String(slug || '').trim().toLowerCase()}|${JSON.stringify(Object.entries(queryParams).sort(([left], [right]) => left.localeCompare(right)))}`;
  }

  private pruneCache(now = Date.now()): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }
}
