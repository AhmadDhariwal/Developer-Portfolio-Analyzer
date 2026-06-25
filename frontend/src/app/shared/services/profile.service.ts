import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { finalize, map, shareReplay, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { CareerProfileService } from './career-profile.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { CareerStack, ExperienceLevel, CareerGoal } from '../models/career-profile.model';
import { environment } from '../../../environments/environment';

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
  targetTimeline?:    string;
  learningPreference?: string;
  profileHash?:       string;
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
  targetTimeline?: string;
  learningPreference?: string;
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
  private readonly cacheKey = 'devinsight_profile_cache';
  private readonly dependentCacheModules = [
    'dashboardSummary',
    'dashboardContributions',
    'dashboardLanguages',
    'dashboardSkills',
    'dashboardRecommendations',
    'dashboardIntegrationAnalytics',
    'skillGap',
    'recommendations',
    'news',
    'weeklyReports'
  ];
  private inflightProfile$: Observable<UserProfile> | null = null;
  private memoryProfile: UserProfile | null = null;
  private readonly profileCacheTtlMs = 5 * 60 * 1000;
  private readonly inflight = new Map<string, Observable<UserProfile>>();
  private cachedProfile: UserProfile | null = null;
  private cachedAt = 0;
  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService,
    private readonly careerProfileService: CareerProfileService,
    private readonly frontendCache:       FrontendAnalysisCacheService,
  ) {}

  // ── Fetch profile + stats from backend ────────────────────────────────
  getProfile(forceRefresh = false): Observable<UserProfile> {
    if (!forceRefresh) {
      const cached = this.memoryProfile || this.readCachedProfile();
      if (cached) return of(cached);
      if (this.inflightProfile$) return this.inflightProfile$;
    }

    this.inflightProfile$ = this.http.get<UserProfile>(`${this.baseUrl}/me`).pipe(
      map((profile) => this.normalizeProfile(profile)),
      tap(profile => this.applyProfile(profile)),
      finalize(() => { this.inflightProfile$ = null; }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.inflightProfile$;
  }

  updateProfile(payload: UpdateProfilePayload): Observable<Partial<UserProfile>> {
    return this.http.put<Partial<UserProfile>>(`${this.baseUrl}/me`, payload).pipe(
      map((updated) => ({
        ...updated,
        ...(typeof updated.avatar === 'string' ? { avatar: this.resolveAvatarUrl(updated.avatar) } : {})
      })),
      tap((updated) => {
        this.authService.updateCurrentUser(updated);
        this.mergeProfileUpdate(updated);
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
        this.mergeProfileUpdate({ avatar: res.avatar });
      })
    );
  }

  deleteAccount(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/me`);
  }

  updateVisibility(isPublic: boolean): Observable<{ isPublic: boolean }> {
    return this.http.put<{ isPublic: boolean }>(`${this.baseUrl}/visibility`, { isPublic }).pipe(
      tap((res) => this.mergeProfileUpdate({ isPublic: res.isPublic }))
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
      avatar: this.resolveAvatarUrl(profile.avatar),
      activeGithubUsername: profile.activeGithubUsername || profile.githubUsername || '',
      activeCareerStack: profile.activeCareerStack || profile.careerStack || 'Full Stack',
      activeExperienceLevel: profile.activeExperienceLevel || profile.experienceLevel || 'Student',
      targetTimeline: profile.targetTimeline || '',
      learningPreference: profile.learningPreference || '',
      profileHash: profile.profileHash || this.stableProfileHash(profile)
    };
  }

  private applyProfile(profile: UserProfile): void {
    const previousHash = this.memoryProfile?.profileHash || this.readCachedProfile()?.profileHash || '';
    this.memoryProfile = profile;
    this.writeCachedProfile(profile);
    this.syncStoredUser({
      _id: profile._id,
      name: profile.name,
      githubUsername: profile.githubUsername,
      activeGithubUsername: profile.activeGithubUsername,
      avatar: profile.avatar
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
      isConfigured: profile.isConfigured ?? false
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
      if (Number(parsed?.expiresAt || 0) <= Date.now() || !parsed?.profile) {
        localStorage.removeItem(this.cacheKey);
        return null;
      }
      const profile = this.normalizeProfile(parsed.profile);
      this.memoryProfile = profile;
      return profile;
    } catch {
      localStorage.removeItem(this.cacheKey);
      return null;
    }
  }

  private writeCachedProfile(profile: UserProfile): void {
    localStorage.setItem(this.cacheKey, JSON.stringify({
      cachedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      profile
    }));
  }

  private invalidateDependentCaches(): void {
    this.dependentCacheModules.forEach((module) => this.frontendCache.clearModule(module));
    this.frontendCache.clearPrefixes(['skill_gap_cache:', 'skill_gap_cache_index:']);
    this.frontendCache.clearCurrentSignalHash();
    globalThis.dispatchEvent?.(new CustomEvent('devinsight:profile-personalization-changed'));
  }

  private stableProfileHash(profile: Partial<UserProfile>): string {
    const payload = JSON.stringify({
      activeGithubUsername: String(profile.activeGithubUsername || profile.githubUsername || '').trim().toLowerCase(),
      activeCareerStack: String(profile.activeCareerStack || profile.careerStack || 'Full Stack').trim(),
      activeExperienceLevel: String(profile.activeExperienceLevel || profile.experienceLevel || 'Student').trim(),
      careerGoal: String(profile.careerGoal || '').trim(),
      targetTimeline: String(profile.targetTimeline || '').trim(),
      learningPreference: String(profile.learningPreference || '').trim()
    });
    let hash = 0;
    for (let i = 0; i < payload.length; i += 1) {
      hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
    }
    return `profile-${Math.abs(hash)}`;
  }

  private syncStoredUser(partial: Partial<Pick<UserProfile, '_id' | 'name' | 'githubUsername' | 'activeGithubUsername' | 'avatar'>>): void {
    this.authService.updateCurrentUser(partial);
  }
}




