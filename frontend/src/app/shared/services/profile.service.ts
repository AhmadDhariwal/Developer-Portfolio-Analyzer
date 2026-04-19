import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { CareerProfileService } from './career-profile.service';
import { CareerStack, ExperienceLevel, CareerGoal } from '../models/career-profile.model';

// ─── Interfaces ───────────────────────────────────────────────────────────

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

// ─── Service ──────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly baseUrl = 'http://localhost:5000/api/profile';
  private readonly apiOrigin = this.baseUrl.replace(/\/api\/profile$/, '');

  constructor(
    private readonly http:                HttpClient,
    private readonly authService:         AuthService,
    private readonly careerProfileService: CareerProfileService,
  ) {}

  // ── Fetch profile + stats from backend ────────────────────────────────
  getProfile(): Observable<UserProfile> {
    const cacheBust = Date.now();
    return this.http.get<UserProfile>(`${this.baseUrl}/me?_=${cacheBust}`, {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    }).pipe(
      map((profile) => ({
        ...profile,
        avatar: this.resolveAvatarUrl(profile.avatar)
      })),
      tap(profile => {
        this.syncStoredUser({
          _id: profile._id,
          name: profile.name,
          githubUsername: profile.githubUsername,
          avatar: profile.avatar
        });

        // Keep CareerProfileService in sync with the server truth on every profile load
        this.careerProfileService.hydrateFromServer({
          careerStack:     profile.careerStack     ?? 'Full Stack',
          experienceLevel: profile.experienceLevel ?? 'Student',
          activeCareerStack: profile.activeCareerStack ?? profile.careerStack ?? 'Full Stack',
          activeExperienceLevel: profile.activeExperienceLevel ?? profile.experienceLevel ?? 'Student',
          careerGoal:      profile.careerGoal      ?? '',
          isConfigured:    profile.isConfigured    ?? false
        });
      })
    );
  }

  // ── Save profile fields + notification prefs ──────────────────────────
  updateProfile(payload: UpdateProfilePayload): Observable<Partial<UserProfile>> {
    return this.http.put<Partial<UserProfile>>(`${this.baseUrl}/me`, payload).pipe(
      tap((updated) => {
        const next = {
          ...updated,
          ...(typeof updated.avatar === 'string' ? { avatar: this.resolveAvatarUrl(updated.avatar) } : {})
        };
        this.authService.updateCurrentUser(next);
      })
    );
  }

  // ── Change password ────────────────────────────────────────────────────
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
      })
    );
  }

  // ── Delete account ─────────────────────────────────────────────────────
  deleteAccount(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/me`);
  }

  // ── Build initials avatar fallback ────────────────────────────────────
  getInitials(name: string): string {
    return name
      .split(' ')
      .map(w => w[0])
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
          // Strip query params — cache-busting ?v= is added at display time by getAvatarSrc()
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

  private syncStoredUser(partial: Partial<Pick<UserProfile, '_id' | 'name' | 'githubUsername' | 'avatar'>>): void {
    this.authService.updateCurrentUser(partial);
  }
}
