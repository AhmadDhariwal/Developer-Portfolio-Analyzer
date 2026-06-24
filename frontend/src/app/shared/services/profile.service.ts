import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { finalize, map, shareReplay, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { CareerProfileService } from './career-profile.service';
import { CareerStack, ExperienceLevel, CareerGoal } from '../models/career-profile.model';
import { environment } from '../../../environments/environment';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { ApiService } from './api.service';

export interface NotificationPrefs {
  weeklyScoreReport:  boolean;
  skillTrendAlerts:   boolean;
  newRecommendations: boolean;
  jobMatchAlerts:     boolean;
}

export interface AccountStats {
  developerScore: number;
  reposAnalyzed:  number;
  skillsDetected: number;
  memberSince:    string;
}

export interface ResumeContextFile {
  fileId: string;
  fileName: string;
  uploadDate: string;
  isAnalyzed: boolean;
}

export interface UserProfile {
  _id:                string;
  name:               string;
  email:              string;
  phoneNumber?:       string;
  countryCode?:       string;
  githubUsername:     string;
  activeGithubUsername?: string;
  avatar:             string;
  jobTitle:           string;
  location:           string;
  bio:                string;
  website:            string;
  twitter:            string;
  linkedin:           string;
  notifications:      NotificationPrefs;
  careerStack:        CareerStack;
  experienceLevel:    ExperienceLevel;
  activeCareerStack?: CareerStack;
  activeExperienceLevel?: ExperienceLevel;
  careerGoal:         CareerGoal;
  isConfigured:       boolean;
  isPublic?:          boolean;
  role?:              string;
  profileCompleted?:  boolean;
  defaultResume?:     ResumeContextFile | null;
  activeResume?:      ResumeContextFile | null;
  stats:              AccountStats;
}

export interface UpdateProfilePayload {
  name?:          string;
  githubUsername?: string;
  defaultResumeFileId?: string | null;
  jobTitle?:      string;
  location?:      string;
  bio?:           string;
  website?:       string;
  twitter?:       string;
  linkedin?:      string;
  phoneNumber?:   string;
  notifications?: Partial<NotificationPrefs>;
}

export interface PasswordPayload {
  currentPassword: string;
  newPassword:     string;
}

export interface AvatarUploadResponse {
  message: string;
  avatar: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly baseUrl = `${environment.apiBaseUrl}/profile`;
  private readonly apiOrigin = environment.apiOrigin;
  private readonly profileCacheTtlMs = 5 * 60 * 1000;
  private readonly inflight = new Map<string, Observable<UserProfile>>();
  private cachedProfile: UserProfile | null = null;
  private cachedAt = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService,
    private readonly careerProfileService: CareerProfileService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly apiService: ApiService,
  ) {}

  getProfile(options: { forceRefresh?: boolean } = {}): Observable<UserProfile> {
    const forceRefresh = options.forceRefresh === true;
    if (!forceRefresh && this.hasFreshCache()) {
      return of(this.cloneProfile(this.cachedProfile as UserProfile));
    }

    const requestKey = forceRefresh ? 'refresh' : 'default';
    const activeRequest = this.inflight.get(requestKey);
    if (activeRequest) return activeRequest;

    const cacheBust = Date.now();
    const request$ = this.http.get<UserProfile>(`${this.baseUrl}/me?_=${cacheBust}`, {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    }).pipe(
      map((profile) => this.normalizeProfile(profile)),
      tap((profile) => this.hydrateSharedState(profile)),
      finalize(() => this.inflight.delete(requestKey)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inflight.set(requestKey, request$);
    return request$;
  }

  refreshProfile(): Observable<UserProfile> {
    return this.getProfile({ forceRefresh: true });
  }

  updateProfile(payload: UpdateProfilePayload): Observable<Partial<UserProfile>> {
    const previousGithubUsername = String(
      this.cachedProfile?.activeGithubUsername
      || this.cachedProfile?.githubUsername
      || this.authService.getCurrentUser()?.activeGithubUsername
      || this.authService.getCurrentUser()?.githubUsername
      || ''
    ).trim().toLowerCase();

    return this.http.put<Partial<UserProfile>>(`${this.baseUrl}/me`, payload).pipe(
      tap((updated) => {
        const next = {
          ...updated,
          ...(typeof updated.avatar === 'string' ? { avatar: this.resolveAvatarUrl(updated.avatar) } : {})
        };
        this.authService.updateCurrentUser(next);
        this.patchCachedProfile(next);

        const nextGithubUsername = String(next.activeGithubUsername || next.githubUsername || previousGithubUsername)
          .trim()
          .toLowerCase();
        if (previousGithubUsername !== nextGithubUsername) {
          this.invalidateDependentCaches();
        }
      })
    );
  }

  updatePassword(payload: PasswordPayload): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/password`, payload);
  }

  uploadAvatar(file: File): Observable<AvatarUploadResponse> {
    const form = new FormData();
    form.append('avatar', file);

    return this.http.post<AvatarUploadResponse>(`${this.baseUrl}/avatar`, form).pipe(
      map((res) => ({
        ...res,
        avatar: this.resolveAvatarUrl(res.avatar)
      })),
      tap((res) => {
        this.authService.updateCurrentUser({ avatar: res.avatar });
        this.patchCachedProfile({ avatar: res.avatar });
      })
    );
  }

  deleteAccount(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/me`);
  }

  updateVisibility(isPublic: boolean): Observable<{ isPublic: boolean }> {
    return this.http.put<{ isPublic: boolean }>(`${this.baseUrl}/visibility`, { isPublic }).pipe(
      tap((res) => this.patchCachedProfile({ isPublic: res.isPublic }))
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

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.pathname.startsWith('/uploads/')) {
          return `${this.apiOrigin}${parsed.pathname}`;
        }
      } catch {
        return raw;
      }
      return raw;
    }

    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;

    if (raw.startsWith('/uploads/')) {
      return `${this.apiOrigin}${raw}`;
    }

    if (raw.startsWith('uploads/')) {
      return `${this.apiOrigin}/${raw}`;
    }

    return raw;
  }

  private normalizeProfile(profile: UserProfile): UserProfile {
    return {
      ...profile,
      avatar: this.resolveAvatarUrl(profile.avatar)
    };
  }

  private hydrateSharedState(profile: UserProfile): void {
    this.cachedProfile = this.cloneProfile(profile);
    this.cachedAt = Date.now();
    this.syncStoredUser({
      _id: profile._id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      githubUsername: profile.githubUsername,
      activeGithubUsername: profile.activeGithubUsername || profile.githubUsername,
      avatar: profile.avatar,
      careerStack: profile.careerStack,
      experienceLevel: profile.experienceLevel,
      activeCareerStack: profile.activeCareerStack || profile.careerStack,
      activeExperienceLevel: profile.activeExperienceLevel || profile.experienceLevel,
      careerGoal: profile.careerGoal
    });
    this.careerProfileService.hydrateFromServer({
      careerStack: profile.careerStack ?? 'Full Stack',
      experienceLevel: profile.experienceLevel ?? 'Student',
      activeCareerStack: profile.activeCareerStack ?? profile.careerStack ?? 'Full Stack',
      activeExperienceLevel: profile.activeExperienceLevel ?? profile.experienceLevel ?? 'Student',
      careerGoal: profile.careerGoal ?? '',
      isConfigured: profile.isConfigured ?? false
    });
  }

  private patchCachedProfile(partial: Partial<UserProfile>): void {
    if (!this.cachedProfile) return;

    this.cachedProfile = this.cloneProfile({
      ...this.cachedProfile,
      ...partial,
      notifications: partial.notifications
        ? {
            ...(this.cachedProfile.notifications || {}),
            ...partial.notifications
          }
        : this.cachedProfile.notifications,
      stats: partial.stats
        ? {
            ...(this.cachedProfile.stats || {}),
            ...partial.stats
          }
        : this.cachedProfile.stats
    });
    this.cachedAt = Date.now();
  }

  private invalidateDependentCaches(): void {
    this.frontendCache.clearCurrentSignalHash();
    this.apiService.invalidateScenarioContextCache();
    [
      'dashboardSummary',
      'dashboardContributions',
      'dashboardLanguages',
      'dashboardSkills',
      'dashboardRecommendations',
      'dashboardIntegrationAnalytics',
      'recommendations',
      'weeklyReports',
      'news-feed'
    ].forEach((module) => this.frontendCache.clearModule(module));
  }

  private hasFreshCache(): boolean {
    return Boolean(this.cachedProfile && Date.now() - this.cachedAt < this.profileCacheTtlMs);
  }

  private cloneProfile(profile: UserProfile): UserProfile {
    return {
      ...profile,
      notifications: { ...(profile.notifications || {}) },
      stats: { ...(profile.stats || {}) },
      defaultResume: profile.defaultResume ? { ...profile.defaultResume } : null,
      activeResume: profile.activeResume ? { ...profile.activeResume } : null
    };
  }

  private syncStoredUser(partial: Partial<UserProfile>): void {
    this.authService.updateCurrentUser(partial);
  }
}




