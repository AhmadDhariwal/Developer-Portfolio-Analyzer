import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { filter, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { CareerProfileService } from './career-profile.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { CareerStack, ExperienceLevel, CareerGoal } from '../models/career-profile.model';
import { environment } from '../../../environments/environment';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

export interface NotificationPrefs {
  weeklyScoreReport: boolean;
  skillTrendAlerts: boolean;
  newRecommendations: boolean;
  jobMatchAlerts: boolean;
}

export interface AccountStats {
  developerScore: number;
  reposAnalyzed: number;
  skillsDetected: number;
  memberSince: string;
}

export interface ResumeContextFile {
  fileId: string;
  fileName: string;
  uploadDate: string;
  isAnalyzed: boolean;
}

export interface UserProfile {
  _id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  countryCode?: string;
  githubUsername: string;
  activeGithubUsername?: string;
  avatar: string;
  jobTitle: string;
  location: string;
  bio: string;
  website: string;
  twitter: string;
  linkedin: string;
  notifications: NotificationPrefs;
  careerStack: CareerStack;
  experienceLevel: ExperienceLevel;
  activeCareerStack?: CareerStack;
  activeExperienceLevel?: ExperienceLevel;
  careerGoal: CareerGoal;
  targetTimeline?: string;
  learningPreference?: string;
  profileHash?: string;
  isConfigured: boolean;
  isPublic?: boolean;
  role?: string;
  profileCompleted?: boolean;
  defaultResume?: ResumeContextFile | null;
  activeResume?: ResumeContextFile | null;
  stats: AccountStats;
}

export interface UpdateProfilePayload {
  name?: string;
  githubUsername?: string;
  defaultResumeFileId?: string | null;
  jobTitle?: string;
  location?: string;
  bio?: string;
  website?: string;
  twitter?: string;
  linkedin?: string;
  phoneNumber?: string;
  notifications?: Partial<NotificationPrefs>;
  targetTimeline?: string;
  learningPreference?: string;
}

export interface PasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface AvatarUploadResponse {
  message: string;
  avatar: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService implements OnDestroy {
  private readonly baseUrl = `${environment.apiBaseUrl}/profile`;
  private readonly apiOrigin = environment.apiOrigin;
  private readonly cacheKey = 'devinsight_profile_cache';
  private inflightProfile$: Observable<UserProfile> | null = null;
  private memoryProfile: UserProfile | null = null;
  private readonly profileCacheTtlMs = 5 * 60 * 1000;
  private cacheExpiresAt = 0;
  private generation = 0;
  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key === this.cacheKey) {
      this.memoryProfile = null;
      this.cacheExpiresAt = 0;
      this.generation += 1;
      this.inflightProfile$ = null;
      this.invalidateDependentCaches();
    }
  };

  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService,
    private readonly careerProfileService: CareerProfileService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly cacheInvalidation: FrontendCacheInvalidationService,
  ) {
    this.cacheInvalidation.register('profile', () => this.clearCache());
    globalThis.addEventListener?.('storage', this.onStorage);
  }

  ngOnDestroy(): void {
    globalThis.removeEventListener?.('storage', this.onStorage);
  }

  clearCache(): void {
    this.inflightProfile$ = null;
    this.memoryProfile = null;
    this.cacheExpiresAt = 0;
    this.generation += 1;
    localStorage.removeItem(this.cacheKey);
  }

  getProfile(forceRefresh = false): Observable<UserProfile> {
    if (!forceRefresh) {
      const owner = this.authService.getCurrentUser()?._id;
      const cached =
        this.memoryProfile?._id === owner && this.cacheExpiresAt > Date.now()
          ? this.memoryProfile
          : this.readCachedProfile();
      if (cached) return of(cached);
      if (this.inflightProfile$) return this.inflightProfile$;
    }

    const token = this.authService.getToken();
    const generation = ++this.generation;
    this.inflightProfile$ = this.http.get<UserProfile>(`${this.baseUrl}/me`).pipe(
      filter(() => generation === this.generation && token === this.authService.getToken()),
      map((profile) => this.normalizeProfile(profile)),
      tap((profile) => this.applyProfile(profile)),
      finalize(() => {
        if (generation === this.generation) this.inflightProfile$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.inflightProfile$;
  }

  updateProfile(payload: UpdateProfilePayload): Observable<Partial<UserProfile>> {
    const token = this.authService.getToken();
    return this.http.put<Partial<UserProfile>>(`${this.baseUrl}/me`, payload).pipe(
      filter(() => token === this.authService.getToken()),
      map((updated) => ({
        ...updated,
        ...(typeof updated.avatar === 'string'
          ? { avatar: this.resolveAvatarUrl(updated.avatar) }
          : {}),
      })),
      tap((updated) => {
        this.generation += 1;
        this.inflightProfile$ = null;
        this.authService.updateCurrentUser(updated);
        this.mergeProfileUpdate(updated);
        this.cacheInvalidation.clearPublicPortfolioCaches();
      }),
    );
  }

  updatePassword(payload: PasswordPayload): Observable<{ message: string; token?: string }> {
    const token = this.authService.getToken();
    return this.http
      .put<{ message: string; token?: string }>(`${this.baseUrl}/password`, payload)
      .pipe(
        filter(() => token === this.authService.getToken()),
        tap((response) => {
          if (response.token) this.authService.rotateSessionToken(response.token);
        }),
      );
  }

  uploadAvatar(file: File): Observable<AvatarUploadResponse> {
    const form = new FormData();
    form.append('avatar', file);

    const token = this.authService.getToken();
    return this.http.post<AvatarUploadResponse>(`${this.baseUrl}/avatar`, form).pipe(
      filter(() => token === this.authService.getToken()),
      map((res) => ({
        ...res,
        avatar: this.resolveAvatarUrl(res.avatar),
      })),
      tap((res) => {
        this.generation += 1;
        this.inflightProfile$ = null;
        this.authService.updateCurrentUser({ avatar: res.avatar });
        this.mergeProfileUpdate({ avatar: res.avatar });
        this.cacheInvalidation.clearPublicPortfolioCaches();
      }),
    );
  }

  deleteAccount(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/me`);
  }

  updateVisibility(isPublic: boolean): Observable<{ isPublic: boolean }> {
    const token = this.authService.getToken();
    return this.http.put<{ isPublic: boolean }>(`${this.baseUrl}/visibility`, { isPublic }).pipe(
      filter(() => token === this.authService.getToken()),
      tap((res) => {
        this.generation += 1;
        this.inflightProfile$ = null;
        this.mergeProfileUpdate({ isPublic: res.isPublic });
        this.cacheInvalidation.clearPublicPortfolioCaches();
      }),
    );
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  resolveAvatarUrl(avatar: string): string {
    const raw = String(avatar || '').trim();
    if (!raw) return '';

    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;

    const browserOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : this.apiOrigin;

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.pathname.startsWith('/uploads/')) {
          return `${browserOrigin}${parsed.pathname}`;
        }
      } catch {
        return raw;
      }
      return raw;
    }

    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;

    if (raw.startsWith('/uploads/')) {
      return `${browserOrigin}${raw}`;
    }

    if (raw.startsWith('uploads/')) {
      return `${browserOrigin}/${raw}`;
    }

    return raw;
  }

  private normalizeProfile(profile: UserProfile): UserProfile {
    return {
      ...profile,
      avatar: this.resolveAvatarUrl(profile.avatar),
      activeGithubUsername: profile.activeGithubUsername || profile.githubUsername || '',
      activeCareerStack: profile.activeCareerStack || profile.careerStack || 'Full Stack',
      activeExperienceLevel: profile.activeExperienceLevel || profile.experienceLevel || 'Student',
      targetTimeline: profile.targetTimeline || '',
      learningPreference: profile.learningPreference || '',
      profileHash: profile.profileHash || this.stableProfileHash(profile),
    };
  }

  private applyProfile(profile: UserProfile): void {
    const previousHash =
      this.memoryProfile?.profileHash || this.readCachedProfile()?.profileHash || '';
    this.memoryProfile = profile;
    this.cacheExpiresAt = Date.now() + this.profileCacheTtlMs;
    this.writeCachedProfile(profile);
    this.syncStoredUser({
      _id: profile._id,
      name: profile.name,
      githubUsername: profile.githubUsername,
      activeGithubUsername: profile.activeGithubUsername,
      avatar: profile.avatar,
    });

    this.careerProfileService.hydrateFromServer({
      careerStack: profile.careerStack ?? 'Full Stack',
      experienceLevel: profile.experienceLevel ?? 'Student',
      activeGithubUsername: profile.activeGithubUsername ?? profile.githubUsername ?? '',
      activeCareerStack: profile.activeCareerStack ?? profile.careerStack ?? 'Full Stack',
      activeExperienceLevel: profile.activeExperienceLevel ?? profile.experienceLevel ?? 'Student',
      careerGoal: profile.careerGoal ?? '',
      targetTimeline: profile.targetTimeline ?? '',
      learningPreference: profile.learningPreference ?? '',
      profileHash: profile.profileHash ?? '',
      isConfigured: profile.isConfigured ?? false,
    });

    if (previousHash && profile.profileHash && previousHash !== profile.profileHash) {
      this.invalidateDependentCaches();
    }
  }

  private mergeProfileUpdate(update: Partial<UserProfile>): void {
    const base = this.memoryProfile || this.readCachedProfile();
    if (!base) {
      this.invalidateDependentCaches();
      return;
    }
    const next = this.normalizeProfile({ ...base, ...update } as UserProfile);
    this.applyProfile(next);
  }

  private readCachedProfile(): UserProfile | null {
    try {
      const raw = localStorage.getItem(this.cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        Number(parsed?.expiresAt || 0) <= Date.now() ||
        !parsed?.profile ||
        parsed.profile._id !== this.authService.getCurrentUser()?._id
      ) {
        localStorage.removeItem(this.cacheKey);
        return null;
      }
      const profile = this.normalizeProfile(parsed.profile);
      this.memoryProfile = profile;
      this.cacheExpiresAt = Number(parsed.expiresAt);
      return profile;
    } catch {
      localStorage.removeItem(this.cacheKey);
      return null;
    }
  }

  private writeCachedProfile(profile: UserProfile): void {
    localStorage.setItem(
      this.cacheKey,
      JSON.stringify({
        cachedAt: Date.now(),
        expiresAt: Date.now() + this.profileCacheTtlMs,
        profile,
      }),
    );
  }

  private invalidateDependentCaches(): void {
    this.cacheInvalidation.clearDeveloperSignalCaches();
    globalThis.dispatchEvent?.(new CustomEvent('devinsight:profile-personalization-changed'));
  }

  private stableProfileHash(profile: Partial<UserProfile>): string {
    const payload = JSON.stringify({
      activeGithubUsername: String(profile.activeGithubUsername || profile.githubUsername || '')
        .trim()
        .toLowerCase(),
      activeCareerStack: String(
        profile.activeCareerStack || profile.careerStack || 'Full Stack',
      ).trim(),
      activeExperienceLevel: String(
        profile.activeExperienceLevel || profile.experienceLevel || 'Student',
      ).trim(),
      careerGoal: String(profile.careerGoal || '').trim(),
      targetTimeline: String(profile.targetTimeline || '').trim(),
      learningPreference: String(profile.learningPreference || '').trim(),
      resumeFileId: profile.activeResume?.fileId || profile.defaultResume?.fileId || '',
    });
    let hash = 0;
    for (let i = 0; i < payload.length; i += 1) {
      hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
    }
    return `profile-${Math.abs(hash)}`;
  }

  private syncStoredUser(
    partial: Partial<
      Pick<UserProfile, '_id' | 'name' | 'githubUsername' | 'activeGithubUsername' | 'avatar'>
    >,
  ): void {
    this.authService.updateCurrentUser(partial);
  }
}
