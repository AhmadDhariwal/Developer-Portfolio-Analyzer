import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
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

  constructor(
    private readonly http:                HttpClient,
    private readonly authService:         AuthService,
    private readonly careerProfileService: CareerProfileService,
  ) {}

  // ── Fetch profile + stats from backend ────────────────────────────────
  getProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.baseUrl}/me`).pipe(
      tap(profile => {
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
        // Keep localStorage user object in sync
        const stored = this.authService.getCurrentUser();
        if (stored) {
          const merged = { ...stored, ...updated };
          localStorage.setItem('user', JSON.stringify(merged));
        }
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
      tap((res) => {
        const stored = this.authService.getCurrentUser();
        if (stored) {
          const merged = { ...stored, avatar: res.avatar };
          localStorage.setItem('user', JSON.stringify(merged));
        }
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
}
